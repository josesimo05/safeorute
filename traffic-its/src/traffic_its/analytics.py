"""Mediciones sobre observaciones reales y tiempo del medio.

No diagnostica causas ni persiste tracks. Los umbrales geométricos y temporales
son parámetros iniciales del piloto, no una precisión validada en una vía real.
"""
from __future__ import annotations

from collections import Counter, deque
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import timedelta
import math
from typing import TYPE_CHECKING
from uuid import NAMESPACE_URL, uuid4, uuid5

import cv2
import numpy as np

from .domain import TrackObservation, VEHICLE_CLASSES, VideoFrame

if TYPE_CHECKING:
    from .config import CameraConfig

_CLASSES = tuple(VEHICLE_CLASSES.values())
_HEALTHY = {"healthy", "ok"}
_BIN_SECONDS = 60.0
_LINE_HYSTERESIS_PX = 2.0


def _finite_point(point) -> bool:
    return len(point) == 2 and all(math.isfinite(float(x)) for x in point)


def _inside(point, polygon) -> bool:
    return len(polygon) >= 3 and cv2.pointPolygonTest(
        np.asarray(polygon, dtype=np.float32), tuple(map(float, point)), False
    ) >= 0


def _line_side(point, endpoints) -> float:
    a, b = np.asarray(endpoints, dtype=float)
    length = float(np.linalg.norm(b - a))
    if length <= 1e-9:
        return 0.0
    delta, offset = b - a, np.asarray(point, dtype=float) - a
    return float((delta[0] * offset[1] - delta[1] * offset[0]) / length)


def _crossing(a, b, endpoints):
    """Intersección de dos segmentos, incluyendo extremos y sin extrapolación."""
    p, r = np.asarray(a, dtype=float), np.asarray(b, dtype=float) - a
    q, s = np.asarray(endpoints[0], dtype=float), np.asarray(endpoints[1], dtype=float) - endpoints[0]
    denominator = float(r[0] * s[1] - r[1] * s[0])
    if abs(denominator) <= 1e-9:
        return None
    delta = q - p
    u = float((delta[0] * r[1] - delta[1] * r[0]) / denominator)
    fraction = float((delta[0] * s[1] - delta[1] * s[0]) / denominator)
    if 0 <= u <= 1 and 0 <= fraction <= 1:
        return tuple(p + fraction * r), fraction
    return None


def _axis_distance(point, polyline) -> float | None:
    """Proyección longitudinal sobre el eje, en el sentido de sus vértices."""
    best = None
    cumulative = 0.0
    p = np.asarray(point, dtype=float)
    for first, last in zip(polyline, polyline[1:]):
        a, b = np.asarray(first, dtype=float), np.asarray(last, dtype=float)
        delta = b - a
        length = float(np.linalg.norm(delta))
        if length <= 1e-9:
            continue
        fraction = float(np.dot(p - a, delta) / (length * length))
        # No convertir un punto fuera del eje en un extremo fijo: produciría
        # velocidad cero artificial al salir de la región longitudinal medida.
        if -1e-8 <= fraction <= 1 + 1e-8:
            fraction = min(1.0, max(0.0, fraction))
            separation = float(np.linalg.norm(p - (a + fraction * delta)))
            candidate = separation, cumulative + fraction * length
            if best is None or candidate[0] < best[0]:
                best = candidate
        cumulative += length
    return best[1] if best else None


def _robust_slope(points) -> tuple[float, float]:
    """IRLS Huber: conserva el signo y no suma magnitudes de jitter."""
    data = np.asarray(points, dtype=np.float64)
    times = data[:, 0] - data[0, 0]
    design = np.column_stack((np.ones(len(times)), times))
    values = data[:, 1]
    coefficients = np.linalg.lstsq(design, values, rcond=None)[0]
    for _ in range(5):
        residual = values - design @ coefficients
        scale = max(0.02, 1.4826 * float(np.median(np.abs(residual - np.median(residual)))))
        weights = np.minimum(1.0, 1.5 * scale / np.maximum(np.abs(residual), 1e-12))
        root = np.sqrt(weights)
        coefficients = np.linalg.lstsq(design * root[:, None], values * root, rcond=None)[0]
    rmse = float(np.sqrt(np.mean((values - design @ coefficients) ** 2)))
    return float(coefficients[1]), rmse


