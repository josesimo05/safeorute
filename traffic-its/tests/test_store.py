from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.engine import make_url

from traffic_its.store import (CursorAhead, CursorExpired, LeaseUnavailable, Store,
    alerts_table, counter, delivery, outbox, safe_json)


def state(mode='demo', **changes):
    return {'source_mode':mode,'received_at':datetime.now(timezone.utc).isoformat(),
        'stream_epoch':'epoch-a','road_segment_id':'road','mean_speed_kmh':None,
        'speed_valid':False,'congestion':'desconocido','health':{'status':'healthy'},
        'lanes':[], **changes}


@pytest.fixture
def store(tmp_path):
    instance=Store(f'sqlite:///{tmp_path}/test.db')
    instance.initialize()
    return instance


def test_outbox_is_committed_but_not_delivered_until_relay(store):
    store.save_state('camera',state())
    assert store.events_after()==[]
    assert store.get_state('camera')['revision']==1
    assert store.relay_pending()==1
    event=store.events_after()[0]
    assert event['cursor']=='1' and event['revision']==1
    assert event['payload']['camera_id']=='camera'
    assert store.relay_pending()==0
    assert len(store.events_after())==1


def test_concurrent_relays_do_not_duplicate_committed_events(tmp_path):
    url=f'sqlite:///{tmp_path}/concurrent.db'
    first,second=Store(url),Store(url)
    first.initialize();second.initialize()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i:first.save_state('camera',state(sequence=i)), range(20)))
    with ThreadPoolExecutor(max_workers=2) as pool:
        counts=list(pool.map(lambda db:db.relay_pending(),[first,second]))
    assert sum(counts)==20
    events=first.events_after()
    assert [event['revision'] for event in events]==list(range(1,21))
    assert [int(event['cursor']) for event in events]==list(range(1,21))
    assert len({event['event_id'] for event in events})==20


def test_history_replaces_the_same_window_instead_of_incrementing(store):
    window={'lane_id':'lane-1','stream_epoch':'epoch-a','bin_start_s':0.,'count':2}
    store.save_state('camera',state(),[window])
    store.save_state('camera',state(),[{**window,'count':3}])
    assert len(store.history())==1
    assert store.history()[0]['count']==3
    store.save_state('camera',state(stream_epoch='epoch-b'),[{**window,'stream_epoch':'epoch-b'}])
    assert len(store.history())==2


def test_privacy_violation_rolls_back_without_outbox(store):
    for payload in [state(track_id=7),state(detail='rtsp://user:password@private/video'),state(image=b'private'),state(api_key='private'),state(detail='https://user:password@private/video')]:
        with pytest.raises(ValueError):store.save_state('camera',payload)
    assert store.list_cameras()==[]
    assert store.relay_pending()==0
    assert safe_json({'privacy':{'store_video':False}})=={'privacy':{'store_video':False}}


def test_snapshot_and_anonymous_demo_exclude_live_data(store):
    store.upsert_camera({'camera_id':'demo-camera','source':{'kind':'synthetic'}})
    store.upsert_camera({'camera_id':'private-camera','source':{'kind':'rtsp'}})
    store.save_state('demo-camera',state())
    store.save_state('private-camera',state('live',mean_speed_kmh=30))
    store.relay_pending()
    result=store.snapshot(demo_only=True)
    assert [camera['camera_id'] for camera in result['cameras']]==['demo-camera']
    assert [item['camera_id'] for item in result['states']]==['demo-camera']
    assert all(event['payload']['source_mode']=='demo' for event in store.events_after(demo_only=True))
    assert store.get_state('private-camera',demo_only=True) is None


