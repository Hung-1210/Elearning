# """
# Demo Webcam tích hợp toàn bộ module AI cho hệ thống giám sát thi cử:
# 1. Face Proctoring (xác thực danh tính, giám sát có mặt, nhiều mặt, đổi người) - dùng face_proctoring.py
# 2. Head Pose Estimation (hướng đầu: yaw/pitch/roll) - model HopeNet tự train
# 3. Gaze Estimation (hướng mắt: pitch/yaw) - model L2CS fine-tune
# 4. Object Detection (điện thoại, tài liệu, laptop, tv, tai nghe, người thứ 2) - YOLOv8 fine-tune

# YÊU CẦU FILE CÙNG THƯ MỤC:
# - face_proctoring.py          (module đã có từ trước)
# - hopenet_final.pth           (model Head Pose đã train)
# - l2cs_gaze_final.pth         (model Gaze đã fine-tune)
# - yolov8_exam_proctor_final.pt (model Object Detection đã fine-tune)

# CÀI ĐẶT:
#     pip install insightface onnxruntime opencv-python torch torchvision ultralytics numpy

# CHẠY:
#     python webcam_demo_all_in_one.py
#     (Bấm 'q' để thoát, bấm 'r' để đăng ký lại danh tính từ frame hiện tại)
# """

# import time

# import cv2
# import numpy as np
# import torch
# import torch.nn as nn
# import torch.nn.functional as F
# from torchvision import transforms, models
# from ultralytics import YOLO

# from face_proctoring import FaceProctor


# # =========================================================
# # CẤU HÌNH - sửa lại đường dẫn nếu file model không cùng thư mục
# # =========================================================
# class CFG:
#     HOPENET_PATH = "hopenet_final.pth"
#     L2CS_PATH = "l2cs_gaze_final.pth"
#     YOLO_PATH = "yolov8_exam_proctor_final.pt"

#     CAMERA_INDEX = 0
#     IMG_SIZE = 224

#     # Head Pose (khớp đúng cấu hình lúc train trong notebook Head Pose)
#     HP_NUM_BINS = 66
#     HP_BIN_WIDTH = 3
#     HP_ANGLE_MIN = -99

#     # Gaze (khớp đúng cấu hình lúc train trong notebook Gaze)
#     GZ_NUM_BINS = 28
#     GZ_BIN_WIDTH = 3
#     GZ_ANGLE_MIN = -42

#     # Ngưỡng cảnh báo (độ) - có thể chỉnh theo mức độ nhạy mong muốn
#     YAW_WARNING_THRESHOLD = 35
#     PITCH_WARNING_THRESHOLD = 25
#     GAZE_WARNING_THRESHOLD = 30

#     YOLO_CONF_THRESHOLD = 0.55
#     YOLO_WARNING_CLASSES = {"cell phone", "book", "laptop", "tv", "headphone", "person"}

#     DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# print("Device:", CFG.DEVICE)


# # =========================================================
# # KIẾN TRÚC MODEL (phải khớp CHÍNH XÁC với lúc train)
# # =========================================================
# class Hopenet(nn.Module):
#     def __init__(self, num_bins=66, pretrained=False):
#         super(Hopenet, self).__init__()
#         resnet = models.resnet50(weights=None)
#         self.backbone = nn.Sequential(*list(resnet.children())[:-1])
#         feat_dim = resnet.fc.in_features
#         self.fc_yaw = nn.Linear(feat_dim, num_bins)
#         self.fc_pitch = nn.Linear(feat_dim, num_bins)
#         self.fc_roll = nn.Linear(feat_dim, num_bins)

#     def forward(self, x):
#         feat = self.backbone(x)
#         feat = feat.view(feat.size(0), -1)
#         return self.fc_yaw(feat), self.fc_pitch(feat), self.fc_roll(feat)


# class L2CS(nn.Module):
#     def __init__(self, num_bins=28, pretrained=False):
#         super(L2CS, self).__init__()
#         resnet = models.resnet50(weights=None)
#         self.backbone = nn.Sequential(*list(resnet.children())[:-1])
#         feat_dim = resnet.fc.in_features
#         self.fc_pitch_gaze = nn.Linear(feat_dim, num_bins)
#         self.fc_yaw_gaze = nn.Linear(feat_dim, num_bins)

