from datetime import UTC, datetime

import numpy as np

from traffic_its.domain import VideoFrame
from traffic_its.health import HealthMonitor


def textured():
    tiles = ((np.indices((72, 128)).sum(axis=0) // 3) % 2 * 180 + 30).astype(np.uint8)
    return np.stack([tiles, tiles, tiles], axis=2)


def frame(t, media=None, image=None, epoch="epoch"):
    return VideoFrame(textured() if image is None else image, media, epoch, datetime.now(UTC), t)


def test_static_road_with_advancing_pts_is_not_claimed_frozen():
    monitor = HealthMonitor(freeze_seconds=10)
    monitor.update(frame(0, 0))
    state = monitor.update(frame(11, 11))
    assert state["status"] == "healthy"
    assert "static_scene_observed_not_proof_of_freeze" in state["issues"]
    assert state["usable_for_analytics"]
    assert state["capture_age_seconds"] is None


def test_repeated_pixels_and_stalled_media_is_suspected_not_mechanical_diagnosis():
    monitor = HealthMonitor(freeze_seconds=10)
    monitor.update(frame(0, 0))
    state = monitor.update(frame(11, 0))
    assert state["status"] == "freeze_suspected"
    assert not state["usable_for_speed"]
    assert "broken_camera" not in str(state)


def test_no_frames_and_missing_timing_are_separate_from_zero_speed():
    monitor = HealthMonitor(no_frame_seconds=10)
    state = monitor.update(frame(100))
    assert not state["usable_for_speed"]
    assert state["usable_for_analytics"]
    stale = monitor.timeout(111)
    assert stale["status"] == "no_frames"
    assert stale["arrival_age_seconds"] == 11
    assert stale["capture_age_seconds"] is None
    assert "speed" not in stale


def test_low_texture_image_disables_measurements_without_asserting_weather():
    state = HealthMonitor().update(frame(0, 0, np.full((72, 128, 3), 100, np.uint8)))
    assert state["status"] == "degraded"
    assert not state["usable_for_analytics"]
    assert "rain" not in str(state)


def test_low_detail_cannot_publish_speed_despite_brightness_contrast():
    # A smooth gradient has brightness variation, but lacks sharp detail.
    gradient = np.tile(np.linspace(20, 220, 128, dtype=np.uint8), (72, 1))
    image = np.stack([gradient, gradient, gradient], axis=2)
    state = HealthMonitor().update(frame(0, 0, image))
    assert state['contrast'] > 4
    assert 'blur_or_low_detail' in state['issues']
    assert not state['usable_for_speed']


def test_sustained_border_change_remains_invalid_after_stream_reconnect():
    monitor = HealthMonitor()
    monitor.update(frame(0, 0))
    inverse = 255 - textured()
    monitor.update(frame(1, 1, inverse))
    changed = monitor.update(frame(5, 5, inverse))
    assert changed["status"] == "scene_changed"
    assert not changed["usable_for_speed"]
    reset = monitor.update(frame(6, 0, inverse, epoch="new-epoch"))
    assert reset["status"] == "scene_changed"
    assert not reset["usable_for_speed"]