def test_real_metadata_never_becomes_public_through_an_old_demo_state(store):
    store.upsert_camera({'camera_id':'reused-camera','source':{'kind':'synthetic','mode':'demo'},
                         'location':{'city':'ubicación ficticia'}})
    store.save_state('reused-camera',state())
    assert len(store.list_cameras(demo_only=True)) == 1
    store.upsert_camera({'camera_id':'reused-camera','source':{'kind':'rtsp','mode':'live'},
                         'location':{'city':'ubicación real privada'}})
    assert store.list_cameras(demo_only=True) == []
    public = store.snapshot(demo_only=True)
    assert public['cameras'] == []
    assert public['states'][0]['source_mode'] == 'demo'
    assert 'ubicación real privada' not in str(public)
    assert store.list_cameras()[0]['location']['city'] == 'ubicación real privada'


def test_stale_observations_are_unknown_not_stopped_or_fresh(store):
    old=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
    store.save_state('camera',state(received_at=old,mean_speed_kmh=20,speed_valid=True,congestion='fluido',
        lanes=[{'id':'a','mean_speed_kmh':20,'count_valid':True,'speed_valid':True}]))
    current=store.get_state('camera')
    assert current['stale'] and current['mean_speed_kmh'] is None
    assert current['congestion']=='desconocido' and current['capture_age_seconds'] is None
    assert current['lanes'][0]['count_valid'] is False


def test_stale_congestion_alert_remains_open_with_explicit_observation_age(store):
    old=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
    alert_id=str(uuid4())
    alert={'alert_id':alert_id,'kind':'congestion_observed','status':'open',
           'stream_epoch':'epoch-a','opened_at':old,'updated_at':old,'observed':[]}
    store.save_state('camera',state(received_at=old,mean_speed_kmh=5,speed_valid=True,
                                   congestion='denso'),alerts=[alert])
    store.relay_pending()
    all_views=[store.get_alert(alert_id),store.list_alerts()[0],store.snapshot()['alerts'][0],
               next(event['payload'] for event in store.events_after() if event['event_type']=='alert.updated')]
    for view in all_views:
        assert view['status'] == 'open'
        assert view['observation_stale'] is True
        assert view['observation_status'] == 'stale'
        assert view['last_observation_received_at'] == old
        assert view['observation_age_seconds'] >= 120
        assert view['updated_at'] == old
        assert view['revision'] == 1


def test_alert_freshness_requires_observation_from_the_same_source_and_epoch(store):
    alert_id=str(uuid4())
    alert={'alert_id':alert_id,'kind':'congestion_observed','status':'open',
           'stream_epoch':'epoch-a','observed':[]}
    store.save_state('camera',state(mean_speed_kmh=5,speed_valid=True,congestion='denso'),alerts=[alert])
    assert store.get_alert(alert_id)['observation_status'] == 'current'
    store.save_state('camera',state(mean_speed_kmh=None,speed_valid=False,congestion='desconocido'))
    assert store.get_alert(alert_id)['observation_status'] == 'unavailable'
    assert store.get_alert(alert_id)['status'] == 'open'
    store.save_state('camera',state(mean_speed_kmh=5,speed_valid=True,congestion='denso',stream_epoch='epoch-b'))
    changed=store.get_alert(alert_id)
    assert changed['observation_status'] == 'unavailable'
    assert changed['last_observation_received_at'] is None
    store.save_state('camera',state('live',mean_speed_kmh=5,speed_valid=True,congestion='denso'))
    public=store.get_alert(alert_id,demo_only=True)
    assert public['observation_status'] == 'unavailable'
    assert public['last_observation_received_at'] is None


def test_expired_cursor_requires_resync_but_snapshot_still_works(store):
    store.save_state('camera',state());store.relay_pending()
    with store._write() as conn:
        conn.execute(update(delivery).values(created_at=datetime.now(timezone.utc)-timedelta(days=9)))
    store.prune(event_days=7)
    with pytest.raises(CursorExpired):store.events_after(0)
    assert store.snapshot()['cursor']=='1'
    store.save_state('camera',state());store.relay_pending()
    assert store.events_after(1)[0]['cursor']=='2'
    with pytest.raises(CursorAhead):store.events_after(3)