#     def forward(self, x):
#         feat = self.backbone(x)
#         feat = feat.view(feat.size(0), -1)
#         return self.fc_pitch_gaze(feat), self.fc_yaw_gaze(feat)


# def load_checkpoint_state_dict(path):
#     """Checkpoint được lưu từ notebook train dạng dict có key 'model_state_dict'."""
#     ckpt = torch.load(path, map_location=CFG.DEVICE)
#     if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
#         return ckpt["model_state_dict"]
#     return ckpt  # fallback nếu file lưu trực tiếp state_dict


# # =========================================================
# # LOAD TẤT CẢ MODEL
# # =========================================================
# print("Đang load Face Proctor (RetinaFace + ArcFace)...")
# face_proctor = FaceProctor(similarity_threshold=0.45, no_face_grace_seconds=5.0)

# print("Đang load Head Pose model...")
# hopenet = Hopenet(num_bins=CFG.HP_NUM_BINS).to(CFG.DEVICE)
# hopenet.load_state_dict(load_checkpoint_state_dict(CFG.HOPENET_PATH))
# hopenet.eval()

# print("Đang load Gaze model...")
# l2cs = L2CS(num_bins=CFG.GZ_NUM_BINS).to(CFG.DEVICE)
# l2cs.load_state_dict(load_checkpoint_state_dict(CFG.L2CS_PATH))
# l2cs.eval()

# print("Đang load Object Detection model (YOLOv8)...")
# yolo_model = YOLO(CFG.YOLO_PATH)

# print("Tất cả model đã sẵn sàng.\n")

# # Bin centers dùng để chuyển softmax -> góc liên tục (giống hệt lúc train)
# hp_bin_centers = torch.FloatTensor(
#     [CFG.HP_ANGLE_MIN + CFG.HP_BIN_WIDTH * i + CFG.HP_BIN_WIDTH / 2 for i in range(CFG.HP_NUM_BINS)]
# ).to(CFG.DEVICE)
# gz_bin_centers = torch.FloatTensor(
#     [CFG.GZ_ANGLE_MIN + CFG.GZ_BIN_WIDTH * i + CFG.GZ_BIN_WIDTH / 2 for i in range(CFG.GZ_NUM_BINS)]
# ).to(CFG.DEVICE)

# preprocess = transforms.Compose([
#     transforms.ToPILImage(),
#     transforms.Resize((CFG.IMG_SIZE, CFG.IMG_SIZE)),
#     transforms.ToTensor(),
#     transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
# ])


# # =========================================================
# # HÀM TIỆN ÍCH
# # =========================================================
# def crop_face_with_margin(frame, bbox, margin_ratio=0.2):
#     x1, y1, x2, y2 = bbox
#     h, w = frame.shape[:2]
#     bw, bh = x2 - x1, y2 - y1
#     ex, ey = int(margin_ratio * bw), int(margin_ratio * bh)
#     x1, y1 = max(0, x1 - ex), max(0, y1 - ey)
#     x2, y2 = min(w, x2 + ex), min(h, y2 + ey)
#     crop = frame[y1:y2, x1:x2]
#     if crop.size == 0:
#         return None
#     return crop


# @torch.no_grad()
# def predict_head_pose(face_rgb_crop):
#     tensor = preprocess(face_rgb_crop).unsqueeze(0).to(CFG.DEVICE)
#     yaw_logits, pitch_logits, roll_logits = hopenet(tensor)
#     yaw = torch.sum(F.softmax(yaw_logits, dim=1) * hp_bin_centers, dim=1).item()
#     pitch = torch.sum(F.softmax(pitch_logits, dim=1) * hp_bin_centers, dim=1).item()
#     roll = torch.sum(F.softmax(roll_logits, dim=1) * hp_bin_centers, dim=1).item()
#     return yaw, pitch, roll


