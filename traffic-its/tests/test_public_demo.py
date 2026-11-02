"""El despliegue público nunca hereda acceso a datos operativos."""
import os

import pytest
from fastapi.testclient import TestClient

from traffic_its.api import create_app
from traffic_its.cli import demo_config
from traffic_its.public_demo import isolated_environment, public_settings


def test_public_host_uses_exact_https_origin_and_dynamic_port():
    assert public_settings({'RENDER_EXTERNAL_URL': 'https://demo.example.test/', 'PORT': '10001'}) == {
        'origin': 'https://demo.example.test', 'port': 10001, 'scenario': 'congestion'}


@pytest.mark.parametrize('origin', ['', 'http://demo.test', 'https://user:secret@demo.test',
                                  'https://demo.test/path', 'https://demo.test?token=bad',
                                  'https://demo.test#bad', 'https://demo.test:invalid',
                                  'https://[invalid', 'https://demo\n.test', 'https://demo\\test'])
def test_unsafe_or_missing_public_origin_is_rejected(origin):
    with pytest.raises(ValueError):
        public_settings({'ITS_PUBLIC_ORIGIN': origin})


@pytest.mark.parametrize('updates', [{'PORT':'0'}, {'PORT':'65536'}, {'PORT':'invalid'},
                                  {'ITS_DEMO_SCENARIO':'real_camera'}])
def test_invalid_public_runtime_settings_rejected(updates):
    with pytest.raises(ValueError):
        public_settings({'ITS_PUBLIC_ORIGIN': 'https://demo.test', **updates})


def test_public_runtime_ignores_existing_operator_source_and_database(tmp_path, monkeypatch):
    monkeypatch.setenv('ITS_API_TOKEN', 'private-operator-test')
    monkeypatch.setenv('ITS_DATABASE_URL', 'sqlite:///private-test.db')
    monkeypatch.setenv('ITS_CAMERA_SOURCE', 'rtsp://user:secret@camera.example.test')
    settings=public_settings({'ITS_PUBLIC_ORIGIN': 'https://demo.example.test'})
    with isolated_environment(settings, str(tmp_path)):
        assert os.environ['ITS_API_TOKEN'] == ''
        assert os.environ['ITS_CAMERA_SOURCE'] == ''
        assert os.environ['ITS_ALLOWED_ORIGINS'] == settings['origin']
        app=create_app()
        with TestClient(app) as client:
            snapshot=client.get('/v1/snapshot')
            assert snapshot.status_code == 200
            assert snapshot.json()['demo'] is True
            assert snapshot.json()['capabilities']['operator_review'] is False
            response=client.post('/v1/alerts/unknown/review',json={'action':'acknowledge'},
                headers={'Authorization':'Bearer private-operator-test'})
            assert response.status_code == 401
            with client.websocket_connect('/v1/stream', headers={'Origin':settings['origin']}) as ws:
                ws.send_json({'cursor':'0'})
                assert ws.receive_json()['event_type'] == 'stream.ready'
    assert os.environ['ITS_API_TOKEN'] == 'private-operator-test'
    assert os.environ['ITS_DATABASE_URL'] == 'sqlite:///private-test.db'


def test_congestion_scenario_moves_vehicles_and_keeps_reference_unchanged():
    config=demo_config('congestion')
    assert config.source.kind == 'synthetic'
    assert config.source.synthetic_speed_kmh == 8
    assert config.processing.free_flow_speed_kmh == 40
    assert demo_config('fluido').source.synthetic_speed_kmh == 30
    with pytest.raises(ValueError):
        demo_config('accident')