def test_review_is_a_revision_and_acknowledgment_does_not_resolve(store):
    alert_id=str(uuid4())
    store.save_state('camera',state(),alerts=[{'alert_id':alert_id,'status':'open',
        'observed':[{'fact_code':'no_frames'}],'probable_causes':[],
        'publication':{'public_approved':True}}])
    reviewed=store.review_alert(alert_id,'acknowledge')
    assert reviewed['revision']==2 and reviewed['status']=='open'
    assert reviewed['acknowledged'] and not reviewed['publication']['public_approved']
    resolved=store.review_alert(alert_id,'resolve')
    assert resolved['status']=='resolved' and resolved['revision']==3
    store.relay_pending()
    assert [event['revision'] for event in store.events_after() if event['event_type']=='alert.updated']==[1,2,3]


def test_worker_episode_update_preserves_operator_review_and_acknowledgment(store):
    alert_id=str(uuid4())
    producer={'alert_id':alert_id,'status':'open','review':{'status':'pending_review'},'observed':[]}
    store.save_state('camera',state(),alerts=[producer])
    store.review_alert(alert_id,'acknowledge',note='Inspección solicitada')
    store.save_state('camera',state(),alerts=[{**producer,'observed':[{'duration_seconds':90}]}])
    current=store.get_alert(alert_id)
    assert current['acknowledged'] is True
    assert current['review']['action']=='acknowledge'
    assert current['review']['note']=='Inspección solicitada'
    assert current['status']=='open' and current['revision']==3
    assert current['observed']==[{'duration_seconds':90}]
    store.review_alert(alert_id,'resolve')
    store.save_state('camera',state(),alerts=[producer])
    assert store.get_alert(alert_id)['status']=='resolved'
    assert store.get_alert(alert_id)['review']['action']=='resolve'


def test_expired_worker_is_fenced_and_cannot_reacquire_old_token(store):
    token=store.acquire_camera_lease('camera','worker-a',ttl=30)
    store.save_state('camera',state(),owner='worker-a',fencing_token=token)
    with pytest.raises(LeaseUnavailable):store.acquire_camera_lease('camera','worker-b')
    with pytest.raises(LeaseUnavailable):store.save_state('camera',state())
    assert store.release_camera_lease('camera','worker-a',token)
    next_token=store.acquire_camera_lease('camera','worker-b')
    assert next_token>token
    assert not store.renew_camera_lease('camera','worker-a',token)
    with pytest.raises(LeaseUnavailable):store.save_state('camera',state(),owner='worker-a',fencing_token=token)
    store.save_state('camera',state(),owner='worker-b',fencing_token=next_token)
    assert store.get_state('camera')['revision']==2


@pytest.mark.skipif(not os.getenv('ITS_TEST_POSTGRES_URL'),reason='Dedicated PostgreSQL test URL not configured')
def test_postgres_serialized_relay_and_worker_fencing():
    url=os.environ['ITS_TEST_POSTGRES_URL']
    admin=create_engine(url,hide_parameters=True)
    schema='its_test_'+uuid4().hex
    with admin.begin() as conn:conn.execute(text(f'CREATE SCHEMA {schema}'))
    isolated=make_url(url).update_query_dict({'options':f'-csearch_path={schema}'}).render_as_string(hide_password=False)
    first,second=Store(isolated),Store(isolated)
    try:
        first.initialize();second.initialize()
        token=first.acquire_camera_lease('camera','worker')
        for i in range(5):first.save_state('camera',state(sequence=i),owner='worker',fencing_token=token)
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sum(pool.map(lambda db:db.relay_pending(),[first,second]))==5
        assert [event['revision'] for event in first.events_after()]==[1,2,3,4,5]
        with pytest.raises(LeaseUnavailable):second.save_state('camera',state(),owner='other',fencing_token=token)
        assert first.snapshot()['states'][0]['revision']==5
    finally:
        first.engine.dispose();second.engine.dispose()
        with admin.begin() as conn:conn.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        admin.dispose()