# @torch.no_grad()
# def predict_gaze(face_rgb_crop):
#     tensor = preprocess(face_rgb_crop).unsqueeze(0).to(CFG.DEVICE)
#     pitch_logits, yaw_logits = l2cs(tensor)
#     pitch = torch.sum(F.softmax(pitch_logits, dim=1) * gz_bin_centers, dim=1).item()
#     yaw = torch.sum(F.softmax(yaw_logits, dim=1) * gz_bin_centers, dim=1).item()
#     return pitch, yaw


# def draw_axis(img, yaw, pitch, roll, origin, size=60):
#     pitch_rad, yaw_rad, roll_rad = np.radians(pitch), -np.radians(yaw), np.radians(roll)
#     tdx, tdy = origin
#     x1 = size * (np.cos(yaw_rad) * np.cos(roll_rad)) + tdx
#     y1 = size * (np.cos(pitch_rad) * np.sin(roll_rad) + np.cos(roll_rad) * np.sin(pitch_rad) * np.sin(yaw_rad)) + tdy
#     x2 = size * (-np.cos(yaw_rad) * np.sin(roll_rad)) + tdx
#     y2 = size * (np.cos(pitch_rad) * np.cos(roll_rad) - np.sin(pitch_rad) * np.sin(yaw_rad) * np.sin(roll_rad)) + tdy
#     cv2.line(img, (int(tdx), int(tdy)), (int(x1), int(y1)), (0, 0, 255), 2)   # Pitch - đỏ
#     cv2.line(img, (int(tdx), int(tdy)), (int(x2), int(y2)), (0, 255, 0), 2)   # Yaw - xanh lá


# def draw_gaze_arrow(img, pitch, yaw, origin, size=60):
#     pitch_rad, yaw_rad = np.radians(pitch), np.radians(yaw)
#     dx = -size * np.sin(yaw_rad)
#     dy = -size * np.sin(pitch_rad)
#     tdx, tdy = origin
#     cv2.arrowedLine(img, (int(tdx), int(tdy)), (int(tdx + dx), int(tdy + dy)), (0, 255, 255), 2, tipLength=0.3)


# # =========================================================
# # VÒNG LẶP CHÍNH
# # =========================================================
# def main():
#     cap = cv2.VideoCapture(CFG.CAMERA_INDEX)
#     if not cap.isOpened():
#         print("[LỖI] Không mở được webcam. Kiểm tra lại CFG.CAMERA_INDEX hoặc quyền truy cập camera.")
#         return

#     print("Đang chạy... Bấm 'r' để đăng ký danh tính từ frame hiện tại, 'q' để thoát.")
#     identity_registered = False
#     fps_time = time.time()

#     while True:
#         ret, frame = cap.read()
#         if not ret:
#             print("[LỖI] Không đọc được frame từ webcam.")
#             break

#         display = frame.copy()
#         warnings_list = []

#         # ---- 1. Face Proctoring ----
#         face_result = face_proctor.analyze_frame(frame)

#         if face_result.flag_no_face:
#             warnings_list.append("KHONG THAY MAT")
#         if face_result.flag_multiple_faces:
#             warnings_list.append(f"NHIEU KHUON MAT ({face_result.num_faces})")
#         if face_result.flag_identity_mismatch:
#             warnings_list.append("NGHI NGO DOI NGUOI")

#         for bbox in face_result.faces_bbox:
#             cv2.rectangle(display, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 200, 0), 2)

#         # ---- 2 & 3. Head Pose + Gaze (chạy trên khuôn mặt chính, nếu có) ----
#         if face_result.num_faces >= 1:
#             primary_bbox = face_result.faces_bbox[0]
#             face_crop_bgr = crop_face_with_margin(frame, primary_bbox)

#             if face_crop_bgr is not None:
#                 face_crop_rgb = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2RGB)

#                 yaw, pitch, roll = predict_head_pose(face_crop_rgb)
#                 gaze_pitch, gaze_yaw = predict_gaze(face_crop_rgb)

