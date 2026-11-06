"""
Pipeline suy luận AI Proctoring — load model THẬT, warm-up, phân tích frame có đo thời gian.

Nguyên tắc (HARD-TASK-ROADMAP mục 1-3):
  - Không silently fallback: model nào không load được sẽ có trạng thái `unavailable`
    và mọi request yêu cầu module đó nhận status `unavailable` (KHÔNG trả số liệu giả,
    KHÔNG chạy model với trọng số ngẫu nhiên).
  - Mặc định (AI_REQUIRE_ALL_MODELS=1) service KHÔNG khởi động nếu thiếu checkpoint.
  - AI chỉ ĐO (số mặt, góc, similarity, vật thể). Ngưỡng/vi phạm do Node quyết định.
  - Mỗi module trả status rõ ràng: ok | not_requested | no_face | unavailable | error.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models

log = logging.getLogger("ai-service")

SCHEMA_VERSION = "proctoring.analyze.v2"

# =========================================================
# CẤU HÌNH (qua biến môi trường)
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


HOPENET_PATH = os.environ.get("HOPENET_PATH", os.path.join(BASE_DIR, "hopenet_final.pth"))
L2CS_PATH = os.environ.get("L2CS_PATH", os.path.join(BASE_DIR, "l2cs_gaze_final.pth"))
YOLO_PATH = os.environ.get("YOLO_PATH", os.path.join(BASE_DIR, "yolov8_exam_proctor_final.pt"))
INSIGHTFACE_ROOT = os.environ.get("INSIGHTFACE_ROOT")  # None => ~/.insightface

REQUIRE_ALL_MODELS = _env_bool("AI_REQUIRE_ALL_MODELS", True)
DEVICE_PREF = os.environ.get("AI_DEVICE", "auto").lower()  # auto | cpu | cuda
TORCH_THREADS = _env_int("AI_TORCH_THREADS", 0)  # 0 = để torch tự chọn

# Kích thước xử lý — resize TRƯỚC khi suy luận để giảm chi phí CPU.
MAX_INPUT_SIDE = _env_int("AI_MAX_INPUT_SIDE", 640)      # cạnh dài tối đa của frame sau decode
FACE_DET_SIZE = _env_int("AI_FACE_DET_SIZE", 480)        # det_size của RetinaFace (bội số 32)
YOLO_IMGSZ = _env_int("AI_YOLO_IMGSZ", 480)              # imgsz YOLO (bội số 32)
YOLO_MIN_CONF = _env_float("AI_YOLO_MIN_CONF", 0.30)     # sàn conf; ngưỡng thật do Node áp
FACE_MIN_DET_SCORE = _env_float("AI_FACE_MIN_DET_SCORE", 0.50)
REGISTER_MIN_DET_SCORE = _env_float("AI_REGISTER_MIN_DET_SCORE", 0.70)
REGISTER_MIN_FACE_RATIO = _env_float("AI_REGISTER_MIN_FACE_RATIO", 0.08)  # bbox_w / frame_w
MAX_IMAGE_BYTES = _env_int("AI_MAX_IMAGE_BYTES", 5 * 1024 * 1024)

IMG_SIZE = 224
HP_NUM_BINS, HP_BIN_WIDTH, HP_ANGLE_MIN = 66, 3, -99
GZ_NUM_BINS, GZ_BIN_WIDTH, GZ_ANGLE_MIN = 28, 3, -42
HEAD_CROP_MARGIN = _env_float("AI_HEAD_CROP_MARGIN", 0.20)
# L2CS-Net (MPIIGaze) cần crop sát khuôn mặt (margin=0.0) để đồng tử rõ và không lẫn nền/vật thể cạnh má;
# nhiệt độ softmax 0.5 bù hiện tượng co biên độ kỳ vọng trên phân phối 28 bin của checkpoint fine-tune.
GAZE_CROP_MARGIN = _env_float("AI_GAZE_CROP_MARGIN", 0.0)
GAZE_YAW_TEMP = _env_float("AI_GAZE_YAW_TEMP", 0.50)

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _pick_device() -> torch.device:
    if DEVICE_PREF == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("AI_DEVICE=cuda nhưng CUDA không khả dụng")
        return torch.device("cuda")
    if DEVICE_PREF == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


DEVICE = _pick_device()
if TORCH_THREADS > 0:
    torch.set_num_threads(TORCH_THREADS)


# =========================================================
# LỖI CÓ MÃ (app.py map sang HTTP status)
# =========================================================
class PipelineError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


# =========================================================
# KIẾN TRÚC MODEL (phải khớp CHÍNH XÁC lúc train)
# =========================================================
class Hopenet(nn.Module):
    def __init__(self, num_bins=66):
        super().__init__()
        resnet = models.resnet50(weights=None)
        self.backbone = nn.Sequential(*list(resnet.children())[:-1])
        feat_dim = resnet.fc.in_features
        self.fc_yaw = nn.Linear(feat_dim, num_bins)
        self.fc_pitch = nn.Linear(feat_dim, num_bins)
        self.fc_roll = nn.Linear(feat_dim, num_bins)

    def forward(self, x):
        feat = self.backbone(x).view(x.size(0), -1)
        return self.fc_yaw(feat), self.fc_pitch(feat), self.fc_roll(feat)


class L2CS(nn.Module):
    def __init__(self, num_bins=28):
        super().__init__()
        resnet = models.resnet50(weights=None)
        self.backbone = nn.Sequential(*list(resnet.children())[:-1])
        feat_dim = resnet.fc.in_features
        self.fc_pitch_gaze = nn.Linear(feat_dim, num_bins)
        self.fc_yaw_gaze = nn.Linear(feat_dim, num_bins)

    def forward(self, x):
        feat = self.backbone(x).view(x.size(0), -1)
        return self.fc_pitch_gaze(feat), self.fc_yaw_gaze(feat)


def _load_state_dict(path: str):
    ckpt = torch.load(path, map_location=DEVICE)
    if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
        return ckpt["model_state_dict"]
    return ckpt


def _file_version(path: str) -> str:
    """Phiên bản model = tên file + 12 ký tự đầu sha1 của (size, mtime) — rẻ, không đọc 280MB."""
    st = os.stat(path)
    digest = hashlib.sha1(f"{st.st_size}:{int(st.st_mtime)}".encode()).hexdigest()[:12]
    return f"{os.path.basename(path)}@{digest}"


# =========================================================
# REGISTRY MODEL
# =========================================================
@dataclass
class ModelStatus:
    name: str
    status: str = "not_loaded"   # loaded | missing_checkpoint | load_error | not_loaded
    version: Optional[str] = None
    path: Optional[str] = None
    error: Optional[str] = None
    load_ms: Optional[float] = None
    warmup_ms: Optional[float] = None

    def as_dict(self) -> dict:
        return {
            "status": self.status, "version": self.version, "error": self.error,
            "load_ms": self.load_ms, "warmup_ms": self.warmup_ms,
        }


@dataclass
class Models:
    face_app: Any = None
    face_detector: Any = None
    face_recognizer: Any = None
    hopenet: Optional[Hopenet] = None
    l2cs: Optional[L2CS] = None
    yolo: Any = None
    status: dict = field(default_factory=dict)
    hp_bin_centers: Optional[torch.Tensor] = None
    gz_bin_centers: Optional[torch.Tensor] = None
    started_at: Optional[str] = None
    ready: bool = False

    def is_loaded(self, key: str) -> bool:
        st = self.status.get(key)
        return st is not None and st.status == "loaded"

    def versions(self) -> dict:
        return {k: v.version for k, v in self.status.items()}


MODELS = Models()


def _load_face(m: Models):
    st = ModelStatus("face")
    m.status["face"] = st
    t0 = time.perf_counter()
    try:
        from insightface.app import FaceAnalysis
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if DEVICE.type == "cuda" else ["CPUExecutionProvider"]
        kwargs: dict = {"name": "buffalo_l", "providers": providers,
                        # Chỉ nạp detection + recognition: bỏ landmark/genderage (tốn CPU, không dùng)
                        "allowed_modules": ["detection", "recognition"]}
        if INSIGHTFACE_ROOT:
            kwargs["root"] = INSIGHTFACE_ROOT
        app = FaceAnalysis(**kwargs)
        app.prepare(ctx_id=0 if DEVICE.type == "cuda" else -1, det_size=(FACE_DET_SIZE, FACE_DET_SIZE))
        m.face_app = app
        m.face_detector = getattr(app, "det_model", None)
        m.face_recognizer = app.models.get("recognition") if hasattr(app, "models") else None
        if m.face_detector is None or m.face_recognizer is None:
            raise RuntimeError("buffalo_l thiếu module detection hoặc recognition")
        st.status = "loaded"
        st.version = f"insightface/buffalo_l det{FACE_DET_SIZE}"
    except Exception as exc:  # noqa: BLE001
        st.status = "load_error"
        st.error = f"{type(exc).__name__}: {exc}"
    st.load_ms = round((time.perf_counter() - t0) * 1000, 1)


def _load_torch_model(m: Models, key: str, path: str, ctor):
    st = ModelStatus(key, path=path)
    m.status[key] = st
    if not os.path.exists(path):
        st.status = "missing_checkpoint"
        st.error = f"Không tìm thấy checkpoint: {path}"
        return None
    t0 = time.perf_counter()
    try:
        net = ctor().to(DEVICE)
        # strict=True: checkpoint lệch kiến trúc => lỗi, không chạy với trọng số ngẫu nhiên
        net.load_state_dict(_load_state_dict(path), strict=True)
        net.eval()
        st.status = "loaded"
        st.version = _file_version(path)
        return net
    except Exception as exc:  # noqa: BLE001
        st.status = "load_error"
        st.error = f"{type(exc).__name__}: {exc}"
        return None
    finally:
        st.load_ms = round((time.perf_counter() - t0) * 1000, 1)


def _load_yolo(m: Models):
    st = ModelStatus("objects", path=YOLO_PATH)
    m.status["objects"] = st
    if not os.path.exists(YOLO_PATH):
        st.status = "missing_checkpoint"
        st.error = f"Không tìm thấy checkpoint: {YOLO_PATH}"
        return
    t0 = time.perf_counter()
    try:
        from ultralytics import YOLO
        m.yolo = YOLO(YOLO_PATH)
        st.status = "loaded"
        st.version = _file_version(YOLO_PATH)
    except Exception as exc:  # noqa: BLE001
        st.status = "load_error"
        st.error = f"{type(exc).__name__}: {exc}"
    st.load_ms = round((time.perf_counter() - t0) * 1000, 1)


def load_all_models() -> Models:
    """Load toàn bộ model 1 lần lúc khởi động. Raise nếu REQUIRE_ALL_MODELS và có model lỗi."""
    m = MODELS
    log.info("Device=%s | require_all=%s | det_size=%s | yolo_imgsz=%s",
             DEVICE, REQUIRE_ALL_MODELS, FACE_DET_SIZE, YOLO_IMGSZ)
    _load_face(m)
    m.hopenet = _load_torch_model(m, "head_pose", HOPENET_PATH, lambda: Hopenet(HP_NUM_BINS))
    m.l2cs = _load_torch_model(m, "gaze", L2CS_PATH, lambda: L2CS(GZ_NUM_BINS))
    _load_yolo(m)
    m.status["identity"] = ModelStatus(
        "identity", status=m.status["face"].status,
        version=m.status["face"].version and "insightface/buffalo_l arcface",
        error=m.status["face"].error,
    )

    m.hp_bin_centers = torch.tensor(
        [HP_ANGLE_MIN + HP_BIN_WIDTH * i + HP_BIN_WIDTH / 2 for i in range(HP_NUM_BINS)],
        dtype=torch.float32, device=DEVICE)
    m.gz_bin_centers = torch.tensor(
        [GZ_ANGLE_MIN + GZ_BIN_WIDTH * i + GZ_BIN_WIDTH / 2 for i in range(GZ_NUM_BINS)],
        dtype=torch.float32, device=DEVICE)

    for key, st in m.status.items():
        if st.status == "loaded":
            log.info("  [OK]   %-9s %s (%.0f ms)", key, st.version, st.load_ms or 0)
        else:
            log.error("  [FAIL] %-9s %s — %s", key, st.status, st.error)

    failed = [k for k, st in m.status.items() if st.status != "loaded"]
    if "face" in failed:
        # Không có face model thì không thể giám sát gì — luôn fail khởi động.
        raise RuntimeError(f"Face model không load được: {m.status['face'].error}")
    if failed and REQUIRE_ALL_MODELS:
        raise RuntimeError(
            "Thiếu/lỗi model: " + ", ".join(f"{k} ({m.status[k].status})" for k in failed)
            + ". Đặt AI_REQUIRE_ALL_MODELS=0 nếu muốn chạy chế độ degraded.")

    warmup(m)
    m.started_at = datetime.now(timezone.utc).isoformat()
    m.ready = True
    return m


def warmup(m: Models):
    """Chạy 1 lượt giả lập trên ảnh đen để JIT/ONNX cấp phát xong trước request đầu tiên."""
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    face_crop = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
    for key, fn in (
        ("face", lambda: _detect_faces(m, dummy)),
        ("head_pose", lambda: predict_head_pose(m, face_crop)),
        ("gaze", lambda: predict_gaze(m, face_crop)),
        ("objects", lambda: m.yolo.predict(dummy, imgsz=YOLO_IMGSZ, conf=YOLO_MIN_CONF, verbose=False)),
    ):
        st = m.status.get(key)
        if not st or st.status != "loaded":
            continue
        t0 = time.perf_counter()
        try:
            fn()
            st.warmup_ms = round((time.perf_counter() - t0) * 1000, 1)
        except Exception as exc:  # noqa: BLE001
            st.status = "load_error"
            st.error = f"Warm-up lỗi: {type(exc).__name__}: {exc}"
            log.error("Warm-up %s lỗi: %s", key, exc)


# =========================================================
# TIỀN XỬ LÝ
# =========================================================
_JPEG = b"\xff\xd8\xff"
_PNG = b"\x89PNG\r\n\x1a\n"


def decode_image(raw: bytes) -> np.ndarray:
    if not raw:
        raise PipelineError("INVALID_IMAGE", "Ảnh rỗng", 400)
    if len(raw) > MAX_IMAGE_BYTES:
        raise PipelineError("IMAGE_TOO_LARGE", f"Ảnh vượt quá {MAX_IMAGE_BYTES // 1024} KB", 413)
    is_webp = raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if not (raw.startswith(_JPEG) or raw.startswith(_PNG) or is_webp):
        raise PipelineError("INVALID_IMAGE", "Định dạng ảnh không hỗ trợ (chỉ JPEG/PNG/WebP)", 415)
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise PipelineError("INVALID_IMAGE", "Không đọc được ảnh", 400)
    h, w = img.shape[:2]
    if min(h, w) < 64:
        raise PipelineError("INVALID_IMAGE", "Ảnh quá nhỏ để phân tích", 400)
    return img


def resize_max_side(img: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    scale = max_side / float(max(h, w))
    if scale >= 1.0:
        return img, 1.0
    return cv2.resize(img, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA), scale


def crop_with_margin(frame, bbox, margin_ratio=0.2):
    x1, y1, x2, y2 = [int(v) for v in bbox]
    h, w = frame.shape[:2]
    bw, bh = x2 - x1, y2 - y1
    ex, ey = int(margin_ratio * bw), int(margin_ratio * bh)
    x1, y1 = max(0, x1 - ex), max(0, y1 - ey)
    x2, y2 = min(w, x2 + ex), min(h, y2 + ey)
    crop = frame[y1:y2, x1:x2]
    return crop if crop.size > 0 else None


def _to_tensor(face_rgb: np.ndarray) -> torch.Tensor:
    """Tương đương transforms (ToPIL -> Resize(224) -> ToTensor -> Normalize) nhưng không qua PIL."""
    resized = cv2.resize(face_rgb, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_LINEAR)
    arr = (resized.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(arr.transpose(2, 0, 1).copy()).unsqueeze(0).to(DEVICE)


# =========================================================
# SUY LUẬN TỪNG MODULE
# =========================================================
@torch.inference_mode()
def predict_head_pose(m: Models, face_rgb):
    yaw_l, pitch_l, roll_l = m.hopenet(_to_tensor(face_rgb))
    c = m.hp_bin_centers
    return (
        torch.sum(F.softmax(yaw_l, dim=1) * c, dim=1).item(),
        torch.sum(F.softmax(pitch_l, dim=1) * c, dim=1).item(),
        torch.sum(F.softmax(roll_l, dim=1) * c, dim=1).item(),
    )


@torch.inference_mode()
def predict_gaze(m: Models, face_rgb):
    pitch_l, yaw_l = m.l2cs(_to_tensor(face_rgb))
    c = m.gz_bin_centers
    temp = GAZE_YAW_TEMP if GAZE_YAW_TEMP > 0 else 1.0
    return (
        torch.sum(F.softmax(pitch_l, dim=1) * c, dim=1).item(),
        torch.sum(F.softmax(yaw_l / temp, dim=1) * c, dim=1).item(),
    )


def _detect_faces(m: Models, img: np.ndarray):
    """Chỉ chạy detector (không tính embedding cho mọi mặt). Trả list (bbox[4], score, kps)."""
    bboxes, kpss = m.face_detector.detect(img, max_num=0, metric="default")
    out = []
    if bboxes is None:
        return out
    for i in range(bboxes.shape[0]):
        score = float(bboxes[i, 4])
        if score < FACE_MIN_DET_SCORE:
            continue
        out.append((bboxes[i, 0:4].astype(np.float32), score, None if kpss is None else kpss[i]))
    return out


def _embedding_for(m: Models, img: np.ndarray, bbox, score, kps) -> np.ndarray:
    from insightface.app.common import Face
    face = Face(bbox=bbox, kps=kps, det_score=score)
    m.face_recognizer.get(img, face)
    emb = np.asarray(face.embedding, dtype=np.float32)
    return emb / (np.linalg.norm(emb) + 1e-8)


def parse_reference_embedding(raw: Optional[str]) -> Optional[np.ndarray]:
    if raw is None or raw == "":
        return None
    try:
        arr = np.asarray(json.loads(raw), dtype=np.float32)
    except (json.JSONDecodeError, TypeError, ValueError):
        raise PipelineError("INVALID_REFERENCE", "reference_embedding không phải JSON array số", 400)
    if arr.ndim != 1 or arr.shape[0] != 512 or not np.all(np.isfinite(arr)):
        raise PipelineError("INVALID_REFERENCE", "reference_embedding phải là vector 512 chiều", 400)
    return arr / (np.linalg.norm(arr) + 1e-8)


def _module(status: str, **data) -> dict:
    return {"status": status, **data}


def _r(v: float, nd: int = 2) -> float:
    return round(float(v), nd)


def analyze(
    m: Models, raw: bytes, *,
    run_face: bool = True, run_head_pose: bool = False, run_gaze: bool = False,
    run_objects: bool = False, reference: Optional[np.ndarray] = None, request_id: Optional[str] = None,
) -> dict:
    """Phân tích 1 frame. Trả dict đúng schema `proctoring.analyze.v2`."""
    started_iso = datetime.now(timezone.utc).isoformat()
    t_start = time.perf_counter()
    timings: dict[str, float] = {}

    def lap(key: str, t0: float):
        timings[key] = round((time.perf_counter() - t0) * 1000, 1)

    t0 = time.perf_counter()
    original = decode_image(raw)
    frame, scale = resize_max_side(original, MAX_INPUT_SIDE)
    lap("decode_resize", t0)
    h, w = frame.shape[:2]

    modules: dict[str, dict] = {}
    # Pose/gaze/identity phụ thuộc face => face luôn chạy nếu có module phụ thuộc được yêu cầu
    need_face = run_face or run_head_pose or run_gaze or reference is not None

    primary = None
    if not need_face:
        modules["face"] = _module("not_requested")
    elif not m.is_loaded("face"):
        modules["face"] = _module("unavailable", error=m.status["face"].error)
    else:
        try:
            t0 = time.perf_counter()
            faces = _detect_faces(m, frame)
            lap("face_detect", t0)
            faces.sort(key=lambda f: (f[0][2] - f[0][0]) * (f[0][3] - f[0][1]), reverse=True)
            if faces:
                primary = faces[0]
            modules["face"] = _module(
                "ok",
                face_count=len(faces),
                faces=[{"bbox": [_r(v / scale, 1) for v in f[0]], "score": _r(f[1], 3)} for f in faces],
                primary=None if primary is None else {
                    "bbox": [_r(v / scale, 1) for v in primary[0]], "score": _r(primary[1], 3),
                    "width_ratio": _r((primary[0][2] - primary[0][0]) / w, 3),
                },
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] face detect lỗi", request_id)
            modules["face"] = _module("error", error=f"{type(exc).__name__}: {exc}")

    face_ok = modules["face"]["status"] == "ok"

    # ---- Identity (chỉ khi có reference) ----
    if reference is None:
        modules["identity"] = _module("not_requested")
    elif not m.is_loaded("identity"):
        modules["identity"] = _module("unavailable", error=m.status["identity"].error)
    elif not face_ok:
        modules["identity"] = _module("skipped_face_unavailable")
    elif primary is None:
        modules["identity"] = _module("no_face")
    else:
        try:
            t0 = time.perf_counter()
            emb = _embedding_for(m, frame, *primary)
            lap("identity_embedding", t0)
            modules["identity"] = _module("ok", similarity=_r(float(np.dot(emb, reference)), 4))
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] embedding lỗi", request_id)
            modules["identity"] = _module("error", error=f"{type(exc).__name__}: {exc}")

    # ---- Head pose / Gaze (chỉ chạy khi có mặt hợp lệ) ----
    head_crop_rgb = None
    gaze_crop_rgb = None
    if primary is not None:
        if run_head_pose:
            hp_crop = crop_with_margin(frame, primary[0], HEAD_CROP_MARGIN)
            if hp_crop is not None:
                head_crop_rgb = cv2.cvtColor(hp_crop, cv2.COLOR_BGR2RGB)
        if run_gaze:
            gz_crop = crop_with_margin(frame, primary[0], GAZE_CROP_MARGIN)
            if gz_crop is not None:
                gaze_crop_rgb = cv2.cvtColor(gz_crop, cv2.COLOR_BGR2RGB)

    def _angle_module(requested: bool, key: str, fn, crop_img, fields: tuple[str, ...]):
        if not requested:
            return _module("not_requested")
        if not m.is_loaded(key):
            return _module("unavailable", error=m.status[key].error)
        if not face_ok:
            return _module("skipped_face_unavailable")
        if primary is None or crop_img is None:
            return _module("no_face")
        try:
            t0 = time.perf_counter()
            vals = fn(m, crop_img)
            lap(key, t0)
            return _module("ok", **{f: _r(v) for f, v in zip(fields, vals)})
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] %s lỗi", request_id, key)
            return _module("error", error=f"{type(exc).__name__}: {exc}")

    modules["head_pose"] = _angle_module(run_head_pose, "head_pose", predict_head_pose, head_crop_rgb, ("yaw", "pitch", "roll"))
    modules["gaze"] = _angle_module(run_gaze, "gaze", predict_gaze, gaze_crop_rgb, ("pitch", "yaw"))

    # ---- Objects (YOLO) ----
    if not run_objects:
        modules["objects"] = _module("not_requested")
    elif not m.is_loaded("objects"):
        modules["objects"] = _module("unavailable", error=m.status["objects"].error)
    else:
        try:
            t0 = time.perf_counter()
            results = m.yolo.predict(frame, imgsz=YOLO_IMGSZ, conf=YOLO_MIN_CONF, verbose=False)
            lap("objects", t0)
            names = m.yolo.names
            dets = []
            for box in results[0].boxes:
                cls_id = int(box.cls)
                dets.append({
                    "cls": names[cls_id], "conf": _r(float(box.conf), 3),
                    "bbox": [_r(float(v) / scale, 1) for v in box.xyxy[0]],
                })
            modules["objects"] = _module("ok", detections=dets)
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] YOLO lỗi", request_id)
            modules["objects"] = _module("error", error=f"{type(exc).__name__}: {exc}")

    inference_ms = round((time.perf_counter() - t_start) * 1000, 1)
    timings["total"] = inference_ms
    return {
        "schema_version": SCHEMA_VERSION,
        "request_id": request_id,
        "inference_started_at": started_iso,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "inference_ms": inference_ms,
        "device": str(DEVICE),
        "frame": {"width": int(original.shape[1]), "height": int(original.shape[0]), "processed_scale": _r(scale, 4)},
        "modules": modules,
        "model_versions": m.versions(),
        "timings_ms": timings,
    }


def register_face(m: Models, raw: bytes, request_id: Optional[str] = None) -> dict:
    """Trích embedding tham chiếu. Từ chối: ảnh lỗi, không mặt, nhiều mặt, mặt quá nhỏ/mờ."""
    if not m.is_loaded("face"):
        raise PipelineError("MODEL_UNAVAILABLE", "Face model chưa sẵn sàng", 503)
    t_start = time.perf_counter()
    original = decode_image(raw)
    frame, scale = resize_max_side(original, MAX_INPUT_SIDE)
    faces = _detect_faces(m, frame)
    if len(faces) == 0:
        raise PipelineError("NO_FACE", "Không phát hiện khuôn mặt nào. Vui lòng nhìn thẳng vào camera, đủ ánh sáng.", 422)
    if len(faces) > 1:
        raise PipelineError("MULTIPLE_FACES", "Có nhiều hơn 1 khuôn mặt trong ảnh, vui lòng chụp lại chỉ 1 người.", 422)
    bbox, score, kps = faces[0]
    width_ratio = float((bbox[2] - bbox[0]) / frame.shape[1])
    if score < REGISTER_MIN_DET_SCORE:
        raise PipelineError("LOW_QUALITY_FACE", "Khuôn mặt chưa rõ (thiếu sáng hoặc bị che). Vui lòng chụp lại.", 422)
    if width_ratio < REGISTER_MIN_FACE_RATIO:
        raise PipelineError("FACE_TOO_SMALL", "Khuôn mặt quá nhỏ, vui lòng ngồi gần camera hơn.", 422)
    emb = _embedding_for(m, frame, bbox, score, kps)
    return {
        "schema_version": "proctoring.register.v2",
        "request_id": request_id,
        "embedding": [float(x) for x in emb],
        "embedding_dim": int(emb.shape[0]),
        "face": {"bbox": [_r(v / scale, 1) for v in bbox], "score": _r(score, 3), "width_ratio": _r(width_ratio, 3)},
        "inference_ms": round((time.perf_counter() - t_start) * 1000, 1),
        "model_versions": {"face": m.status["face"].version, "identity": m.status["identity"].version},
    }