@dataclass
class _Track:
    previous_point: tuple[float, float]
    previous_time: float
    lane_id: str | None
    positions: deque = field(default_factory=deque)
    anchors: dict = field(default_factory=dict)


class Analytics:
    """Una instancia por cámara; el estado efímero no se comparte entre épocas."""

    def __init__(self, config: CameraConfig):
        self.config = config
        self._tracks: dict[int, _Track] = {}
        self._counted: dict[tuple[int, str], float] = {}
        self._windows: dict[tuple[str, str, float], dict] = {}
        self._dirty: set[tuple[str, str, float]] = set()
        self._source_epoch = None
        self._epoch = None
        self._last_media = None
        self._awaiting_time_epoch = False
        self._stop_since = None
        self._max_gap_s = max(0.75, 3.0 / config.processing.target_processed_fps)
        self._lanes = {lane.id: lane for lane in config.lanes}
        self._homography, self.calibration_rmse_m, self.calibration_reason = self._calibrate()
        self.calibration_status = config.calibration.status if self._homography is not None else "unconfigured" if config.calibration.status == "unconfigured" else "invalid"

    def _calibrate(self):
        calibration = self.config.calibration
        if calibration.status == "unconfigured":
            return None, None, "calibration_unconfigured"
        try:
            ground = np.asarray(calibration.fit_points_ground_m, dtype=np.float64)
            image = np.asarray(calibration.fit_points_image_px, dtype=np.float64)
            # Destino = imagen, por tanto este umbral está deliberadamente en píxeles.
            world_to_image, mask = cv2.findHomography(ground, image, cv2.RANSAC, 2.0)
            if world_to_image is None or mask is None or int(mask.sum()) < 4:
                return None, None, "calibration_degenerate"
            if not np.all(np.isfinite(world_to_image)) or np.linalg.cond(world_to_image) > 1e12:
                return None, None, "calibration_degenerate"
            transform = np.linalg.inv(world_to_image)
            controls = calibration.independent_control_points
            if len(controls) < 4:
                return None, None, "independent_controls_required"
            projected = cv2.perspectiveTransform(
                np.asarray([point.image_px for point in controls], dtype=np.float64).reshape(-1, 1, 2), transform
            ).reshape(-1, 2)
            truth = np.asarray([point.ground_m for point in controls], dtype=np.float64)
            rmse = float(np.sqrt(np.mean(np.sum((projected - truth) ** 2, axis=1))))
            if not math.isfinite(rmse) or rmse > 0.5:
                return None, rmse if math.isfinite(rmse) else None, "independent_control_error"
            supplied = calibration.homography_image_to_ground
            if supplied is not None:
                supplied_values = cv2.perspectiveTransform(np.asarray([point.image_px for point in controls], dtype=np.float64).reshape(-1, 1, 2), np.asarray(supplied, dtype=np.float64)).reshape(-1, 2)
                if not np.all(np.isfinite(supplied_values)) or float(np.max(np.linalg.norm(supplied_values - projected, axis=1))) > 0.05:
                    return None, rmse, "supplied_homography_mismatch"
            return transform, rmse, None
        except (ValueError, np.linalg.LinAlgError, cv2.error):
            return None, None, "calibration_degenerate"

    def reset(self, epoch: str):
        """No descarta agregados pendientes de escritura de la época anterior."""
        self._source_epoch = epoch
        self._epoch = epoch
        self._last_media = None
        self._awaiting_time_epoch = False
        self._tracks.clear()
        self._counted.clear()
        self._stop_since = None

    def _ground(self, point):
        if self._homography is None:
            return None
        value = cv2.perspectiveTransform(np.asarray(point, dtype=np.float64).reshape(1, 1, 2), self._homography).reshape(2)
        return tuple(value) if np.all(np.isfinite(value)) else None

    def _window(self, lane_id, timestamp, frame):
        start = math.floor(timestamp / _BIN_SECONDS) * _BIN_SECONDS
        key = (self._epoch, lane_id, start)
        if key not in self._windows:
            captured = None
            if frame.capture_at is not None and frame.media_time_s is not None:
                captured = (frame.capture_at + timedelta(seconds=start - frame.media_time_s)).isoformat()
            self._windows[key] = {
                "window_id": str(uuid5(NAMESPACE_URL, f"its:{self.config.camera_id}:{self._epoch}:{lane_id}:{start}:{self.config.calibration.calibration_id}")),
                "camera_id": self.config.camera_id, "road_segment_id": self.config.road_segment_id,
                "lane_id": lane_id, "stream_epoch": self._epoch, "source_mode": self.config.source.mode,
                "calibration_id": self.config.calibration.calibration_id,
                "bin_start_s": start, "window_start_media_s": start,
                "media_start_ticks": int(round(start * 1000)), "time_base_num": 1, "time_base_den": 1000,
                "duration_seconds": _BIN_SECONDS, "capture_at": captured,
                "received_at": frame.received_at.isoformat(), "count": 0,
                "counts_by_class": {name: 0 for name in _CLASSES}, "coverage_seconds": 0.0,
                "speed_distance_metres": 0.0, "speed_observation_seconds": 0.0,
                "mean_speed_kmh": None, "partial": True, "count_valid": False, "speed_valid": False,
                "time_quality": "capture_utc_verified" if frame.capture_at else "media_pts_capture_utc_unknown",
            }
        self._dirty.add(key)
        return self._windows[key]

    def _interval(self, lane_id, start, end, frame, speed_m_s=None):
        while start < end - 1e-9:
            boundary = (math.floor(start / _BIN_SECONDS) + 1) * _BIN_SECONDS
            finish = min(end, boundary)
            row = self._window(lane_id, start, frame)
            duration = finish - start
            if speed_m_s is None:
                row["coverage_seconds"] = min(_BIN_SECONDS, row["coverage_seconds"] + duration)
                row["count_valid"] = True
            else:
                row["speed_distance_metres"] += abs(speed_m_s) * duration
                row["speed_observation_seconds"] += duration
                row["speed_valid"] = True
                row["mean_speed_kmh"] = 3.6 * row["speed_distance_metres"] / row["speed_observation_seconds"]
            row["partial"] = row["coverage_seconds"] < _BIN_SECONDS - 1e-6
            row["received_at"] = frame.received_at.isoformat()
            start = finish

    def _count_crossings(self, observation, track, timestamp, frame):
        for line in self.config.count_lines:
            side = _line_side(observation.point_px, line.points_image_px) * line.direction
            if side < -_LINE_HYSTERESIS_PX:
                track.anchors[line.id] = (observation.point_px, timestamp)
                continue
            anchor = track.anchors.get(line.id)
            if side <= _LINE_HYSTERESIS_PX or anchor is None:
                continue
            track.anchors.pop(line.id, None)
            key = (observation.track_id, line.id)
            if key in self._counted or timestamp - track.previous_time > self._max_gap_s:
                continue
            intersection = _crossing(anchor[0], observation.point_px, line.points_image_px)
            if intersection is None or not _inside(intersection[0], self._lanes[line.lane_id].polygon_image_px):
                continue
            cross_time = anchor[1] + intersection[1] * (timestamp - anchor[1])
            row = self._window(line.lane_id, cross_time, frame)
            row["count"] += 1
            row["counts_by_class"][observation.class_name] += 1
            row["count_valid"] = True
            self._counted[key] = timestamp

    def update(self, frame: VideoFrame, observations: list[TrackObservation], health: dict) -> dict:
        if frame.epoch != self._source_epoch:
            self.reset(frame.epoch)
        timestamp = frame.media_time_s
        valid_time = timestamp is not None and math.isfinite(timestamp)
        reasons = []
        if not valid_time:
            reasons.append("media_pts_unavailable")
            self._awaiting_time_epoch = True
        elif self._awaiting_time_epoch or (self._last_media is not None and timestamp <= self._last_media):
            self._epoch = str(uuid4())
            self._tracks.clear()
            self._counted.clear()
            self._stop_since = None
            self._last_media = None
            if not self._awaiting_time_epoch:
                reasons.append("media_pts_discontinuity")
                valid_time = False
            self._awaiting_time_epoch = False
        healthy = bool(health.get("usable_for_analytics", health.get("status") in _HEALTHY))
        if not healthy:
            reasons.append("camera_quality_insufficient")
        elif not health.get("usable_for_speed", healthy) and self.config.capability_gates.metric_speed_enabled:
            reasons.append("speed_quality_insufficient")
        size = tuple((frame.image.shape[1], frame.image.shape[0])) if getattr(frame.image, "ndim", 0) >= 2 else None
        expected_size = self.config.calibration.frame_size_px
        shape_valid = size is not None and (expected_size is None or tuple(expected_size) == size)
        if not shape_valid:
            reasons.append("frame_size_mismatch")
        if self.calibration_reason:
            reasons.append(self.calibration_reason)
        count_valid = bool(valid_time and healthy and shape_valid and self.config.capability_gates.lane_flow_enabled)
        speed_allowed = bool(valid_time and healthy and health.get("usable_for_speed", healthy) and shape_valid and self.config.capability_gates.metric_speed_enabled and self._homography is not None)
        usable = valid_time and healthy and shape_valid
        current_speeds = {lane.id: [] for lane in self.config.lanes}
        observed = Counter()
        wrong_direction = Counter()
        gap = timestamp - self._last_media if valid_time and self._last_media is not None else None
        if not usable or (gap is not None and gap > self._max_gap_s):
            self._tracks.clear()
            self._stop_since = None
            if gap is not None and gap > self._max_gap_s:
                reasons.append("observation_gap")
        if count_valid and gap is not None and 0 < gap <= self._max_gap_s:
            for lane in self.config.lanes:
                self._interval(lane.id, self._last_media, timestamp, frame)
        if usable:
            for item in observations:
                if item.class_name not in _CLASSES or not _finite_point(item.point_px) or not math.isfinite(item.confidence):
                    continue
                lane = next((lane for lane in self.config.lanes if _inside(item.point_px, lane.polygon_image_px)), None)
                if lane is None:
                    continue
                observed[lane.id] += 1
                track = self._tracks.get(item.track_id)
                if track is None or timestamp - track.previous_time > self._max_gap_s:
                    track = _Track(item.point_px, timestamp, lane.id)
                    self._tracks[item.track_id] = track
                previous_time = track.previous_time
                if not health.get("usable_for_speed", healthy):
                    track.positions.clear()
                if track.lane_id != lane.id:
                    track.positions.clear()
                    track.lane_id = lane.id
                point = self._ground(item.point_px) if speed_allowed else None
                longitudinal = _axis_distance(point, lane.centerline_ground_m) if point is not None else None
                if longitudinal is not None and track.positions and timestamp > track.positions[-1][0] and abs(longitudinal - track.positions[-1][1]) / (timestamp - track.positions[-1][0]) > 100:
                    track.positions.clear()
                    track.anchors.clear()
                    track.previous_point, track.previous_time = item.point_px, timestamp
                    reasons.append("position_jump")
                    continue
                if count_valid:
                    self._count_crossings(item, track, timestamp, frame)
                if speed_allowed and _inside(item.point_px, self.config.calibration.valid_roi_image_px):
                    if longitudinal is not None:
                        track.positions.append((timestamp, longitudinal))
                        low, high = self.config.processing.speed_fit_window_seconds
                        while track.positions and timestamp - track.positions[0][0] > high + 1e-8:
                            track.positions.popleft()
                        support = timestamp - track.positions[0][0]
                        if len(track.positions) >= self.config.processing.speed_fit_min_observations and support >= low - 1e-8:
                            slope, residual = _robust_slope(track.positions)
                            if residual <= 1.0:
                                if slope < -0.5:
                                    wrong_direction[lane.id] += 1
                                else:
                                    current_speeds[lane.id].append((abs(slope) * 3.6, support))
                                    if 0 < timestamp - previous_time <= self._max_gap_s:
                                        self._interval(lane.id, previous_time, timestamp, frame, slope)
                track.previous_point, track.previous_time = item.point_px, timestamp
            self._tracks = {identifier: track for identifier, track in self._tracks.items() if timestamp - track.previous_time <= 5}
            self._counted = {key: when for key, when in self._counted.items() if timestamp - when <= 120}
        lane_states = []
        for lane in self.config.lanes:
            key = (self._epoch, lane.id, math.floor(timestamp / _BIN_SECONDS) * _BIN_SECONDS) if valid_time else None
            row = self._windows.get(key)
            samples = current_speeds[lane.id]
            speed = sum(value * support for value, support in samples) / sum(support for _, support in samples) if samples else None
            lane_states.append({
                "id": lane.id, "count": row["count"] if count_valid and row else 0 if count_valid else None,
                "counts_by_class": dict(row["counts_by_class"]) if count_valid and row else {name: 0 for name in _CLASSES} if count_valid else None,
                "mean_speed_kmh": round(speed, 3) if speed is not None else None,
                "count_valid": count_valid, "speed_valid": speed is not None,
                "observed_vehicles": observed[lane.id], "vehicles_with_speed": len(samples),
                "opposite_direction_observations": wrong_direction[lane.id],
                "window_start_media_s": key[2] if key else None,
                "coverage_seconds": round(row["coverage_seconds"], 6) if row else 0.0,
            })
        speeds = [sample for values in current_speeds.values() for sample in values]
        mean = sum(value * support for value, support in speeds) / sum(support for _, support in speeds) if speeds else None
        presence = sum(observed.values())
        if mean is not None and mean <= 5 and presence:
            if self._stop_since is None:
                self._stop_since = timestamp
        else:
            self._stop_since = None
        if mean is None:
            congestion = "desconocido"
        elif self._stop_since is not None and timestamp - self._stop_since >= 30:
            congestion = "detenido"
        else:
            ratio = mean / self.config.processing.free_flow_speed_kmh
            # Tolerancia numérica: una homografía exacta no debe oscilar en el
            # umbral por residuos de coma flotante (30/40 en la demo).
            congestion = "fluido" if ratio >= .75 - 1e-9 else "moderado" if ratio >= .45 - 1e-9 else "denso"
        if valid_time:
            self._last_media = timestamp
        else:
            self._last_media = None
        age = max(0.0, (frame.received_at - frame.capture_at).total_seconds()) if frame.capture_at is not None else None
        return {
            "camera_id": self.config.camera_id, "road_segment_id": self.config.road_segment_id,
            "source_mode": self.config.source.mode, "stream_epoch": self._epoch,
            "media_time_s": timestamp if valid_time else None,
            "capture_at": frame.capture_at.isoformat() if frame.capture_at else None,
            "received_at": frame.received_at.isoformat(), "arrival_age_seconds": 0.0, "capture_age_seconds": age,
            "health": deepcopy(health), "calibration_status": self.calibration_status,
            "calibration_rmse_metres": self.calibration_rmse_m,
            "calibration_id": self.config.calibration.calibration_id,
            "count_valid": count_valid, "speed_valid": mean is not None,
            "mean_speed_kmh": round(mean, 3) if mean is not None else None,
            "congestion": congestion,
            "congestion_reference": self.config.processing.free_flow_reference,
            "total_count": sum(lane["count"] for lane in lane_states) if count_valid else None,
            "observed_vehicles": presence, "vehicles_with_speed": len(speeds),
            "lanes": lane_states,
            "data_quality": {"status": ("degraded" if reasons else "valid") if usable else "unavailable", "reasons": sorted(set(reasons)), "time_quality": "capture_utc_verified" if frame.capture_at else "capture_utc_unknown", "synthetic": self.config.source.kind == "synthetic"},
            "probable_causes": [], "public_alerts_enabled": False,
        }

    def flush_windows(self) -> list[dict]:
        """Snapshots completos para UPSERT; llamar otra vez no devuelve deltas."""
        result = [deepcopy(self._windows[key]) for key in sorted(self._dirty)]
        self._dirty.clear()
        # Retener ventana activa y cualquier fila aún no entregada, sin crecer
        # proporcionalmente a toda la duración del stream.
        active_start = math.floor(self._last_media / _BIN_SECONDS) * _BIN_SECONDS if self._last_media is not None else None
        self._windows = {key: value for key, value in self._windows.items() if key[0] == self._epoch and active_start is not None and key[2] >= active_start - _BIN_SECONDS}
        return result
