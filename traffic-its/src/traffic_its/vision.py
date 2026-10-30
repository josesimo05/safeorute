"""YOLOX ONNX + ByteTrack; all image/track state remains in memory.

YOLOX preprocessing/grid decoding follows the official 0.3.0 ONNX example
(Apache-2.0): https://github.com/Megvii-BaseDetection/YOLOX/tree/0.3.0/demo/ONNXRuntime
SyntheticDetector is test/demo ground truth, never a claim of visual accuracy.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np

from .domain import Detection, TrackObservation, VEHICLE_CLASSES, VideoFrame


def synthetic_objects(media_time_s: float) -> list[Detection]:
    """Synthetic vehicles move down at 50 px/s: 30 km/h with demo y/6 mapping."""
    if not math.isfinite(media_time_s) or media_time_s < 0:
        return []
    objects = []
    last_spawn = int(media_time_s // 2)
    for spawn in range(max(0, last_spawn - 4), last_spawn + 1):
        elapsed = media_time_s - spawn * 2
        bottom = 20 + elapsed * 50
        if not (0 <= bottom <= 380):
            continue
        class_id = [2, 3, 5, 7][spawn % 4]
        center = 205 if spawn % 2 == 0 else 435
        width, height = {2: (46, 28), 3: (21, 25), 5: (67, 42), 7: (62, 40)}[class_id]
        objects.append(Detection((center - width / 2, bottom - height, center + width / 2, bottom), .99, class_id))
    return objects


class SyntheticDetector:
    """Deterministic fixture backend. Must only be used with the synthetic source."""
    model_sha256 = None
    backend = "synthetic_ground_truth"

    def __init__(self, config=None):
        self.config = config

    def detect(self, frame: VideoFrame) -> list[Detection]:
        return synthetic_objects(frame.media_time_s) if frame.media_time_s is not None else []


def _nms(boxes: np.ndarray, scores: np.ndarray, threshold: float) -> list[int]:
    x1, y1, x2, y2 = boxes.T
    area = np.maximum(0, x2 - x1 + 1) * np.maximum(0, y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        index = int(order[0])
        keep.append(index)
        if order.size == 1:
            break
        rest = order[1:]
        width = np.maximum(0, np.minimum(x2[index], x2[rest]) - np.maximum(x1[index], x1[rest]) + 1)
        height = np.maximum(0, np.minimum(y2[index], y2[rest]) - np.maximum(y1[index], y1[rest]) + 1)
        intersection = width * height
        union = area[index] + area[rest] - intersection
        iou = intersection / np.maximum(union, 1e-12)
        order = rest[iou <= threshold]
    return keep


class YoloXDetector:
    """Official YOLOX Nano/Tiny raw-output ONNX format, CPU provider only."""
    backend = "yolox_onnx_cpu"

    def __init__(self, model_path: str | Path, expected_sha256: str | None = None,
                 input_size: tuple[int, int] = (416, 416), score_threshold: float = .1,
                 nms_threshold: float = .45):
        import onnxruntime as ort

        path = Path(model_path)
        if not path.is_file():
            raise ValueError("No está disponible el modelo ONNX configurado.")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if expected_sha256 and digest.lower() != expected_sha256.lower():
            raise ValueError("El SHA-256 del modelo no coincide con el artefacto fijado.")
        self.model_sha256 = digest
        self.input_size = tuple(map(int, input_size))
        if any(size <= 0 or size % 32 for size in self.input_size):
            raise ValueError("YOLOX requiere dimensiones positivas divisibles por 32.")
        self.score_threshold = float(score_threshold)
        self.nms_threshold = float(nms_threshold)
        if not 0 < self.score_threshold < 1 or not 0 < self.nms_threshold < 1:
            raise ValueError("Umbrales de detección inválidos.")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self.session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        inputs = self.session.get_inputs()
        if len(inputs) != 1:
            raise ValueError("El modelo no tiene la entrada YOLOX esperada.")
        self.input_name = inputs[0].name
        shape = inputs[0].shape
        if len(shape) != 4 or shape[1] != 3:
            raise ValueError("El modelo no tiene la forma NCHW de YOLOX esperada.")
        if all(isinstance(v, int) for v in shape[2:]) and tuple(shape[2:]) != self.input_size:
            raise ValueError("El tamaño configurado no coincide con la entrada del modelo.")
        self._grids, self._strides = self._grid()

    def _grid(self):
        height, width = self.input_size
        grids, strides = [], []
        for stride in (8, 16, 32):
            y, x = np.meshgrid(np.arange(height // stride), np.arange(width // stride), indexing="ij")
            grid = np.stack((x, y), axis=2).reshape(1, -1, 2)
            grids.append(grid)
            strides.append(np.full((1, grid.shape[1], 1), stride))
        return np.concatenate(grids, axis=1), np.concatenate(strides, axis=1)

    def detect(self, frame: VideoFrame) -> list[Detection]:
        import cv2

        image = frame.image
        if not isinstance(image, np.ndarray) or image.ndim != 3 or image.shape[2] != 3:
            raise ValueError("El detector requiere una imagen BGR de tres canales.")
        height, width = self.input_size
        ratio = min(height / image.shape[0], width / image.shape[1])
        resized = cv2.resize(image, (int(image.shape[1] * ratio), int(image.shape[0] * ratio)), interpolation=cv2.INTER_LINEAR)
        padded = np.full((height, width, 3), 114, dtype=np.uint8)
        padded[:resized.shape[0], :resized.shape[1]] = resized
        tensor = np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32)
        output = np.asarray(self.session.run(None, {self.input_name: tensor})[0], dtype=np.float32)
        if output.ndim != 3 or output.shape[0] != 1 or output.shape[1] != self._grids.shape[1] or output.shape[2] != 85:
            raise ValueError("La salida no corresponde al YOLOX COCO raw configurado.")
        predictions = output.copy()
        predictions[..., :2] = (predictions[..., :2] + self._grids) * self._strides
        with np.errstate(over="ignore", invalid="ignore"):
            predictions[..., 2:4] = np.exp(predictions[..., 2:4]) * self._strides
        predictions = predictions[0]
        scores = predictions[:, 4:5] * predictions[:, 5:]
        class_ids = scores.argmax(axis=1)
        confidence = scores[np.arange(len(scores)), class_ids]
        valid = np.isin(class_ids, list(VEHICLE_CLASSES)) & (confidence >= self.score_threshold)
        valid &= np.isfinite(predictions[:, :4]).all(axis=1) & np.isfinite(confidence)
        predictions, class_ids, confidence = predictions[valid], class_ids[valid], confidence[valid]
        if not len(predictions):
            return []
        boxes = np.empty((len(predictions), 4), dtype=np.float32)
        boxes[:, :2] = predictions[:, :2] - predictions[:, 2:4] / 2
        boxes[:, 2:4] = predictions[:, :2] + predictions[:, 2:4] / 2
        boxes /= ratio
        boxes[:, (0, 2)] = np.clip(boxes[:, (0, 2)], 0, image.shape[1] - 1)
        boxes[:, (1, 3)] = np.clip(boxes[:, (1, 3)], 0, image.shape[0] - 1)
        keep = _nms(boxes, confidence, self.nms_threshold)
        return [Detection(tuple(map(float, boxes[i])), float(confidence[i]), int(class_ids[i]))
                for i in keep if boxes[i, 2] > boxes[i, 0] and boxes[i, 3] > boxes[i, 1]]


class ByteTrackTracker:
    """Only current detections returned by ByteTrack become observations."""
    def __init__(self, fps: float = 5):
        import supervision as sv

        self._sv = sv
        self._tracker = sv.ByteTrack(frame_rate=max(1, int(round(fps))), lost_track_buffer=60,
                                    track_activation_threshold=.25, minimum_consecutive_frames=1)

    def reset(self) -> None:
        self._tracker.reset()

    def update(self, detections: list[Detection]) -> list[TrackObservation]:
        valid = [d for d in detections if d.class_id in VEHICLE_CLASSES
                 and np.isfinite(d.xyxy).all() and 0 <= d.confidence <= 1
                 and d.xyxy[2] > d.xyxy[0] and d.xyxy[3] > d.xyxy[1]]
        batch = self._sv.Detections(
            xyxy=np.asarray([d.xyxy for d in valid], dtype=np.float32).reshape(-1, 4),
            confidence=np.asarray([d.confidence for d in valid], dtype=np.float32),
            class_id=np.asarray([d.class_id for d in valid], dtype=int),
        )
        tracked = self._tracker.update_with_detections(batch)
        if tracked.tracker_id is None:
            return []
        result = []
        for i, track_id in enumerate(tracked.tracker_id):
            class_id = int(tracked.class_id[i])
            box = tuple(map(float, tracked.xyxy[i]))
            result.append(TrackObservation(int(track_id), VEHICLE_CLASSES[class_id],
                                           ((box[0] + box[2]) / 2, box[3]), box,
                                           float(tracked.confidence[i])))
        return result
