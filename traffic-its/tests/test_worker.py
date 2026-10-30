"""Integración real del pipeline sintético y controles de fuentes reales."""
import json
from pathlib import Path
from threading import Event
from datetime import UTC, datetime

import pytest

from traffic_its.config import load_camera_config, public_config
from traffic_its.store import LeaseUnavailable, Store
from traffic_its.worker import ObservedAlerts, build_detector, run_worker

ROOT = Path(__file__).resolve().parents[1]


def test_synthetic_pipeline_counts_speed_and_durable_delivery(tmp_path):
    config = load_camera_config(ROOT / 'configs/demo.json')
    store = Store('sqlite:///' + str(tmp_path/'pipeline.db'))
    result = run_worker(config, store, Event(), duration=6.5, publish_interval=.2)
    assert result['source_mode'] == 'demo'
    assert result['detector_backend'] == 'synthetic_ground_truth'
    assert result['capture_age_seconds'] is None
    assert result['speed_valid']
    assert result['mean_speed_kmh'] == pytest.approx(30, abs=.5)
    assert result['congestion'] == 'fluido'
    assert result['total_count'] >= 1
    assert not result['public_alerts_enabled']
    assert store.history(config.camera_id)
    assert store.relay_pending() > 0
    events = store.events_after(0)
    assert events and events[-1]['event_type'] == 'camera.state.updated'
    serialized = json.dumps(events)
    for private_field in ['track_id', 'xyxy', 'source_uri', 'password']:
        assert private_field not in serialized
    # A normal stop relinquishes camera ownership.
    token = store.acquire_camera_lease(config.camera_id, 'replacement-worker', ttl=10)
    assert token > 0


def test_real_source_cannot_fall_back_to_synthetic(monkeypatch):
    config = load_camera_config(ROOT / 'configs/file.json')
    monkeypatch.delenv('ITS_MODEL_PATH', raising=False)
    with pytest.raises(ValueError, match='ITS_MODEL_PATH'):
        build_detector(config)


def test_alerts_separate_observation_from_unproven_cause():
    controller = ObservedAlerts()
    state = {'camera_id':'cam-test', 'road_segment_id':'road', 'source_mode':'replay',
             'media_time_s':0, 'congestion':'desconocido',
             'health':{'status':'no_frames','usable_for_analytics':False,'issues':['ingest_unavailable']}}
    opened = controller.update(state)
    assert len(opened) == 1
    assert opened[0]['probable_causes'][0]['confidence_level']=='bajo'
    assert opened[0]['probable_causes'][0]['code']=='undetermined'
    assert not opened[0]['publication']['public_approved']
    assert controller.update(state)==[]
    state['health']={'status':'healthy','usable_for_analytics':True}
    assert controller.update(state)[0]['status']=='resolved'


def test_lost_camera_expires_congestion_without_claiming_recovery():
    controller = ObservedAlerts()
    state = {'camera_id':'cam-test','source_mode':'demo','media_time_s':0,
             'congestion':'denso','mean_speed_kmh':8,
             'health':{'status':'healthy','usable_for_analytics':True}}
    assert controller.update(state)==[]
    state['media_time_s']=31
    assert controller.update(state)[0]['kind']=='congestion_observed'
    state['health']={'status':'no_frames','usable_for_analytics':False}
    ended=controller.update(state)
    assert next(a for a in ended if a['kind']=='congestion_observed')['status']=='expired'


def test_file_finished_is_not_a_camera_failure():
    controller=ObservedAlerts()
    state={'camera_id':'cam-test','source_mode':'replay','media_time_s':5,
           'congestion':'desconocido','health':{'status':'replay_finished','usable_for_analytics':False}}
    assert controller.update(state)==[]


def test_rejected_worker_does_not_replace_camera_metadata(tmp_path):
    config = load_camera_config(ROOT / 'configs/demo.json')
    store = Store('sqlite:///' + str(tmp_path/'exclusive.db'))
    original = public_config(config)
    store.upsert_camera(original)
    store.acquire_camera_lease(config.camera_id, 'active-worker', ttl=30)
    changed = config.model_copy(update={'location': config.location.model_copy(
        update={'city': 'Rejected replacement'})})
    with pytest.raises(LeaseUnavailable):
        run_worker(changed, store, duration=.1)
    assert store.list_cameras()[0]['location'] == original['location']


def test_persistent_quality_problem_alerts_without_inventing_cause():
    controller = ObservedAlerts()
    state = {'camera_id': 'cam-test', 'source_mode': 'replay', 'stream_epoch': 'one',
             'congestion': 'desconocido', 'media_time_s': 0,
             'health': {'status': 'degraded', 'usable_for_analytics': False,
                        'issues': ['view_low_texture_or_obstructed']}}
    assert controller.update(state, observed_monotonic=0) == []
    assert controller.update(state, observed_monotonic=4.9) == []
    opened = controller.update(state, observed_monotonic=5)
    assert opened[0]['kind'] == 'camera_health'
    assert opened[0]['observed'][0]['issues'] == ['view_low_texture_or_obstructed']
    assert opened[0]['probable_causes'][0]['code'] == 'undetermined'
    state['health'] = {'status': 'healthy', 'usable_for_analytics': True}
    assert controller.update(state, observed_monotonic=6)[0]['status'] == 'resolved'


@pytest.mark.parametrize('change', ['missing_speed', 'new_epoch'])
def test_observation_discontinuity_expires_congestion(change):
    controller = ObservedAlerts()
    state = {'camera_id': 'cam-test', 'source_mode': 'demo', 'stream_epoch': 'one',
             'congestion': 'denso', 'mean_speed_kmh': 8, 'speed_valid': True,
             'media_time_s': 0, 'health': {'status': 'healthy', 'usable_for_analytics': True}}
    assert controller.update(state) == []
    state['media_time_s'] = 31
    opened = controller.update(state)[0]
    if change == 'missing_speed':
        state.update(congestion='desconocido', mean_speed_kmh=None, speed_valid=False)
    else:
        state.update(stream_epoch='two', media_time_s=0)
    closed = controller.update(state)
    assert closed[0]['alert_id'] == opened['alert_id']
    assert closed[0]['status'] == 'expired'