#                 cx = (primary_bbox[0] + primary_bbox[2]) // 2
#                 cy = (primary_bbox[1] + primary_bbox[3]) // 2
#                 draw_axis(display, yaw, pitch, roll, (cx, cy))
#                 draw_gaze_arrow(display, gaze_pitch, gaze_yaw, (cx, cy))

#                 info_text = f"Yaw:{yaw:.0f} Pitch:{pitch:.0f} Roll:{roll:.0f} | Gaze P:{gaze_pitch:.0f} Y:{gaze_yaw:.0f}"
#                 cv2.putText(display, info_text, (primary_bbox[0], primary_bbox[1] - 10),
#                             cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

#                 if abs(yaw) > CFG.YAW_WARNING_THRESHOLD:
#                     warnings_list.append(f"QUAY DAU (Yaw={yaw:.0f})")
#                 if abs(pitch) > CFG.PITCH_WARNING_THRESHOLD:
#                     warnings_list.append(f"CUI/NGUA DAU (Pitch={pitch:.0f})")
#                 if abs(gaze_yaw) > CFG.GAZE_WARNING_THRESHOLD:
#                     warnings_list.append(f"MAT LECH HUONG (Yaw={gaze_yaw:.0f})")

#         if face_result.identity_similarity is not None:
#             match_text = "MATCH" if face_result.identity_match else "MISMATCH"
#             cv2.putText(display, f"Similarity: {face_result.identity_similarity:.2f} ({match_text})",
#                         (10, display.shape[0] - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

#         # ---- 4. Object Detection ----
#         yolo_results = yolo_model.predict(frame, conf=CFG.YOLO_CONF_THRESHOLD, verbose=False)
#         names = yolo_model.names
#         for box in yolo_results[0].boxes:
#             cls_id = int(box.cls)
#             class_name = names[cls_id]
#             conf = float(box.conf)
#             x1, y1, x2, y2 = map(int, box.xyxy[0])
#             cv2.rectangle(display, (x1, y1), (x2, y2), (0, 0, 255), 2)
#             cv2.putText(display, f"{class_name} {conf:.2f}", (x1, y1 - 8),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
#             if class_name in CFG.YOLO_WARNING_CLASSES:
#                 warnings_list.append(f"PHAT HIEN: {class_name.upper()}")

#         # ---- Overlay cảnh báo tổng hợp ----
#         y_off = 25
#         for w in warnings_list:
#             cv2.putText(display, f"[CANH BAO] {w}", (10, y_off), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
#             y_off += 22

#         # ---- FPS ----
#         now = time.time()
#         fps = 1.0 / max(now - fps_time, 1e-6)
#         fps_time = now
#         cv2.putText(display, f"FPS: {fps:.1f}", (display.shape[1] - 120, 20),
#                     cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

#         status_text = "Danh tinh: DA DANG KY" if identity_registered else "Danh tinh: CHUA DANG KY (bam 'r')"
#         cv2.putText(display, status_text, (10, display.shape[0] - 35),
#                     cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

#         cv2.imshow("Demo Giam Sat Thi Cu - AI Integration", display)

#         key = cv2.waitKey(1) & 0xFF
#         if key == ord("q"):
#             break
#         elif key == ord("r"):
#             ok = face_proctor.register_identity(frame)
#             identity_registered = ok
#             print("Đăng ký danh tính:", "THÀNH CÔNG" if ok else "THẤT BẠI (không detect đúng 1 khuôn mặt)")

#     cap.release()
#     cv2.destroyAllWindows()


# if __name__ == "__main__":
#     main()


