from datetime import UTC, datetime
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from traffic_its.domain import Detection, VideoFrame
from traffic_its.vision import ByteTrackTracker, SyntheticDetector, YoloXDetector, _nms, synthetic_objects


def frame(time):
    return VideoFrame(np.zeros((360, 640, 3), dtype=np.uint8), time, "epoch", datetime.now(UTC), time)


def test_synthetic_detector_is_explicit_ground_truth_and_has_known_motion():
    detector = SyntheticDetector()
    first = detector.detect(frame(1))[0]
    second = detector.detect(frame(1.2))[0]
    assert detector.backend == "synthetic_ground_truth"
    assert second.xyxy[3] - first.xyxy[3] == pytest.approx(10)
    assert (second.xyxy[3] - first.xyxy[3]) / .2 / 6 * 3.6 == pytest.approx(30)
    assert detector.detect(frame(-1)) == []


def test_slow_fixture_vehicle_survives_to_cross_counting_line_without_wrapping():
    detector = SyntheticDetector(SimpleNamespace(source=SimpleNamespace(synthetic_speed_kmh=8)))
    # The first car reaches y=250 at 17.25 s; the old eight-second retention
    # would remove it long before crossing and leave aforo permanently at zero.
    before = detector.detect(frame(17.2))[0]
    after = detector.detect(frame(17.4))[0]
    assert before.class_id == after.class_id == 2
    assert before.xyxy[0] == after.xyxy[0]
    assert before.xyxy[3] < 250 < after.xyxy[3]
    assert after.xyxy[3] - before.xyxy[3] == pytest.approx(.2 * 8 / 3.6 * 6)
    assert len(synthetic_objects(10**6, speed_kmh=8)) <= 60


def test_slow_fixture_produces_real_tracker_crossings_and_eight_kmh_measurements():
    from traffic_its.analytics import Analytics
    from traffic_its.config import CameraConfig

    payload = json.loads((Path(__file__).parents[1] / 'configs/demo.json').read_text())
    payload['source']['synthetic_speed_kmh'] = 8
    config = CameraConfig.model_validate(payload)
    detector = SyntheticDetector(config)
    tracker = ByteTrackTracker(5)
    analytics = Analytics(config)
    health = {'status': 'healthy', 'usable_for_analytics': True, 'usable_for_speed': True}
    for index in range(126):
        sample = frame(index / 5)
        result = analytics.update(sample, tracker.update(detector.detect(sample)), health)
    assert result['speed_valid'] and result['mean_speed_kmh'] == pytest.approx(8, abs=.1)
    assert result['total_count'] == 4
    assert result['congestion'] == 'denso'
    assert config.processing.free_flow_speed_kmh == 40


def test_bytetrack_preserves_id_and_never_emits_prediction_as_observation():
    tracker = ByteTrackTracker(5)
    rows = []
    for step in range(6):
        rows.append(tracker.update([Detection((100, 50 + 2 * step, 150, 80 + 2 * step), .99, 2)]))
    observed = [row[0] for row in rows if row]
    assert len(observed) >= 4
    assert len({track.track_id for track in observed}) == 1
    assert observed[-1].point_px == (125, 90)
    assert observed[-1].class_name == "carro"
    assert tracker.update([]) == []
    tracker.reset()
    assert tracker.update([]) == []


def test_tracker_rejects_unsupported_classes_and_invalid_boxes():
    tracker = ByteTrackTracker(5)
    assert tracker.update([Detection((0, 0, 20, 30), .9, 0), Detection((20, 20, 0, 0), .9, 2)]) == []


def test_nms_suppresses_overlapping_boxes_but_keeps_distinct_vehicle():
    boxes = np.asarray([[0, 0, 20, 20], [1, 1, 21, 21], [100, 100, 130, 130]], dtype=float)
    assert _nms(boxes, np.asarray([.9, .8, .7]), .45) == [0, 2]


def test_real_official_onnx_smoke_when_model_available():
    model = Path(__file__).parents[1] / "models" / "yolox_nano.onnx"
    if not model.exists():
        pytest.skip("Descargar el modelo oficial fijado para ejecutar el smoke test ONNX.")
    manifest_path = model.parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    detector = YoloXDetector(model)
    result = detector.detect(frame(0))
    assert detector.backend == "yolox_onnx_cpu"
    assert len(detector.model_sha256) == 64
    assert isinstance(result, list)
    assert all(d.class_id in {2, 3, 5, 7} for d in result)
    with pytest.raises(ValueError, match="SHA-256"):
        YoloXDetector(model, expected_sha256="0" * 64)
