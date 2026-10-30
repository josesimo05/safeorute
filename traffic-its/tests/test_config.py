"""La configuración debe rechazar capacidades falsas y no divulgar fuentes."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from traffic_its.config import CameraConfig, load_camera_config, public_config

CONFIG_DIR = Path(__file__).parents[1] / "configs"


def demo_payload():
    return json.loads((CONFIG_DIR / "demo.json").read_text())


def test_demo_is_explicit_and_uses_known_synthetic_geometry():
    config = load_camera_config(CONFIG_DIR / "demo.json")
    assert config.source.kind == "synthetic" and config.source.mode == "demo"
    assert config.calibration.status == "synthetic"
    assert config.capability_gates.metric_speed_enabled
    assert config.capability_gates.lane_flow_enabled
    assert not config.capability_gates.specific_cause_publication_enabled
    assert len(config.calibration.independent_control_points) == 4
    assert config.processing.free_flow_reference == "manual_unvalidated"
    assert config.count_lines[0].lane_id == config.lanes[0].id


@pytest.mark.parametrize("name,kind,mode", [("file.json", "file", "replay"), ("rtsp.json", "rtsp", "live")])
def test_real_sources_never_invent_calibration_or_lane_flow(name, kind, mode):
    config = load_camera_config(CONFIG_DIR / name)
    assert config.road_segment_id == config.camera_id
    assert config.source.kind == kind and config.source.mode == mode
    assert config.source.uri_environment_variable == "ITS_CAMERA_SOURCE"
    assert config.calibration.status == "unconfigured"
    assert not config.capability_gates.metric_speed_enabled
    assert not config.capability_gates.lane_flow_enabled
    assert not config.source.public_alerts_enabled


@pytest.mark.parametrize("source", [
    {"kind": "synthetic", "mode": "live"},
    {"kind": "file", "mode": "live", "uri_environment_variable": "ITS_SOURCE"},
    {"kind": "rtsp", "mode": "replay", "uri_environment_variable": "ITS_SOURCE"},
    {"kind": "rtsp", "mode": "live"},
    {"kind": "synthetic", "mode": "demo", "uri_environment_variable": "ITS_SOURCE"},
])
def test_source_mode_and_secret_reference_are_consistent(source):
    payload = demo_payload()
    payload["source"] = source
    with pytest.raises(ValidationError):
        CameraConfig.model_validate(payload)


@pytest.mark.parametrize("field", ["store_video", "store_snapshots", "store_faces_or_plates", "store_persistent_vehicle_identifiers", "live_video_preview_enabled"])
def test_privacy_cannot_be_disabled_by_configuration(field):
    payload = demo_payload()
    payload["privacy"][field] = True
    with pytest.raises(ValidationError):
        CameraConfig.model_validate(payload)


@pytest.mark.parametrize("changes", [
    {"gps_fusion": {"enabled": True}},
    {"signal_context": {"available": True}},
    {"capability_gates": {"specific_cause_publication_enabled": True}},
])
def test_later_phases_and_public_causes_are_not_implicitly_enabled(changes):
    payload = demo_payload()
    payload.update(changes)
    with pytest.raises(ValidationError):
        CameraConfig.model_validate(payload)


def test_speed_requires_geometry_and_axis_not_just_an_enabled_flag():
    file_payload = json.loads((CONFIG_DIR / "file.json").read_text())
    file_payload["capability_gates"]["metric_speed_enabled"] = True
    with pytest.raises(ValidationError, match="calibración"):
        CameraConfig.model_validate(file_payload)
    payload = demo_payload()
    payload["lanes"][0]["centerline_ground_m"] = []
    with pytest.raises(ValidationError, match="ejes"):
        CameraConfig.model_validate(payload)


def test_metric_cadence_is_checked_only_when_speed_is_enabled():
    payload = demo_payload()
    payload["processing"]["target_processed_fps"] = 1
    with pytest.raises(ValidationError, match="cadencia"):
        CameraConfig.model_validate(payload)
    payload["capability_gates"]["metric_speed_enabled"] = False
    assert CameraConfig.model_validate(payload).processing.target_processed_fps == 1


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_coordinates_never_reach_geometry(bad_value):
    payload = demo_payload()
    payload["calibration"]["fit_points_image_px"][0][0] = bad_value
    with pytest.raises(ValidationError):
        CameraConfig.model_validate(payload)


def test_collinear_and_reused_reference_points_are_rejected():
    payload = demo_payload()
    payload["calibration"]["fit_points_image_px"] = [[0, 0], [10, 10], [20, 20], [30, 30]]
    with pytest.raises(ValidationError, match="colineales"):
        CameraConfig.model_validate(payload)
    payload = demo_payload()
    payload["calibration"]["independent_control_points"][0] = {"image_px": payload["calibration"]["fit_points_image_px"][0], "ground_m": [2, 3]}
    with pytest.raises(ValidationError, match="distintos"):
        CameraConfig.model_validate(payload)


def test_invalid_calibration_or_line_and_lane_references_are_rejected():
    payload = demo_payload()
    payload["calibration"]["validation_rmse_metres"] = 0.6
    with pytest.raises(ValidationError, match="0,5"):
        CameraConfig.model_validate(payload)
    payload = demo_payload()
    payload["count_lines"][0]["lane_id"] = "missing-lane"
    with pytest.raises(ValidationError, match="pertenecer"):
        CameraConfig.model_validate(payload)
    payload = demo_payload()
    payload["count_lines"][0]["points_image_px"][0] = [1, 250]
    with pytest.raises(ValidationError, match="dentro"):
        CameraConfig.model_validate(payload)


def test_repeating_one_control_point_does_not_create_independent_validation():
    payload = demo_payload()
    point = payload["calibration"]["independent_control_points"][0]
    payload["calibration"]["independent_control_points"] = [point] * 4
    with pytest.raises(ValidationError, match="control distintos"):
        CameraConfig.model_validate(payload)


def test_synthetic_calibration_cannot_be_used_for_real_video():
    payload = demo_payload()
    payload["source"] = {"kind": "file", "mode": "replay", "uri_environment_variable": "ITS_SOURCE"}
    with pytest.raises(ValidationError, match="sintética"):
        CameraConfig.model_validate(payload)


def test_public_config_does_not_resolve_or_disclose_source_environment(monkeypatch):
    config = load_camera_config(CONFIG_DIR / "rtsp.json")
    monkeypatch.setenv("ITS_CAMERA_SOURCE", "rtsp://secret-user:secret-password@private-camera/stream")
    result = public_config(config)
    rendered = json.dumps(result)
    assert "secret-user" not in rendered and "secret-password" not in rendered
    assert "ITS_CAMERA_SOURCE" not in rendered and "uri_environment_variable" not in rendered
    assert result["source"] == {"kind": "rtsp", "mode": "live", "public_alerts_enabled": False}
    assert "fit_points_image_px" not in result["calibration"]


def test_design_template_has_a_clear_error_instead_of_running(tmp_path):
    path = tmp_path / "camera.json"
    path.write_text(json.dumps({"schema_version": "1.0-design", "design_template_only": True}))
    with pytest.raises(ValueError, match="plantilla de diseño"):
        load_camera_config(path)


def test_validation_errors_omit_sensitive_input_values(tmp_path):
    path = tmp_path / "camera.json"
    payload = demo_payload()
    payload["source"]["uri"] = "rtsp://secret-user:secret-password@private-camera/stream"
    path.write_text(json.dumps(payload))
    with pytest.raises(ValueError) as error:
        load_camera_config(path)
    assert "source.uri" in str(error.value)
    assert "secret-password" not in str(error.value)
    assert "private-camera" not in str(error.value)