"""
Demo Webcam tích hợp toàn bộ module AI cho hệ thống giám sát thi cử:
1. Face Proctoring (xác thực danh tính, giám sát có mặt, nhiều mặt, đổi người) - dùng face_proctoring.py
2. Head Pose Estimation (hướng đầu: yaw/pitch/roll) - model HopeNet tự train
3. Gaze Estimation (hướng mắt: pitch/yaw) - model L2CS fine-tune
4. Object Detection (điện thoại, tài liệu, laptop, tv, tai nghe, người thứ 2) - YOLOv8 fine-tune

YÊU CẦU FILE CÙNG THƯ MỤC:
- face_proctoring.py          (module đã có từ trước)
- hopenet_final.pth           (model Head Pose đã train)
- l2cs_gaze_final.pth         (model Gaze đã fine-tune)
- yolov8_exam_proctor_final.pt (model Object Detection đã fine-tune)

CÀI ĐẶT:
    pip install insightface onnxruntime opencv-python torch torchvision ultralytics numpy

CHẠY:
    python webcam_demo_all_in_one.py
    (Bấm 'q' để thoát, bấm 'r' để đăng ký lại danh tính từ frame hiện tại)
"""

import time

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import transforms, models
from ultralytics import YOLO

from face_proctoring import FaceProctor


# =========================================================
# CẤU HÌNH - sửa lại đường dẫn nếu file model không cùng thư mục
# =========================================================
class CFG:
    HOPENET_PATH = "hopenet_final.pth"
    L2CS_PATH = "l2cs_gaze_final.pth"
    YOLO_PATH = "yolov8_exam_proctor_final.pt"

    CAMERA_INDEX = 0
    IMG_SIZE = 224

    # Frame-skip: chỉ chạy 4 model AI mỗi N frame, các frame còn lại chỉ vẽ lại
    # kết quả gần nhất -> video hiển thị vẫn mượt dù AI chạy chậm.
    AI_INFERENCE_INTERVAL = 10

    # Head Pose (khớp đúng cấu hình lúc train trong notebook Head Pose)
    HP_NUM_BINS = 66
    HP_BIN_WIDTH = 3
    HP_ANGLE_MIN = -99

    # Gaze (khớp đúng cấu hình lúc train trong notebook Gaze)
    GZ_NUM_BINS = 28
    GZ_BIN_WIDTH = 3
    GZ_ANGLE_MIN = -42

    # Ngưỡng cảnh báo (độ) - có thể chỉnh theo mức độ nhạy mong muốn
    YAW_WARNING_THRESHOLD = 35
    PITCH_WARNING_THRESHOLD = 25
    GAZE_WARNING_THRESHOLD = 30

    YOLO_CONF_THRESHOLD = 0.55
    YOLO_WARNING_CLASSES = {"cell phone", "book", "laptop", "tv", "headphone", "person"}

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


print("Device:", CFG.DEVICE)


# =========================================================
# KIẾN TRÚC MODEL (phải khớp CHÍNH XÁC với lúc train)
# =========================================================
class Hopenet(nn.Module):
    def __init__(self, num_bins=66, pretrained=False):
        super(Hopenet, self).__init__()
        resnet = models.resnet50(weights=None)
        self.backbone = nn.Sequential(*list(resnet.children())[:-1])
        feat_dim = resnet.fc.in_features
        self.fc_yaw = nn.Linear(feat_dim, num_bins)
        self.fc_pitch = nn.Linear(feat_dim, num_bins)
        self.fc_roll = nn.Linear(feat_dim, num_bins)

    def forward(self, x):
        feat = self.backbone(x)
        feat = feat.view(feat.size(0), -1)
        return self.fc_yaw(feat), self.fc_pitch(feat), self.fc_roll(feat)


class L2CS(nn.Module):
    def __init__(self, num_bins=28, pretrained=False):
        super(L2CS, self).__init__()
        resnet = models.resnet50(weights=None)
        self.backbone = nn.Sequential(*list(resnet.children())[:-1])
        feat_dim = resnet.fc.in_features
        self.fc_pitch_gaze = nn.Linear(feat_dim, num_bins)
        self.fc_yaw_gaze = nn.Linear(feat_dim, num_bins)

    def forward(self, x):
        feat = self.backbone(x)
        feat = feat.view(feat.size(0), -1)
        return self.fc_pitch_gaze(feat), self.fc_yaw_gaze(feat)


def load_checkpoint_state_dict(path):
    """Checkpoint được lưu từ notebook train dạng dict có key 'model_state_dict'."""
    ckpt = torch.load(path, map_location=CFG.DEVICE)
    if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
        return ckpt["model_state_dict"]
    return ckpt  # fallback nếu file lưu trực tiếp state_dict


