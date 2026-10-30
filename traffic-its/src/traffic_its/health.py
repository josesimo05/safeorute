"""Camera health describes observations, never a mechanical diagnosis.

Thresholds are initial engineering settings, not locally validated probabilities.
All reference thumbnails/hashes remain in RAM; no frame is written to disk.
"""
from __future__ import annotations

import hashlib
import math
import time

import cv2
import numpy as np

from .domain import VideoFrame


class HealthMonitor:
    def __init__(self, no_frame_seconds: float = 10.0, freeze_seconds: float = 10.0):
        self.no_frame_seconds = no_frame_seconds
        self.freeze_seconds = freeze_seconds
        self._last_received: float | None = None
        self._last_media: float | None = None
        self._hash: bytes | None = None
        self._same_since: float | None = None
        self._pts_advanced_since_same = False
        self._epoch: str | None = None
        self._reference = None
        self._scene_changed_since: float | None = None
        self._scene_changed = False
        self._state = self._base("starting", ["no_frames_yet"], False)

    @staticmethod
    def _base(status, issues, usable):
        return {"status": status, "issues": issues, "usable_for_analytics": usable,
                "usable_for_speed": usable, "capture_age_seconds": None,
                "arrival_age_seconds": None, "time_quality": "capture_utc_unknown"}

    def update(self, frame: VideoFrame) -> dict:
        now = frame.received_monotonic
        self._last_received = now
        image = frame.image
        if image is None or not isinstance(image, np.ndarray) or not image.size:
            self._state = self._base("degraded", ["invalid_image"], False)
            return dict(self._state)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        thumb = cv2.resize(gray, (128, 72), interpolation=cv2.INTER_AREA)
        digest = hashlib.sha256(thumb.tobytes()).digest()
        contrast = float(thumb.std())
        sharpness = float(cv2.Laplacian(thumb, cv2.CV_64F).var())
        issues = []
        usable = True
        if self._epoch != frame.epoch:
            self._epoch = frame.epoch
            self._hash = None
            self._last_media = None
            self._same_since = None
            self._pts_advanced_since_same = False
            # Reconnection resets the media clock, not the physical calibration.
            # Keep the initial view and a latched displacement across epochs.
            if self._reference is None:
                self._reference = thumb.copy()
            self._scene_changed_since = None
        if digest != self._hash:
            self._hash = digest
            self._same_since = now
            self._pts_advanced_since_same = False
        elif self._last_media is not None and frame.media_time_s is not None and frame.media_time_s > self._last_media:
            self._pts_advanced_since_same = True
        unchanged_for = now - (self._same_since if self._same_since is not None else now)
        # A static road with advancing presentation times is not proof of freeze.
        if unchanged_for >= self.freeze_seconds:
            if not self._pts_advanced_since_same:
                issues.append("freeze_suspected_no_media_progress")
                usable = False
            else:
                issues.append("static_scene_observed_not_proof_of_freeze")
        if contrast < 4:
            issues.append("view_low_texture_or_obstructed")
            usable = False
        if sharpness < 3:
            issues.append("blur_or_low_detail")
            usable = False
        if frame.media_time_s is None or not math.isfinite(frame.media_time_s):
            issues.append("invalid_media_timing")
        # Large sustained changes on the frame border suggest a changed view.
        # Vehicles in the central roadway are largely excluded from this check.
        mask = np.zeros_like(thumb, dtype=bool)
        mask[:, :13] = True
        mask[:, -13:] = True
        if self._reference is not None:
            border_change = float(np.abs(thumb.astype(float) - self._reference.astype(float))[mask].mean())
            if border_change > 45:
                if self._scene_changed_since is None:
                    self._scene_changed_since = now
                if now - self._scene_changed_since >= 3:
                    self._scene_changed = True
            else:
                self._scene_changed_since = None
        if self._scene_changed:
            issues.append("possible_scene_change_calibration_review_required")
            usable = False
        self._last_media = frame.media_time_s
        blocking = [issue for issue in issues if issue != "static_scene_observed_not_proof_of_freeze"]
        status = "healthy" if not blocking else "degraded"
        if "freeze_suspected_no_media_progress" in issues:
            status = "freeze_suspected"
        if self._scene_changed:
            status = "scene_changed"
        state = self._base(status, issues, usable)
        state["usable_for_speed"] = usable and frame.media_time_s is not None
        state.update({"arrival_age_seconds": 0.0, "contrast": round(contrast, 2),
                      "sharpness": round(sharpness, 2), "static_content_seconds": round(unchanged_for, 2)})
        if frame.capture_at is not None:
            age = (frame.received_at - frame.capture_at).total_seconds()
            if age >= 0:
                state["capture_age_seconds"] = age
                state["time_quality"] = "capture_utc_provided"
        self._state = state
        return dict(state)

    def timeout(self, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        state = dict(self._state)
        age = None if self._last_received is None else max(0.0, now - self._last_received)
        state["arrival_age_seconds"] = age
        if age is None or age >= self.no_frame_seconds:
            state.update(status="no_frames", issues=["ingest_unavailable"],
                         usable_for_analytics=False, usable_for_speed=False)
        # Capture age can only be advanced if it was known for the last sample.
        if age is not None and state.get("capture_age_seconds") is not None:
            state["capture_age_seconds"] += age
        return state
