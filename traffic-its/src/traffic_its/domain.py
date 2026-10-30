"""Contratos internos. Frames y tracks son efímeros y no se persisten."""
from dataclasses import dataclass
from datetime import datetime
from typing import Any

VEHICLE_CLASSES = {2: "carro", 3: "moto", 5: "guagua_bus", 7: "camion"}

@dataclass(frozen=True)
class VideoFrame:
    image: Any
    media_time_s: float | None
    epoch: str
    received_at: datetime
    received_monotonic: float
    capture_at: datetime | None = None

@dataclass(frozen=True)
class Detection:
    xyxy: tuple[float, float, float, float]
    confidence: float
    class_id: int

@dataclass(frozen=True)
class TrackObservation:
    track_id: int
    class_name: str
    point_px: tuple[float, float]
    xyxy: tuple[float, float, float, float]
    confidence: float = 1.0