# =========================================================
# LOAD TẤT CẢ MODEL
# =========================================================
print("Đang load Face Proctor (RetinaFace + ArcFace)...")
face_proctor = FaceProctor(similarity_threshold=0.45, no_face_grace_seconds=5.0)

print("Đang load Head Pose model...")
hopenet = Hopenet(num_bins=CFG.HP_NUM_BINS).to(CFG.DEVICE)
hopenet.load_state_dict(load_checkpoint_state_dict(CFG.HOPENET_PATH))
hopenet.eval()

print("Đang load Gaze model...")
l2cs = L2CS(num_bins=CFG.GZ_NUM_BINS).to(CFG.DEVICE)
l2cs.load_state_dict(load_checkpoint_state_dict(CFG.L2CS_PATH))
l2cs.eval()

print("Đang load Object Detection model (YOLOv8)...")
yolo_model = YOLO(CFG.YOLO_PATH)

print("Tất cả model đã sẵn sàng.\n")

# Bin centers dùng để chuyển softmax -> góc liên tục (giống hệt lúc train)
hp_bin_centers = torch.FloatTensor(
    [CFG.HP_ANGLE_MIN + CFG.HP_BIN_WIDTH * i + CFG.HP_BIN_WIDTH / 2 for i in range(CFG.HP_NUM_BINS)]
).to(CFG.DEVICE)
gz_bin_centers = torch.FloatTensor(
    [CFG.GZ_ANGLE_MIN + CFG.GZ_BIN_WIDTH * i + CFG.GZ_BIN_WIDTH / 2 for i in range(CFG.GZ_NUM_BINS)]
).to(CFG.DEVICE)

