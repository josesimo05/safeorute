"""Persistencia de metadatos y entrega durable. Nunca almacena frames o tracks.

El outbox se confirma junto al estado. Un relay serializado asigna la secuencia
DESPUÉS del commit del productor; no se confunde BIGSERIAL con orden de commit.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import math
import re
from pathlib import Path
import threading
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (JSON, BigInteger, Boolean, Column, DateTime, Float, Integer,
                        MetaData, String, Table, create_engine, delete, func, insert,
                        select, text, update)
from sqlalchemy.engine import make_url
from sqlalchemy.pool import StaticPool

UTC = timezone.utc
metadata = MetaData()
cameras = Table('its_cameras', metadata,
    Column('id', String(200), primary_key=True), Column('config', JSON, nullable=False))
states = Table('its_current_states', metadata,
    Column('camera_id', String(200), primary_key=True), Column('revision', Integer, nullable=False),
    Column('payload', JSON, nullable=False), Column('updated_at', DateTime(timezone=True), nullable=False))
windows = Table('its_metric_windows', metadata,
    Column('key', String(64), primary_key=True), Column('camera_id', String(200), index=True, nullable=False),
    Column('lane_id', String(200)), Column('source_mode', String(20), nullable=False),
    Column('bin_start_s', Float), Column('received_at', DateTime(timezone=True), index=True, nullable=False),
    Column('payload', JSON, nullable=False))
alerts_table = Table('its_alerts', metadata,
    Column('id', String(36), primary_key=True), Column('camera_id', String(200), index=True, nullable=False),
    Column('source_mode', String(20), nullable=False), Column('revision', Integer, nullable=False),
    Column('payload', JSON, nullable=False), Column('updated_at', DateTime(timezone=True), nullable=False))
alert_revisions = Table('its_alert_revisions', metadata,
    Column('key', String(80), primary_key=True), Column('alert_id', String(36), index=True, nullable=False),
    Column('revision', Integer, nullable=False), Column('payload', JSON, nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False))
outbox = Table('its_outbox', metadata,
    Column('producer_sequence', Integer, primary_key=True, autoincrement=True),
    Column('event_id', String(36), unique=True, nullable=False), Column('entity_id', String(200), nullable=False),
    Column('revision', Integer, nullable=False), Column('event_type', String(80), nullable=False),
    Column('source_mode', String(20), nullable=False), Column('payload', JSON, nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False), Column('delivered', Boolean, default=False, index=True, nullable=False))
delivery = Table('its_delivery_events', metadata,
    Column('sequence', BigInteger, primary_key=True), Column('event_id', String(36), unique=True, nullable=False),
    Column('entity_id', String(200), nullable=False), Column('revision', Integer, nullable=False),
    Column('event_type', String(80), nullable=False), Column('source_mode', String(20), nullable=False),
    Column('payload', JSON, nullable=False), Column('created_at', DateTime(timezone=True), index=True, nullable=False))
counter = Table('its_delivery_counter', metadata,
    Column('id', Integer, primary_key=True), Column('sequence', BigInteger, nullable=False),
    Column('expired_through', BigInteger, nullable=False))


leases = Table('its_camera_leases', metadata,
    Column('camera_id', String(200), primary_key=True), Column('owner', String(200), nullable=False),
    Column('fencing_token', BigInteger, nullable=False),
    Column('lease_until', DateTime(timezone=True), nullable=False))

class LeaseUnavailable(RuntimeError):
    pass

FORBIDDEN_KEYS = frozenset({'frame', 'frames', 'image', 'images', 'raw_video', 'snapshot',
    'snapshots', 'plate', 'plates', 'face', 'faces', 'track_id', 'track_ids', 'tracker_id',
    'tracks', 'trajectories', 'gps_samples', 'raw_gps', 'password', 'token', 'secret',
    'rtsp_url', 'stream_url', 'source_uri', 'authorization', 'api_key',
    'private_key', 'client_secret', 'access_token'})


class CursorExpired(ValueError):
    """El cliente debe recuperar un snapshot en vez de perder eventos."""


class CursorAhead(ValueError):
    pass


def now_utc() -> datetime:
    return datetime.now(UTC)


def as_datetime(value: Any, default: datetime | None = None) -> datetime:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except (TypeError, ValueError):
        return default or now_utc()


def safe_json(value: Any) -> Any:
    """Falla de forma cerrada ante datos personales/frames/URLs de cámaras."""
    if isinstance(value, dict):
        if any(str(key).lower() in FORBIDDEN_KEYS for key in value):
            raise ValueError('Payload contains a field forbidden by the privacy policy')
        return {str(key): safe_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) > 10000:
            raise ValueError('Metadata collection is too large')
        return [safe_json(item) for item in value]
    if isinstance(value, datetime):
        return as_datetime(value).isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Non-finite metadata value')
    if isinstance(value, str) and ('rtsp://' in value.lower() or 'rtsps://' in value.lower()
            or re.search(r'[a-z][a-z0-9+.-]*://[^/\s@]+@', value, re.IGNORECASE)):
        raise ValueError('Camera source URLs must not be persisted or returned')
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise ValueError('Only JSON metadata can be persisted')


def demo_mode(payload: dict) -> bool:
    return payload.get('source_mode') in {'demo', 'synthetic'}


def demo_camera_metadata(config: dict, has_demo_state: bool) -> bool:
    """Un estado demo anterior no hace pública una configuración real nueva."""
    source = config.get('source') or {}
    if source.get('kind') not in (None, 'synthetic'):
        return False
    if source.get('mode') not in (None, 'demo', 'synthetic'):
        return False
    return has_demo_state or source.get('kind') == 'synthetic'


class Store:
    def __init__(self, database_url: str = 'sqlite:///./data/its.db'):
        url = make_url(database_url)
        self.sqlite = url.get_backend_name() == 'sqlite'
        if self.sqlite and url.database and url.database != ':memory:':
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
        options: dict[str, Any] = {'hide_parameters': True, 'pool_pre_ping': True}
        if self.sqlite:
            options['connect_args'] = {'check_same_thread': False, 'timeout': 30}
            if url.database in (None, '', ':memory:'):
                options['poolclass'] = StaticPool
        self.engine = create_engine(url, **options)
        self._lock = threading.RLock()
        self._initialized = False

    def initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            with self.engine.connect() as conn:
                if self.sqlite:
                    conn.exec_driver_sql('BEGIN IMMEDIATE')
                else:
                    conn.begin()
                    conn.execute(text('SELECT pg_advisory_xact_lock(705313924)'))
                try:
                    metadata.create_all(conn)
                    if conn.execute(select(counter.c.id).where(counter.c.id == 1)).first() is None:
                        conn.execute(insert(counter).values(id=1, sequence=0, expired_through=0))
                    conn.commit()
                except BaseException:
                    conn.rollback()
                    raise
            self._initialized = True

    @contextmanager
    def _write(self):
        self.initialize()
        with self._lock, self.engine.connect() as conn:
            if self.sqlite:
                conn.exec_driver_sql('BEGIN IMMEDIATE')
            else:
                conn.begin()
            try:
                # Single authoritative row serializes mutation/relay transactions.
                conn.execute(select(counter).where(counter.c.id == 1).with_for_update()).first()
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    @contextmanager
    def _read(self):
        self.initialize()
        with self._lock, self.engine.connect() as conn:
            yield conn

    def ping(self) -> bool:
        with self._read() as conn:
            return conn.execute(select(1)).scalar_one() == 1

    def upsert_camera(self, public_config: dict) -> None:
        payload = safe_json(public_config)
        camera_id = payload.get('camera_id') or payload.get('id')
        if not camera_id:
            raise ValueError('Camera identifier is required')
        with self._write() as conn:
            if conn.execute(select(cameras.c.id).where(cameras.c.id == camera_id)).first():
                conn.execute(update(cameras).where(cameras.c.id == camera_id).values(config=payload))
            else:
                conn.execute(insert(cameras).values(id=camera_id, config=payload))

    @staticmethod
    def _enqueue(conn, entity_id: str, revision: int, event_type: str, mode: str, payload: dict):
        conn.execute(insert(outbox).values(event_id=str(uuid4()), entity_id=entity_id,
            revision=revision, event_type=event_type, source_mode=mode, payload=payload,
            created_at=now_utc(), delivered=False))

    def save_state(self, camera_id: str, state: dict, history_windows: list[dict] | None = None,
                   alerts: list[dict] | None = None, *, owner: str | None = None,
                   fencing_token: int | None = None) -> int:
        payload = safe_json(state)
        payload['camera_id'] = camera_id
        mode = str(payload.get('source_mode', 'unknown'))
        history_payloads = [safe_json(item) for item in history_windows or []]
        alert_payloads = [safe_json(item) for item in alerts or []]
        with self._write() as conn:
            lease = conn.execute(select(leases).where(leases.c.camera_id == camera_id)).mappings().first()
            if lease and (lease['owner'] != owner or lease['fencing_token'] != fencing_token or as_datetime(lease['lease_until']) <= now_utc()):
                raise LeaseUnavailable('Camera worker lease is not current')
            old = conn.execute(select(states).where(states.c.camera_id == camera_id)).mappings().first()
            revision = old['revision'] + 1 if old else 1
            payload['revision'] = revision
            if not conn.execute(select(cameras.c.id).where(cameras.c.id == camera_id)).first():
                conn.execute(insert(cameras).values(id=camera_id, config={'camera_id': camera_id}))
            if old:
                conn.execute(update(states).where(states.c.camera_id == camera_id).values(revision=revision, payload=payload, updated_at=now_utc()))
            else:
                conn.execute(insert(states).values(camera_id=camera_id, revision=revision, payload=payload, updated_at=now_utc()))
            for item in history_payloads:
                item.setdefault('camera_id', camera_id)
                item.setdefault('stream_epoch', payload.get('stream_epoch'))
                item.setdefault('source_mode', mode)
                identity = [camera_id, item.get('lane_id'), item.get('stream_epoch'),
                    item.get('bin_start_s', item.get('window_start_s', item.get('media_start_s', 0))), item.get('calibration_id')]
                key = sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
                values = dict(camera_id=camera_id, lane_id=item.get('lane_id'),
                    source_mode=item['source_mode'], bin_start_s=identity[3],
                    received_at=as_datetime(item.get('received_at', payload.get('received_at'))), payload=item)
                if conn.execute(select(windows.c.key).where(windows.c.key == key)).first():
                    conn.execute(update(windows).where(windows.c.key == key).values(**values))
                else:
                    conn.execute(insert(windows).values(key=key, **values))
            self._enqueue(conn, camera_id, revision, 'camera.state.updated', mode, payload)
            for item in alert_payloads:
                self._save_alert(conn, camera_id, mode, item)
            return revision

    def _save_alert(self, conn, camera_id: str, mode: str, payload: dict, *, preserve_review: bool = True) -> dict:
        alert_id = str(payload.get('alert_id') or uuid4())
        UUID(alert_id)
        old = conn.execute(select(alerts_table).where(alerts_table.c.id == alert_id)).mappings().first()
        revision = old['revision'] + 1 if old else 1
        result = {**payload, 'alert_id': alert_id, 'camera_id': camera_id, 'source_mode': mode, 'revision': revision}
        if old and preserve_review:
            previous = old['payload']
            for field in ('review', 'acknowledged', 'suppressed'):
                if field in previous:
                    result[field] = previous[field]
            if previous.get('review', {}).get('action') == 'resolve':
                result['status'] = previous.get('status', 'resolved')
        # No automatic or manual cause publication is enabled in the one-camera MVP.
        result['publication'] = {'audience': 'operator_only', 'public_approved': False}
        values = dict(camera_id=camera_id, source_mode=mode, revision=revision, payload=result, updated_at=now_utc())
        if old:
            conn.execute(update(alerts_table).where(alerts_table.c.id == alert_id).values(**values))
        else:
            conn.execute(insert(alerts_table).values(id=alert_id, **values))
        conn.execute(insert(alert_revisions).values(key=f'{alert_id}:{revision}', alert_id=alert_id,
            revision=revision, payload=result, created_at=now_utc()))
        self._enqueue(conn, alert_id, revision, 'alert.updated', mode, result)
        return result

    def relay_pending(self, limit: int = 200) -> int:
        limit = max(1, min(int(limit), 1000))
        with self._write() as conn:
            number = conn.execute(select(counter.c.sequence).where(counter.c.id == 1)).scalar_one()
            rows = conn.execute(select(outbox).where(outbox.c.delivered.is_(False))
                .order_by(outbox.c.producer_sequence).limit(limit)).mappings().all()
            for row in rows:
                number += 1
                conn.execute(insert(delivery).values(sequence=number, event_id=row['event_id'],
                    entity_id=row['entity_id'], revision=row['revision'], event_type=row['event_type'],
                    source_mode=row['source_mode'], payload=row['payload'], created_at=now_utc()))
                conn.execute(update(outbox).where(outbox.c.event_id == row['event_id']).values(delivered=True))
            conn.execute(update(counter).where(counter.c.id == 1).values(sequence=number))
            return len(rows)

    def current_cursor(self) -> str:
        with self._read() as conn:
            return str(conn.execute(select(counter.c.sequence).where(counter.c.id == 1)).scalar_one())

    @staticmethod
    def _state(payload: dict, updated_at: datetime) -> dict:
        result = json.loads(json.dumps(payload))
        age = max(0.0, (now_utc() - as_datetime(result.get('received_at'), as_datetime(updated_at))).total_seconds())
        result['arrival_age_seconds'] = round(age, 3)
        result['capture_age_seconds'] = (max(0.0, (now_utc() - as_datetime(result['capture_at'])).total_seconds())
            if result.get('capture_at') else None)
        if age > 15:
            result['stale'] = True
            result['health'] = {**(result.get('health') or {}), 'status': 'stale',
                               'usable_for_analytics': False, 'usable_for_speed': False}
            result['congestion'] = 'desconocido'
            result['count_valid'] = False
            result['speed_valid'] = False
            result['mean_speed_kmh'] = None
            for lane in result.get('lanes', []):
                lane['speed_valid'] = False
                lane['mean_speed_kmh'] = None
                lane['count_valid'] = False
        else:
            result['stale'] = False
        return result

    def get_state(self, camera_id: str, demo_only: bool = False) -> dict | None:
        with self._read() as conn:
            row = conn.execute(select(states).where(states.c.camera_id == camera_id)).mappings().first()
            if not row or (demo_only and not demo_mode(row['payload'])):
                return None
            return self._state(row['payload'], row['updated_at'])

    def list_cameras(self, demo_only: bool = False) -> list[dict]:
        with self._read() as conn:
            rows = conn.execute(select(cameras).order_by(cameras.c.id)).mappings().all()
        result = []
        for row in rows:
            config = dict(row['config'])
            state = self.get_state(row['id'], demo_only=demo_only)
            if demo_only and not demo_camera_metadata(config, state is not None):
                continue
            config.setdefault('camera_id', row['id'])
            if state:
                config['state'] = state
            result.append(config)
        return result

    def history(self, camera_id: str | None = None, limit: int = 100,
                start: datetime | None = None, end: datetime | None = None,
                demo_only: bool = False) -> list[dict]:
        query = select(windows).order_by(windows.c.received_at.desc(), windows.c.key).limit(max(1, min(limit, 500)))
        if camera_id:
            query = query.where(windows.c.camera_id == camera_id)
        if start:
            query = query.where(windows.c.received_at >= as_datetime(start))
        if end:
            query = query.where(windows.c.received_at <= as_datetime(end))
        if demo_only:
            query = query.where(windows.c.source_mode.in_(['demo', 'synthetic']))
        with self._read() as conn:
            return [row['payload'] for row in conn.execute(query).mappings()]

    @staticmethod
    def _alert(payload: dict, camera_state: dict | None) -> dict:
        """Decora vigencia de la observación; nunca infiere una recuperación.

        La fecha/revisión originales del episodio se conservan, también al
        reproducir eventos. La ausencia de una medición reciente no cierra una
        alerta ni convierte en falsa la observación histórica.
        """
        result = json.loads(json.dumps(payload))
        if result.get('kind') != 'congestion_observed':
            return result
        current = camera_state or {}
        if (current.get('source_mode') != result.get('source_mode')
                or (result.get('stream_epoch') is not None
                    and current.get('stream_epoch') != result['stream_epoch'])):
            # A new source/epoch is not evidence about the old episode and must
            # not leak live-source timing into an anonymous historical demo.
            current = {}
        age = current.get('arrival_age_seconds')
        health = current.get('health') or {}
        quality_usable = health.get('usable_for_analytics', health.get('status') in {'healthy', 'ok'})
        if current.get('stale') or (isinstance(age, (int, float)) and age > 15):
            status = 'stale'
        elif (not current or not quality_usable
                or current.get('speed_valid') is not True
                or current.get('congestion') not in {'denso', 'detenido'}):
            status = 'unavailable'
        else:
            status = 'current'
        result['observation_status'] = status
        result['observation_stale'] = status != 'current'
        result['last_observation_received_at'] = current.get('received_at')
        result['observation_age_seconds'] = age
        return result

    def _alert_camera_states(self, conn, payloads: list[dict]) -> dict[str, dict]:
        ids = {item.get('camera_id') for item in payloads
               if item.get('kind') == 'congestion_observed' and item.get('camera_id')}
        if not ids:
            return {}
        rows = conn.execute(select(states).where(states.c.camera_id.in_(ids))).mappings()
        return {row['camera_id']: self._state(row['payload'], row['updated_at']) for row in rows}

    def list_alerts(self, demo_only: bool = False, limit: int = 100) -> list[dict]:
        query = select(alerts_table).order_by(alerts_table.c.updated_at.desc()).limit(max(1, min(limit, 500)))
        if demo_only:
            query = query.where(alerts_table.c.source_mode.in_(['demo', 'synthetic']))
        with self._read() as conn:
            payloads = [row['payload'] for row in conn.execute(query).mappings()]
            current = self._alert_camera_states(conn, payloads)
            return [self._alert(item, current.get(item.get('camera_id'))) for item in payloads]

    def get_alert(self, alert_id: str, demo_only: bool = False) -> dict | None:
        query = select(alerts_table).where(alerts_table.c.id == alert_id)
        if demo_only:
            query = query.where(alerts_table.c.source_mode.in_(['demo', 'synthetic']))
        with self._read() as conn:
            row = conn.execute(query).mappings().first()
            if row is None:
                return None
            current = self._alert_camera_states(conn, [row['payload']])
            return self._alert(row['payload'], current.get(row['camera_id']))

    def review_alert(self, alert_id: str, action: str, actor: str = 'operator', note: str = '') -> dict | None:
        if action not in {'acknowledge', 'approve', 'suppress', 'resolve'}:
            raise ValueError('Unsupported review action')
        if len(note) > 1000:
            raise ValueError('Review note is too long')
        safe_json({'note': note})
        with self._write() as conn:
            row = conn.execute(select(alerts_table).where(alerts_table.c.id == alert_id)).mappings().first()
            if not row:
                return None
            payload = dict(row['payload'])
            payload['review'] = {'action': action, 'actor': actor, 'note': note, 'at': now_utc().isoformat()}
            if action == 'acknowledge':
                payload['acknowledged'] = True
            elif action == 'resolve':
                # Operator confirmation is explicit, never inferred from camera failure.
                payload['status'] = 'resolved'
            elif action == 'suppress':
                payload['suppressed'] = True
            return self._save_alert(conn, row['camera_id'], row['source_mode'], payload, preserve_review=False)

    def events_after(self, cursor: int = 0, limit: int = 100, demo_only: bool = False) -> list[dict]:
        if cursor < 0:
            raise ValueError('Invalid cursor')
        with self._read() as conn:
            progress = conn.execute(select(counter).where(counter.c.id == 1)).mappings().one()
            if cursor < progress['expired_through']:
                raise CursorExpired('Event cursor expired; request a snapshot')
            if cursor > progress['sequence']:
                raise CursorAhead('Event cursor exceeds the committed delivery sequence')
            query = select(delivery).where(delivery.c.sequence > cursor).order_by(delivery.c.sequence).limit(max(1, min(limit, 500)))
            if demo_only:
                query = query.where(delivery.c.source_mode.in_(['demo', 'synthetic']))
            rows = conn.execute(query).mappings().all()
            current = self._alert_camera_states(conn,
                [row['payload'] for row in rows if row['event_type'] == 'alert.updated'])
            return [{'cursor': str(row['sequence']), 'event_id': row['event_id'],
                'entity_id': row['entity_id'], 'revision': row['revision'],
                'event_type': row['event_type'], 'payload': (
                    self._alert(row['payload'], current.get(row['payload'].get('camera_id')))
                    if row['event_type'] == 'alert.updated' else row['payload']),
                'created_at': as_datetime(row['created_at']).isoformat()} for row in rows]

    def acquire_camera_lease(self, camera_id: str, owner: str, ttl: int = 30) -> int:
        if not owner or not 1 <= ttl <= 300:
            raise ValueError('Invalid lease owner or TTL')
        with self._write() as conn:
            row = conn.execute(select(leases).where(leases.c.camera_id == camera_id)).mappings().first()
            clock = now_utc()
            if row and as_datetime(row['lease_until']) > clock:
                if row['owner'] != owner:
                    raise LeaseUnavailable('Another worker owns this camera')
                token = row['fencing_token']
            else:
                token = (row['fencing_token'] + 1) if row else 1
            values = dict(owner=owner, fencing_token=token, lease_until=clock + timedelta(seconds=ttl))
            if row:
                conn.execute(update(leases).where(leases.c.camera_id == camera_id).values(**values))
            else:
                conn.execute(insert(leases).values(camera_id=camera_id, **values))
            return token

    def renew_camera_lease(self, camera_id: str, owner: str, fencing_token: int, ttl: int = 30) -> bool:
        if not 1 <= ttl <= 300:
            raise ValueError('Invalid lease TTL')
        with self._write() as conn:
            row = conn.execute(select(leases).where(leases.c.camera_id == camera_id)).mappings().first()
            if not row or row['owner'] != owner or row['fencing_token'] != fencing_token or as_datetime(row['lease_until']) <= now_utc():
                return False
            conn.execute(update(leases).where(leases.c.camera_id == camera_id).values(lease_until=now_utc() + timedelta(seconds=ttl)))
            return True

    def release_camera_lease(self, camera_id: str, owner: str, fencing_token: int) -> bool:
        with self._write() as conn:
            result = conn.execute(update(leases).where(leases.c.camera_id == camera_id,
                leases.c.owner == owner, leases.c.fencing_token == fencing_token).values(lease_until=now_utc() - timedelta(seconds=1)))
            return result.rowcount == 1

    def snapshot(self, demo_only: bool = False) -> dict:
        # The authoritative serialization row is locked across the whole snapshot,
        # including against other processes. State+cursor cannot straddle a relay
        # commit and silently skip the corresponding event on reconnect.
        with self._write() as conn:
            state_rows = conn.execute(select(states)).mappings().all()
            state_map = {row['camera_id']: self._state(row['payload'], row['updated_at'])
                for row in state_rows if not demo_only or demo_mode(row['payload'])}
            camera_items = []
            for row in conn.execute(select(cameras).order_by(cameras.c.id)).mappings():
                config = dict(row['config'])
                current = state_map.get(row['id'])
                if demo_only and not demo_camera_metadata(config, current is not None):
                    continue
                config.setdefault('camera_id', row['id'])
                if current:
                    config['state'] = current
                camera_items.append(config)
            query = select(alerts_table).order_by(alerts_table.c.updated_at.desc()).limit(100)
            if demo_only:
                query = query.where(alerts_table.c.source_mode.in_(['demo', 'synthetic']))
            items = [self._alert(row['payload'], state_map.get(row['camera_id']))
                     for row in conn.execute(query).mappings()]
            sequence = conn.execute(select(counter.c.sequence).where(counter.c.id == 1)).scalar_one()
            return {'cameras': camera_items, 'states': list(state_map.values()), 'alerts': items,
                'cursor': str(sequence), 'server_time': now_utc().isoformat(), 'demo': demo_only}

    def prune(self, retention_days: int = 90, event_days: int = 7) -> None:
        if retention_days < 1 or event_days < 1:
            raise ValueError('Retention must be positive')
        event_cutoff = now_utc() - timedelta(days=event_days)
        history_cutoff = now_utc() - timedelta(days=retention_days)
        with self._write() as conn:
            expired = conn.execute(select(func.max(delivery.c.sequence)).where(delivery.c.created_at < event_cutoff)).scalar_one()
            if expired is not None:
                previous = conn.execute(select(counter.c.expired_through).where(counter.c.id == 1)).scalar_one()
                conn.execute(update(counter).where(counter.c.id == 1).values(expired_through=max(previous, expired)))
                conn.execute(delete(delivery).where(delivery.c.sequence <= expired))
            conn.execute(delete(outbox).where(outbox.c.delivered.is_(True), outbox.c.created_at < event_cutoff))
            conn.execute(delete(windows).where(windows.c.received_at < history_cutoff))
            conn.execute(delete(alert_revisions).where(alert_revisions.c.created_at < history_cutoff))
            conn.execute(delete(alerts_table).where(alerts_table.c.updated_at < history_cutoff))
