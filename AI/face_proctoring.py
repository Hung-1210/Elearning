"""
Module Giám Sát Thi Cử Bằng Computer Vision - Nhóm Face-based (chức năng 1-4)

Bao gồm:
1. Xác thực danh tính trước khi thi (Face Verification, 1:1)
2. Giám sát liên tục có mặt trong khung hình (Presence Detection)
3. Phát hiện nhiều khuôn mặt trong 1 frame (Multi-face Detection)
4. Phát hiện đổi người giữa chừng (Identity Swap Detection, sliding window)

Không cần train - dùng pretrained RetinaFace (detection) + ArcFace (recognition)
thông qua thư viện insightface (model buffalo_l).

Cài đặt: pip install insightface onnxruntime opencv-python-headless numpy
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
from insightface.app import FaceAnalysis


# =========================================================
# Cấu trúc dữ liệu kết quả trả về
# =========================================================

@dataclass
class FrameAnalysisResult:
    timestamp: float
    num_faces: int
    faces_bbox: list                       # danh sách bbox [x1,y1,x2,y2] mỗi khuôn mặt detect được
    primary_embedding: Optional[np.ndarray] = None   # embedding của khuôn mặt chính (lớn nhất/rõ nhất)
    identity_similarity: Optional[float] = None      # cosine similarity so với ảnh đăng ký, None nếu chưa xác thực
    identity_match: Optional[bool] = None            # True/False/None (None = chưa đủ dữ liệu để so sánh)

    # Các cờ cảnh báo (flags) - đây là phần sẽ dùng để tổng hợp "cheating score" sau này
    flag_no_face: bool = False
    flag_multiple_faces: bool = False
    flag_identity_mismatch: bool = False


# =========================================================
# Class chính: FaceProctor
# =========================================================

class FaceProctor:
    """
    Sử dụng:
        proctor = FaceProctor()
        proctor.register_identity(anh_dang_ky)          # gọi 1 lần lúc học sinh đăng nhập/vào phòng thi
        result = proctor.analyze_frame(frame_tu_webcam)  # gọi liên tục mỗi frame trong lúc thi
    """

    def __init__(
        self,
        det_size=(640, 640),
        similarity_threshold: float = 0.45,
        no_face_grace_seconds: float = 5.0,
        swap_check_interval_seconds: float = 30.0,
        swap_vote_window: int = 5,
        swap_vote_required: int = 3,
        providers=None,
    ):
        """
        similarity_threshold: ngưỡng cosine similarity để coi là cùng 1 người (0.4-0.5 là mức phổ biến với ArcFace)
        no_face_grace_seconds: số giây liên tục không thấy mặt mới coi là "rời khỏi bàn thi"
        swap_check_interval_seconds: chu kỳ (giây) tự động so sánh lại danh tính giữa buổi thi
        swap_vote_window: số lần check gần nhất dùng để "vote" (giảm false positive)
        swap_vote_required: trong swap_vote_window lần gần nhất, cần bao nhiêu lần fail mới thực sự flag
        """
        providers = providers or ["CPUExecutionProvider"]
        self.app = FaceAnalysis(name="buffalo_l", providers=providers)
        self.app.prepare(ctx_id=0, det_size=det_size)

        self.similarity_threshold = similarity_threshold
        self.no_face_grace_seconds = no_face_grace_seconds
        self.swap_check_interval_seconds = swap_check_interval_seconds
        self.swap_vote_window = swap_vote_window
        self.swap_vote_required = swap_vote_required

        self.reference_embedding: Optional[np.ndarray] = None
        self._last_face_seen_time: Optional[float] = None
        self._last_swap_check_time: float = 0.0
        self._swap_vote_history: deque = deque(maxlen=swap_vote_window)

    # -----------------------------------------------------
    # Chức năng 1: Xác thực danh tính trước khi thi
    # -----------------------------------------------------
    def register_identity(self, image: np.ndarray) -> bool:
        """Đăng ký ảnh chuẩn của học sinh (gọi 1 lần lúc đăng nhập/vào phòng thi).
        Trả về True nếu detect được đúng 1 khuôn mặt rõ ràng để đăng ký, False nếu thất bại."""
        faces = self.app.get(image)
        if len(faces) != 1:
            return False
        self.reference_embedding = faces[0].normed_embedding
        return True

    def verify_identity(self, embedding: np.ndarray) -> tuple[float, bool]:
        """So sánh 1 embedding với embedding đã đăng ký. Trả về (similarity, is_match)."""
        if self.reference_embedding is None:
            raise RuntimeError("Chưa đăng ký danh tính - gọi register_identity() trước.")
        similarity = float(np.dot(embedding, self.reference_embedding))
        return similarity, similarity >= self.similarity_threshold

    # -----------------------------------------------------
    # Hàm chính: phân tích 1 frame - gộp cả 4 chức năng
    # -----------------------------------------------------
    def analyze_frame(self, frame: np.ndarray) -> FrameAnalysisResult:
        now = time.time()
        faces = self.app.get(frame)
        num_faces = len(faces)

        result = FrameAnalysisResult(
            timestamp=now,
            num_faces=num_faces,
            faces_bbox=[f.bbox.astype(int).tolist() for f in faces],
        )

        # ---- Chức năng 2: Giám sát liên tục có mặt ----
        if num_faces == 0:
            if self._last_face_seen_time is None:
                self._last_face_seen_time = now  # lần đầu, khởi tạo mốc thời gian
            elapsed_no_face = now - self._last_face_seen_time
            result.flag_no_face = elapsed_no_face >= self.no_face_grace_seconds
        else:
            self._last_face_seen_time = now

        # ---- Chức năng 3: Phát hiện nhiều khuôn mặt ----
        result.flag_multiple_faces = num_faces >= 2

        # Chọn khuôn mặt chính = khuôn mặt có bbox lớn nhất (gần camera nhất / rõ nhất)
        primary_face = None
        if num_faces >= 1:
            primary_face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            result.primary_embedding = primary_face.normed_embedding

        # ---- Chức năng 1 & 4: Xác thực danh tính / phát hiện đổi người ----
        if primary_face is not None and self.reference_embedding is not None:
            similarity, is_match = self.verify_identity(primary_face.normed_embedding)
            result.identity_similarity = similarity
            result.identity_match = is_match

            # Chỉ chạy vòng "swap check" định kỳ (không phải mỗi frame) để tránh flag quá nhạy
            # do 1 vài frame lỗi tạm thời (góc mặt xấu, chớp mắt, ánh sáng thoáng qua)
            if now - self._last_swap_check_time >= self.swap_check_interval_seconds:
                self._last_swap_check_time = now
                self._swap_vote_history.append(is_match)

                if len(self._swap_vote_history) == self.swap_vote_window:
                    fail_count = sum(1 for v in self._swap_vote_history if not v)
                    result.flag_identity_mismatch = fail_count >= self.swap_vote_required

        return result


# =========================================================
# Hàm tiện ích: vẽ kết quả lên frame để debug/demo
# =========================================================

def draw_analysis_result(frame: np.ndarray, result: FrameAnalysisResult) -> np.ndarray:
    frame = frame.copy()
    for bbox in result.faces_bbox:
        x1, y1, x2, y2 = bbox
        color = (0, 255, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    y_text = 30
    lines = [f"So khuon mat: {result.num_faces}"]
    if result.identity_similarity is not None:
        lines.append(f"Similarity: {result.identity_similarity:.3f} "
                      f"({'MATCH' if result.identity_match else 'MISMATCH'})")
    if result.flag_no_face:
        lines.append("[CANH BAO] Khong thay mat qua lau")
    if result.flag_multiple_faces:
        lines.append("[CANH BAO] Phat hien nhieu khuon mat")
    if result.flag_identity_mismatch:
        lines.append("[CANH BAO] Nghi ngo doi nguoi")

    for line in lines:
        cv2.putText(frame, line, (10, y_text), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        y_text += 25

    return frame
