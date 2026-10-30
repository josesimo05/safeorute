from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from traffic_its.api import create_app
from traffic_its.store import delivery


@pytest.fixture
def app(tmp_path):
    return create_app(f'sqlite:///{tmp_path}/api.db',token='operator-test-secret',demo=True,
        allowed_origins=['https://safeorute.vercel.app'])


def seed(app):
    db=app.state.store
    base={'received_at':datetime.now(timezone.utc).isoformat(),'health':{'status':'healthy'},'lanes':[]}
    db.save_state('demo-camera',{**base,'source_mode':'demo','road_segment_id':'demo-road','mean_speed_kmh':None})
    db.save_state('live-camera',{**base,'source_mode':'live','road_segment_id':'live-road','mean_speed_kmh':20})
    db.relay_pending()


def test_demo_is_readonly_and_never_exposes_live_camera(app):
    with TestClient(app) as client:
        seed(app)
        public=client.get('/v1/snapshot').json()
        assert [item['camera_id'] for item in public['states']]==['demo-camera']
        assert client.get('/v1/cameras/live-camera/health').status_code==404
        assert client.get('/v1/segments/live-road/state').status_code==404
        assert client.get('/v1/snapshot',headers={'Authorization':'Bearer wrong'}).status_code==401
        private=client.get('/v1/snapshot',headers={'Authorization':'Bearer operator-test-secret'}).json()
        assert len(private['states'])==2
        assert client.post('/v1/alerts/unknown/review',json={'action':'acknowledge'}).status_code==401
        assert client.get('/healthz').status_code==200 and client.get('/readyz').status_code==200


def test_non_demo_requires_a_configured_token(tmp_path):
    with pytest.raises(RuntimeError):create_app(f'sqlite:///{tmp_path}/prod.db',token='',demo=False)
    app=create_app(f'sqlite:///{tmp_path}/prod.db',token='secret',demo=False)
    with TestClient(app) as client:
        assert client.get('/v1/cameras').status_code==401
        assert client.get('/v1/cameras',headers={'Authorization':'Bearer secret'}).status_code==200
    with pytest.raises(RuntimeError):create_app(token='a',demo=False,allowed_origins=['*'])


def test_operator_acknowledges_without_resolving_or_publishing(app):
    with TestClient(app) as client:
        alert_id=str(uuid4())
        app.state.store.save_state('demo',{'source_mode':'demo'},alerts=[{'alert_id':alert_id,'status':'open','observed':[]}])
        response=client.post(f'/v1/alerts/{alert_id}/review',json={'action':'acknowledge'},
            headers={'Authorization':'Bearer operator-test-secret'})
        assert response.status_code==200
        assert response.json()['status']=='open' and response.json()['acknowledged']
        assert response.json()['publication']['public_approved'] is False


def test_websocket_authentication_replay_and_private_filtering(app):
    with TestClient(app) as client:
        seed(app)
        with client.websocket_connect('/v1/stream',headers={'Origin':'https://safeorute.vercel.app'}) as ws:
            ws.send_json({'cursor':'0'})
            assert ws.receive_json()['event_type']=='stream.ready'
            event=ws.receive_json()
            assert event['event_type']=='camera.state.updated'
            assert event['payload']['camera_id']=='demo-camera'
            assert event['cursor']=='1'
        with client.websocket_connect('/v1/stream') as ws:
            ws.send_json({'token':'operator-test-secret','cursor':'1'})
            assert ws.receive_json()['event_type']=='stream.ready'
            assert ws.receive_json()['payload']['camera_id']=='live-camera'


def test_websocket_rejects_untrusted_origin_and_query_token(app):
    from starlette.websockets import WebSocketDisconnect
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/v1/stream',headers={'Origin':'https://evil.invalid'}):pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/v1/stream?token=operator-test-secret'):pass
        with client.websocket_connect('/v1/stream') as ws:
            ws.send_json({'token':'wrong'})
            with pytest.raises(WebSocketDisconnect):ws.receive_json()


def test_expired_cursor_returns_410_and_ws_resync(app):
    with TestClient(app) as client:
        seed(app)
        with app.state.store._write() as conn:
            conn.execute(update(delivery).values(created_at=datetime.now(timezone.utc)-timedelta(days=8)))
        app.state.store.prune()
        assert client.get('/v1/events?cursor=0').status_code==410
        with client.websocket_connect('/v1/stream') as ws:
            ws.send_json({'cursor':'0'})
            assert ws.receive_json()['event_type']=='resync_required'
        assert client.get('/v1/snapshot').json()['cursor']=='2'


def test_history_queries_are_bounded_and_invalid_cursors_do_not_leak_config(app):
    with TestClient(app) as client:
        seed(app)
        assert client.get('/v1/metrics/history?limit=501').status_code==422
        assert client.get('/v1/metrics/history?start=2026-10-01T00:00:00&end=2026-10-02T00:00:00Z').status_code==422
        assert client.get('/v1/events?cursor=-1').status_code==422
        assert client.get('/v1/events?cursor=999').status_code==400
        body=client.get('/v1/snapshot').text
        assert 'operator-test-secret' not in body and 'rtsp://' not in body


def test_stale_congestion_is_visible_as_unconfirmed_not_resolved_in_rest_and_ws(app):
    old=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
    alert_id=str(uuid4())
    with TestClient(app) as client:
        app.state.store.save_state('demo',{'source_mode':'demo','received_at':old,
            'congestion':'denso','mean_speed_kmh':3,'speed_valid':True,'count_valid':True,
            'health':{'status':'healthy','usable_for_analytics':True,'usable_for_speed':True},'lanes':[]},
            alerts=[{'alert_id':alert_id,'kind':'congestion_observed','status':'open',
                     'updated_at':old,'observed':[{'description':'Velocidad reducida observada.'}]}])
        app.state.store.relay_pending()
        detail=client.get(f'/v1/alerts/{alert_id}').json()
        assert detail['observation_status'] == 'stale'
        assert detail['observation_stale'] is True
        assert detail['status'] == 'open'
        assert detail['updated_at'] == old
        assert client.get('/v1/alerts').json()['items'][0]['observation_stale'] is True
        assert client.get('/v1/snapshot').json()['alerts'][0]['observation_stale'] is True
        current=client.get('/v1/snapshot').json()['states'][0]
        assert not current['count_valid'] and not current['speed_valid']
        assert not current['health']['usable_for_analytics']
        assert not current['health']['usable_for_speed']
        health=client.get('/v1/cameras/demo/health').json()
        assert health['stale'] and not health['health']['usable_for_analytics']
        with client.websocket_connect('/v1/stream') as ws:
            ws.send_json({'cursor':'0'})
            assert ws.receive_json()['event_type'] == 'stream.ready'
            assert ws.receive_json()['event_type'] == 'camera.state.updated'
            event=ws.receive_json()
            assert event['event_type'] == 'alert.updated'
            assert event['payload']['status'] == 'open'
            assert event['payload']['observation_stale'] is True
            assert event['payload']['updated_at'] == old


def test_anonymous_demo_never_reads_reused_camera_physical_metadata(app):
    with TestClient(app) as client:
        seed(app)
        app.state.store.upsert_camera({'camera_id':'demo-camera','source':{'kind':'rtsp','mode':'live'},
            'location':{'latitude':18.45,'longitude':-69.96},'name':'cámara física privada'})
        assert 'cámara física privada' not in client.get('/v1/snapshot').text
        assert 'cámara física privada' not in client.get('/v1/cameras').text
        assert 'cámara física privada' in client.get('/v1/cameras',
            headers={'Authorization':'Bearer operator-test-secret'}).text
