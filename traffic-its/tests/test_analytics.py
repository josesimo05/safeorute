from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

from traffic_its.analytics import Analytics
from traffic_its.config import CameraConfig, load_camera_config
from traffic_its.domain import TrackObservation, VideoFrame

ROOT = Path(__file__).resolve().parents[1]
HEALTHY = {"status": "healthy", "usable_for_analytics": True, "usable_for_speed": True}


@pytest.fixture
def config():
    return load_camera_config(ROOT / "configs/demo.json")


def frame(time, *, epoch="epoch-one", captured=False, shape=(360, 640, 3)):
    clock = 0 if time is None else time
    now = datetime(2026, 10, 30, tzinfo=timezone.utc) + timedelta(seconds=clock)
    return VideoFrame(np.zeros(shape, dtype=np.uint8), time, epoch, now, 100 + clock, now - timedelta(seconds=.1) if captured else None)


def vehicle(identifier=1, *, x=200, y=100, kind="carro"):
    return TrackObservation(identifier, kind, (x, y), (x - 10, y - 20, x + 10, y), .95)


def lane(state, name="lane-1"):
    return next(item for item in state["lanes"] if item["id"] == name)


def test_known_metric_speed_uses_real_media_time_and_independent_calibration(config):
    analytics = Analytics(config)
    for index in range(7):
        t = index * .2
        # Ground y=(pixel y-30)/6: 100/3 pixels/s = 20 km/h.
        state = analytics.update(frame(t), [vehicle(y=70 + (100 / 3) * t)], HEALTHY)
    assert state["calibration_status"] == "synthetic"
    assert state["calibration_rmse_metres"] < 1e-5
    assert state["mean_speed_kmh"] == pytest.approx(20, abs=.01)
    assert state["speed_valid"]
    assert state["congestion"] == "moderado"
    assert state["capture_age_seconds"] is None
    assert state["data_quality"]["synthetic"]
    assert state["probable_causes"] == []
    assert "track_id" not in str(state)


def test_count_by_class_lane_and_direction_deduplicates_jitter(config):
    analytics = Analytics(config)
    analytics.update(frame(0), [vehicle(1, y=240), vehicle(2, x=430, y=240, kind="moto"), vehicle(3, x=450, y=240, kind="camion")], HEALTHY)
    crossed = analytics.update(frame(.2), [vehicle(1, y=260), vehicle(2, x=430, y=260, kind="moto"), vehicle(3, x=450, y=260, kind="camion")], HEALTHY)
    assert crossed["total_count"] == 3
    assert lane(crossed)["counts_by_class"]["carro"] == 1
    assert lane(crossed, "lane-2")["counts_by_class"]["moto"] == 1
    assert lane(crossed, "lane-2")["counts_by_class"]["camion"] == 1
    analytics.update(frame(.4), [vehicle(1, y=245)], HEALTHY)
    again = analytics.update(frame(.6), [vehicle(1, y=255)], HEALTHY)
    assert again["total_count"] == 3
    assert lane(crossed)["counts_by_class"]["carro"] == 1  # returned snapshot is independent


def test_reverse_crossing_and_track_first_seen_downstream_are_not_counts(config):
    analytics = Analytics(config)
    analytics.update(frame(0), [vehicle(y=270)], HEALTHY)
    analytics.update(frame(.2), [vehicle(y=240)], HEALTHY)
    state = analytics.update(frame(.4), [vehicle(2, y=270)], HEALTHY)
    assert state["total_count"] == 0


def test_continuous_slow_crossing_keeps_anchor_during_hysteresis_band(config):
    analytics = Analytics(config)
    for index, y in enumerate([247, 248, 249, 250, 251, 252.5]):
        state = analytics.update(frame(index * .2), [vehicle(y=y)], HEALTHY)
    assert state["total_count"] == 1


def test_crossing_is_assigned_to_lane_at_intersection(config):
    analytics = Analytics(config)
    analytics.update(frame(0), [vehicle(x=200, y=200)], HEALTHY)
    state = analytics.update(frame(.6), [vehicle(x=430, y=260)], HEALTHY)
    assert lane(state)["count"] == 0
    assert lane(state, "lane-2")["count"] == 1


def test_empty_scene_has_zero_valid_counts_but_no_speed(config):
    analytics = Analytics(config)
    analytics.update(frame(0), [], HEALTHY)
    state = analytics.update(frame(.2), [], HEALTHY)
    assert state["total_count"] == 0
    assert state["mean_speed_kmh"] is None
    assert state["congestion"] == "desconocido"
    assert not state["speed_valid"]


def test_unconfigured_camera_does_not_invent_metric_speed(config):
    payload = config.model_dump(mode="json")
    payload["calibration"] = {"status": "unconfigured"}
    payload["capability_gates"]["metric_speed_enabled"] = False
    unconfigured = CameraConfig.model_validate(payload)
    analytics = Analytics(unconfigured)
    for index in range(7):
        state = analytics.update(frame(index * .2), [vehicle(y=80 + index * 5)], HEALTHY)
    assert not state["speed_valid"]
    assert state["mean_speed_kmh"] is None
    assert "calibration_unconfigured" in state["data_quality"]["reasons"]
    assert state["count_valid"]  # pixel count geometry still explicitly configured


def test_recomputes_independent_error_instead_of_trusting_declared_zero(config):
    payload = config.model_dump(mode="json")
    for control in payload["calibration"]["independent_control_points"]:
        control["ground_m"][1] += 5
    bad = CameraConfig.model_validate(payload)
    analytics = Analytics(bad)
    state = analytics.update(frame(0), [vehicle()], HEALTHY)
    assert state["calibration_status"] == "invalid"
    assert state["calibration_rmse_metres"] == pytest.approx(5, abs=.01)
    assert not state["speed_valid"]
    assert "independent_control_error" in state["data_quality"]["reasons"]