preprocess = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((CFG.IMG_SIZE, CFG.IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# =========================================================
# HÀM TIỆN ÍCH
# =========================================================
def crop_face_with_margin(frame, bbox, margin_ratio=0.2):
    x1, y1, x2, y2 = bbox
    h, w = frame.shape[:2]
    bw, bh = x2 - x1, y2 - y1
    ex, ey = int(margin_ratio * bw), int(margin_ratio * bh)
    x1, y1 = max(0, x1 - ex), max(0, y1 - ey)
    x2, y2 = min(w, x2 + ex), min(h, y2 + ey)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return crop


@torch.no_grad()
def predict_head_pose(face_rgb_crop):
    tensor = preprocess(face_rgb_crop).unsqueeze(0).to(CFG.DEVICE)
    yaw_logits, pitch_logits, roll_logits = hopenet(tensor)
    yaw = torch.sum(F.softmax(yaw_logits, dim=1) * hp_bin_centers, dim=1).item()
    pitch = torch.sum(F.softmax(pitch_logits, dim=1) * hp_bin_centers, dim=1).item()
    roll = torch.sum(F.softmax(roll_logits, dim=1) * hp_bin_centers, dim=1).item()
    return yaw, pitch, roll


@torch.no_grad()
def predict_gaze(face_rgb_crop):
    tensor = preprocess(face_rgb_crop).unsqueeze(0).to(CFG.DEVICE)
    pitch_logits, yaw_logits = l2cs(tensor)
    pitch = torch.sum(F.softmax(pitch_logits, dim=1) * gz_bin_centers, dim=1).item()
    yaw = torch.sum(F.softmax(yaw_logits, dim=1) * gz_bin_centers, dim=1).item()
    return pitch, yaw


def draw_axis(img, yaw, pitch, roll, origin, size=60):
    pitch_rad, yaw_rad, roll_rad = np.radians(pitch), -np.radians(yaw), np.radians(roll)
    tdx, tdy = origin
    x1 = size * (np.cos(yaw_rad) * np.cos(roll_rad)) + tdx
    y1 = size * (np.cos(pitch_rad) * np.sin(roll_rad) + np.cos(roll_rad) * np.sin(pitch_rad) * np.sin(yaw_rad)) + tdy
    x2 = size * (-np.cos(yaw_rad) * np.sin(roll_rad)) + tdx
    y2 = size * (np.cos(pitch_rad) * np.cos(roll_rad) - np.sin(pitch_rad) * np.sin(yaw_rad) * np.sin(roll_rad)) + tdy
    cv2.line(img, (int(tdx), int(tdy)), (int(x1), int(y1)), (0, 0, 255), 2)   # Pitch - đỏ
    cv2.line(img, (int(tdx), int(tdy)), (int(x2), int(y2)), (0, 255, 0), 2)   # Yaw - xanh lá


def draw_gaze_arrow(img, pitch, yaw, origin, size=60):
    pitch_rad, yaw_rad = np.radians(pitch), np.radians(yaw)
    dx = -size * np.sin(yaw_rad)
    dy = -size * np.sin(pitch_rad)
    tdx, tdy = origin
    cv2.arrowedLine(img, (int(tdx), int(tdy)), (int(tdx + dx), int(tdy + dy)), (0, 255, 255), 2, tipLength=0.3)


def run_ai_inference(frame):
    """Chạy đủ 4 model AI trên 1 frame, trả về dict kết quả để cache lại.
    Đây là phần NẶNG - chỉ nên gọi mỗi N frame, không gọi mọi frame."""
    warnings_list = []

    # ---- 1. Face Proctoring ----
    face_result = face_proctor.analyze_frame(frame)

    if face_result.flag_no_face:
        warnings_list.append("KHONG THAY MAT")
    if face_result.flag_multiple_faces:
        warnings_list.append(f"NHIEU KHUON MAT ({face_result.num_faces})")
    if face_result.flag_identity_mismatch:
        warnings_list.append("NGHI NGO DOI NGUOI")

    head_pose_data = None  # (yaw, pitch, roll, gaze_pitch, gaze_yaw, cx, cy, bbox)

    # ---- 2 & 3. Head Pose + Gaze (trên khuôn mặt chính, nếu có) ----
    if face_result.num_faces >= 1:
        primary_bbox = face_result.faces_bbox[0]
        face_crop_bgr = crop_face_with_margin(frame, primary_bbox)

        if face_crop_bgr is not None:
            face_crop_rgb = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2RGB)

            yaw, pitch, roll = predict_head_pose(face_crop_rgb)
            gaze_pitch, gaze_yaw = predict_gaze(face_crop_rgb)

            cx = (primary_bbox[0] + primary_bbox[2]) // 2
            cy = (primary_bbox[1] + primary_bbox[3]) // 2
            head_pose_data = (yaw, pitch, roll, gaze_pitch, gaze_yaw, cx, cy, primary_bbox)

            if abs(yaw) > CFG.YAW_WARNING_THRESHOLD:
                warnings_list.append(f"QUAY DAU (Yaw={yaw:.0f})")
            if abs(pitch) > CFG.PITCH_WARNING_THRESHOLD:
                warnings_list.append(f"CUI/NGUA DAU (Pitch={pitch:.0f})")
            if abs(gaze_yaw) > CFG.GAZE_WARNING_THRESHOLD:
                warnings_list.append(f"MAT LECH HUONG (Yaw={gaze_yaw:.0f})")

    # ---- 4. Object Detection ----
    yolo_boxes = []  # list of (x1, y1, x2, y2, class_name, conf)
    yolo_results = yolo_model.predict(frame, conf=CFG.YOLO_CONF_THRESHOLD, verbose=False)
    names = yolo_model.names
    for box in yolo_results[0].boxes:
        cls_id = int(box.cls)
        class_name = names[cls_id]
        conf = float(box.conf)
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        yolo_boxes.append((x1, y1, x2, y2, class_name, conf))
        if class_name in CFG.YOLO_WARNING_CLASSES:
            warnings_list.append(f"PHAT HIEN: {class_name.upper()}")

    return {
        "faces_bbox": face_result.faces_bbox,
        "identity_similarity": face_result.identity_similarity,
        "identity_match": face_result.identity_match,
        "head_pose_data": head_pose_data,
        "yolo_boxes": yolo_boxes,
        "warnings_list": warnings_list,
    }


def draw_overlay(display, results):
    """Vẽ lại kết quả đã cache lên frame hiện tại - việc này RẤT NHẸ (chỉ vẽ hình,
    không chạy model), nên có thể gọi ở mọi frame mà không ảnh hưởng FPS."""
    if results is None:
        cv2.putText(display, "Dang khoi dong AI...", (10, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        return

    for bbox in results["faces_bbox"]:
        cv2.rectangle(display, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 200, 0), 2)

    if results["head_pose_data"] is not None:
        yaw, pitch, roll, gaze_pitch, gaze_yaw, cx, cy, bbox = results["head_pose_data"]
        draw_axis(display, yaw, pitch, roll, (cx, cy))
        draw_gaze_arrow(display, gaze_pitch, gaze_yaw, (cx, cy))
        info_text = f"Yaw:{yaw:.0f} Pitch:{pitch:.0f} Roll:{roll:.0f} | Gaze P:{gaze_pitch:.0f} Y:{gaze_yaw:.0f}"
        cv2.putText(display, info_text, (bbox[0], bbox[1] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

    for x1, y1, x2, y2, class_name, conf in results["yolo_boxes"]:
        cv2.rectangle(display, (x1, y1), (x2, y2), (0, 0, 255), 2)
        cv2.putText(display, f"{class_name} {conf:.2f}", (x1, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

    if results["identity_similarity"] is not None:
        match_text = "MATCH" if results["identity_match"] else "MISMATCH"
        cv2.putText(display, f"Similarity: {results['identity_similarity']:.2f} ({match_text})",
                    (10, display.shape[0] - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    y_off = 25
    for w in results["warnings_list"]:
        cv2.putText(display, f"[CANH BAO] {w}", (10, y_off), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
        y_off += 22


# =========================================================
# VÒNG LẶP CHÍNH (có Frame-Skip: AI chạy mỗi N frame, hiển thị mọi frame)
# =========================================================
def main():
    cap = cv2.VideoCapture(CFG.CAMERA_INDEX)
    if not cap.isOpened():
        print("[LỖI] Không mở được webcam. Kiểm tra lại CFG.CAMERA_INDEX hoặc quyền truy cập camera.")
        return

    print(f"Đang chạy... AI chạy mỗi {CFG.AI_INFERENCE_INTERVAL} frame (frame-skip).")
    print("Bấm 'r' để đăng ký danh tính từ frame hiện tại, 'q' để thoát.")

    identity_registered = False
    fps_time = time.time()
    frame_count = 0
    cached_results = None  # kết quả AI gần nhất, dùng để vẽ ở các frame không chạy AI

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[LỖI] Không đọc được frame từ webcam.")
            break

        frame_count += 1
        display = frame.copy()

        # ---- Chỉ chạy AI (nặng) mỗi N frame ----
        if frame_count % CFG.AI_INFERENCE_INTERVAL == 0:
            cached_results = run_ai_inference(frame)

        # ---- Vẽ lại kết quả gần nhất lên MỌI frame (nhẹ, không ảnh hưởng FPS) ----
        draw_overlay(display, cached_results)

        # ---- FPS (đo tốc độ HIỂN THỊ, không phải tốc độ AI) ----
        now = time.time()
        fps = 1.0 / max(now - fps_time, 1e-6)
        fps_time = now
        cv2.putText(display, f"FPS hien thi: {fps:.1f}", (display.shape[1] - 180, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        status_text = "Danh tinh: DA DANG KY" if identity_registered else "Danh tinh: CHUA DANG KY (bam 'r')"
        cv2.putText(display, status_text, (10, display.shape[0] - 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

        cv2.imshow("Demo Giam Sat Thi Cu - AI Integration", display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            ok = face_proctor.register_identity(frame)
            identity_registered = ok
            print("Đăng ký danh tính:", "THÀNH CÔNG" if ok else "THẤT BẠI (không detect đúng 1 khuôn mặt)")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()