def test_bad_pts_quality_and_frame_size_cannot_report_stopped(config):
    analytics = Analytics(config)
    for index in range(7):
        analytics.update(frame(index * .2), [vehicle()], HEALTHY)
    missing = analytics.update(frame(None), [vehicle()], HEALTHY)
    assert missing["mean_speed_kmh"] is None and missing["total_count"] is None
    assert missing["congestion"] == "desconocido"
    assert "media_pts_unavailable" in missing["data_quality"]["reasons"]
    wrong_size = analytics.update(frame(2, shape=(720, 1280, 3)), [vehicle()], HEALTHY)
    assert not wrong_size["count_valid"]
    assert not wrong_size["speed_valid"]
    unavailable = analytics.update(frame(2.2), [vehicle()], {"status": "scene_changed", "usable_for_analytics": False})
    assert unavailable["total_count"] is None
    assert unavailable["congestion"] == "desconocido"


def test_healthy_image_can_count_while_speed_quality_is_disabled(config):
    analytics = Analytics(config)
    health = {"status": "degraded", "usable_for_analytics": True, "usable_for_speed": False}
    analytics.update(frame(0), [vehicle(y=240)], health)
    state = analytics.update(frame(.2), [vehicle(y=260)], health)
    assert state["total_count"] == 1
    assert not state["speed_valid"]


def test_negative_direction_is_not_zero_speed_or_traffic_stopped(config):
    analytics = Analytics(config)
    for index in range(7):
        state = analytics.update(frame(index * .2), [vehicle(y=180 - 40 * index * .2)], HEALTHY)
    assert lane(state)["opposite_direction_observations"] == 1
    assert state["mean_speed_kmh"] is None
    assert state["congestion"] == "desconocido"


def test_stationary_requires_persistence_and_noisy_points_do_not_accumulate_distance(config):
    analytics = Analytics(config)
    for index in range(160):
        state = analytics.update(frame(index * .2), [vehicle(y=130 + (.03 if index % 2 else -.03))], HEALTHY)
        if index == 100:
            assert state["congestion"] != "detenido"
    assert state["mean_speed_kmh"] < .05
    assert state["congestion"] == "detenido"
    empty = analytics.update(frame(32), [], HEALTHY)
    assert empty["congestion"] == "desconocido"


def test_history_full_snapshots_are_idempotent_and_gaps_not_counted_as_coverage(config):
    analytics = Analytics(config)
    analytics.update(frame(0), [vehicle(y=240)], HEALTHY)
    analytics.update(frame(.2), [vehicle(y=260)], HEALTHY)
    first = analytics.flush_windows()
    assert sum(item["count"] for item in first) == 1
    assert analytics.flush_windows() == []
    state = analytics.update(frame(4), [vehicle(2, y=240)], HEALTHY)
    assert "observation_gap" in state["data_quality"]["reasons"]
    analytics.update(frame(4.2), [vehicle(2, y=260)], HEALTHY)
    next_rows = analytics.flush_windows()
    assert sum(item["count"] for item in next_rows) == 2
    assert all(item["coverage_seconds"] == pytest.approx(.4) for item in next_rows)
    assert all(item["partial"] for item in next_rows)
    assert sum(item["count"] for item in first) == 1
    analytics.update(frame(4.4, epoch="new-epoch"), [vehicle(2, y=270)], HEALTHY)
    assert analytics.flush_windows() == []


def test_late_hysteresis_crossing_updates_previous_bin_without_erasing_counts(config):
    analytics = Analytics(config)
    analytics.update(frame(59.2), [vehicle(1, y=240), vehicle(2, y=240)], HEALTHY)
    analytics.update(frame(59.4), [vehicle(1, y=260), vehicle(2, y=247)], HEALTHY)
    assert sum(row["count"] for row in analytics.flush_windows()) == 1
    analytics.update(frame(59.6), [vehicle(2, y=248)], HEALTHY)
    analytics.update(frame(59.8), [vehicle(2, y=249)], HEALTHY)
    analytics.update(frame(60), [vehicle(2, y=251)], HEALTHY)
    analytics.flush_windows()
    analytics.update(frame(60.2), [vehicle(2, y=253)], HEALTHY)
    rows = analytics.flush_windows()
    assert next(row for row in rows if row["lane_id"] == "lane-1" and row["bin_start_s"] == 0)["count"] == 2


def test_finite_negative_media_preroll_is_relative_time_not_a_missing_clock(config):
    analytics = Analytics(config)
    for index in range(7):
        t = -1.2 + index * .2
        state = analytics.update(frame(t), [vehicle(y=70 + (100 / 3) * (t + 1.2))], HEALTHY)
    assert state["mean_speed_kmh"] == pytest.approx(20, abs=.01)
    assert "media_pts_discontinuity" not in state["data_quality"]["reasons"]


def test_positions_beyond_configured_longitudinal_axis_do_not_become_zero_speed(config):
    payload = config.model_dump(mode="json")
    for lane_config in payload["lanes"]:
        lane_config["centerline_ground_m"][1][1] = 5
    shortened = CameraConfig.model_validate(payload)
    analytics = Analytics(shortened)
    for index in range(160):
        state = analytics.update(frame(index * .2), [vehicle(y=150)], HEALTHY)
    assert state["mean_speed_kmh"] is None
    assert state["congestion"] == "desconocido"
