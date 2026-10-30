"""Trabajador de una cámara. Imágenes/tracks permanecen en RAM.

Un proceso por fuente mantiene un único propietario mediante lease. Los errores
se registran por código, nunca con URLs, credenciales o mensajes de FFmpeg.
"""
from __future__ import annotations

import copy
from datetime import UTC, datetime
import json
import logging
import os
from pathlib import Path
from threading import Event
import time
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError

from .analytics import Analytics
from .config import CameraConfig, public_config
from .health import HealthMonitor
from .ingest import LatestFrameBuffer, VideoSource
from .store import Store
from .vision import ByteTrackTracker, SyntheticDetector, YoloXDetector

LOG = logging.getLogger(__name__)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def build_detector(config: CameraConfig):
    """Una fuente real nunca cae silenciosamente al detector sintético."""
    if config.source.kind == 'synthetic':
        return SyntheticDetector(config)
    model = os.environ.get('ITS_MODEL_PATH')
    if not model:
        raise ValueError('Configura ITS_MODEL_PATH con el modelo ONNX verificado.')
    manifest = Path(__file__).with_name('model_manifest.json')
    expected = os.environ.get('ITS_MODEL_SHA256')
    if not expected and manifest.exists():
        expected = json.loads(manifest.read_text())['sha256']
    if not expected:
        raise ValueError('Se requiere un SHA-256 esperado del modelo, no confianza implícita en un archivo.')
    return YoloXDetector(model, expected_sha256=expected,
                         input_size=config.processing.model_input_size_px)


class ObservedAlerts:
    """Solo hechos de salud/congestión; no diagnostica las causas de la Fase 5."""
    def __init__(self):
        self.active: dict[str, dict] = {}
        self.congested_since: float | None = None
        self.quality_degraded_since: float | None = None
        self.epoch: str | None = None

    def update(self, state: dict, *, observed_monotonic: float | None = None) -> list[dict]:
        now = utc_now()
        observed_monotonic = time.monotonic() if observed_monotonic is None else observed_monotonic
        health = state.get('health', {})
        code = health.get('status', 'unknown')
        wanted: dict[str, dict] = {}
        changes = []
        epoch = state.get('stream_epoch')
        if self.epoch is not None and epoch != self.epoch:
            # A new source epoch is a new observation, never proof of recovery.
            for old in self.active.values():
                closed = {key: value for key, value in old.items() if key != '_fingerprint'}
                closed.update(status='expired', updated_at=now)
                changes.append(closed)
            self.active.clear()
            self.congested_since = None
            self.quality_degraded_since = None
        self.epoch = epoch
        if code == 'degraded':
            if self.quality_degraded_since is None:
                self.quality_degraded_since = observed_monotonic
        else:
            self.quality_degraded_since = None
        degraded_persisted = (self.quality_degraded_since is not None
                              and observed_monotonic - self.quality_degraded_since >= 5)
        if code in {'no_frames', 'freeze_suspected', 'scene_changed', 'source_unavailable'} or degraded_persisted:
            wanted['camera_health'] = {
                'observed': [{'fact_code': code, 'description': 'La ingesta o imagen requiere revisión.',
                              'issues': health.get('issues', [])}],
                'recommended_action': 'Revisar la fuente, la conexión y el encuadre; no atribuirlo automáticamente a una avería física.',
            }
        media = state.get('media_time_s')
        congested = state.get('congestion') in {'denso', 'detenido'} and health.get('usable_for_analytics', False)
        if congested and isinstance(media, (int, float)):
            if self.congested_since is None or media < self.congested_since:
                self.congested_since = media
            if media - self.congested_since >= 30:
                wanted['congestion_observed'] = {
                    'observed': [{'fact_code': 'persistent_congestion', 'duration_seconds': int((media-self.congested_since)//10)*10,
                                  'mean_speed_kmh': state.get('mean_speed_kmh'),
                                  'description': 'Velocidad reducida persistente en la región observada.'}],
                    'recommended_action': 'Revisar el tramo y contrastar el contexto antes de atribuir una causa.',
                }
        else:
            self.congested_since = None
        for key, facts in wanted.items():
            old = self.active.get(key)
            alert = dict(old) if old else {
                'alert_id': str(uuid4()), 'camera_id': state['camera_id'],
                'road_segment_id': state.get('road_segment_id'), 'kind': key,
                'stream_epoch': state.get('stream_epoch'),
                'source_mode': state['source_mode'], 'opened_at': now,
                'location': state.get('location'),
                'probable_causes': [{'code': 'undetermined', 'description': 'Causa no determinada.',
                                    'confidence_level': 'bajo', 'criteria_met': ['observacion_disponible'],
                                    'missing_evidence': ['revision_y_contexto_independiente']}],
                'publication': {'audience': 'operator_only', 'public_approved': False},
                'review': {'status': 'pending_review'},
            }
            alert.update(facts, status='open', updated_at=now)
            # Updates reflect changed facts, not a new alarm every frame.
            fingerprint = json.dumps(facts, sort_keys=True)
            if old is None or self.active[key].get('_fingerprint') != fingerprint:
                changes.append(copy.deepcopy(alert))
            alert['_fingerprint'] = fingerprint
            self.active[key] = alert
        for key in list(self.active):
            if key not in wanted:
                # Loss of observation does not prove traffic recovered.
                if key == 'congestion_observed' and (not health.get('usable_for_analytics', False)
                        or not state.get('speed_valid', True)
                        or state.get('congestion') not in {'fluido', 'moderado', 'denso', 'detenido'}):
                    status = 'expired'
                elif code in {'replay_finished', 'stopped'}:
                    status = 'expired'
                else:
                    status = 'resolved'
                closed = dict(self.active.pop(key))
                closed.pop('_fingerprint', None)
                closed.update(status=status, updated_at=now)
                changes.append(closed)
        for alert in changes:
            alert.pop('_fingerprint', None)
        return changes


def run_worker(config: CameraConfig, store: Store, stop_event: Event | None = None,
               *, duration: float | None = None, publish_interval: float = 1.0) -> dict | None:
    """Procesa una cámara; retorna último snapshot para pruebas y ejecución local."""
    stop = stop_event or Event()
    owner = str(uuid4())
    store.initialize()
    fencing = store.acquire_camera_lease(config.camera_id, owner, ttl=30)
    reader = None
    last_state = None
    started = time.monotonic()
    last_frame_at = started
    last_publish = 0.0
    last_renew = started
    last_epoch = None
    pending_windows: dict[tuple, dict] = {}
    pending_alerts: dict[str, dict] = {}
    alerts = ObservedAlerts()
    try:
        # Rejected duplicate workers must not alter the active camera metadata.
        store.upsert_camera(public_config(config))
        detector = build_detector(config)
        tracker = ByteTrackTracker(config.processing.target_processed_fps)
        analytics = Analytics(config)
        monitor = HealthMonitor()
        source = VideoSource(config, stop)
        reader = LatestFrameBuffer(source, config.processing.latest_frame_buffer_capacity).start()
        # --duration measures processing time, excluding cold model/tracker load.
        started = last_frame_at = time.monotonic()
        while not stop.is_set():
            current = time.monotonic()
            if duration is not None and current - started >= duration:
                break
            if current - last_renew >= 10:
                if not store.renew_camera_lease(config.camera_id, owner, fencing, ttl=30):
                    raise RuntimeError('Se perdió la propiedad exclusiva de la cámara.')
                last_renew = current
            frame = reader.get(timeout=.5)
            changed = False
            if frame is not None:
                last_frame_at = current
                if frame.epoch != last_epoch:
                    tracker.reset()
                    analytics.reset(frame.epoch)
                    last_epoch = frame.epoch
                    alerts.congested_since = None
                health = monitor.update(frame)
                before = time.monotonic()
                detections = detector.detect(frame)
                observations = tracker.update(detections)
                last_state = analytics.update(frame, observations, health)
                last_state['location'] = config.location.model_dump(mode='json')
                last_state['detector_backend'] = detector.backend
                last_state['model_sha256'] = detector.model_sha256
                last_state['validation_status'] = 'synthetic_only' if config.source.kind == 'synthetic' else 'not_field_validated'
                last_state['processing'] = {'inference_tracking_ms': round((time.monotonic()-before)*1000, 3),
                                            'dropped_frames': reader.dropped_frames,
                                            'processed_fps_target': config.processing.target_processed_fps}
                for window in analytics.flush_windows():
                    key = (window.get('stream_epoch'), window.get('lane_id'), window.get('bin_start_s', window.get('window_start_media_s')))
                    pending_windows[key] = window
                # Bound metadata during a database outage; report drops explicitly.
                while len(pending_windows) > 500:
                    pending_windows.pop(next(iter(pending_windows)))
                    last_state['history_coverage_degraded'] = True
            else:
                health = monitor.timeout(current)
                if reader.done.is_set():
                    health = dict(health, status=source.status,
                                  usable_for_analytics=False, usable_for_speed=False)
                    if reader.error:
                        health['status'] = 'source_unavailable'
                        health['issues'] = ['source_unavailable']
                if last_state is None:
                    last_state = {'camera_id': config.camera_id, 'road_segment_id': config.road_segment_id,
                                  'source_mode': config.source.mode, 'stream_epoch': last_epoch,
                                  'media_time_s': None, 'capture_at': None, 'received_at': utc_now(),
                                  'location': config.location.model_dump(mode='json'), 'lanes': [],
                                  'congestion': 'desconocido', 'mean_speed_kmh': None,
                                  'speed_valid': False, 'calibration_status': config.calibration.status}
                changed = last_state.get('health', {}).get('status') != health['status']
                last_state = copy.deepcopy(last_state)
                last_state['health'] = health
                if not health.get('usable_for_analytics', False):
                    last_state.update(congestion='desconocido', mean_speed_kmh=None,
                                      speed_valid=False, count_valid=False)
                    for lane in last_state.get('lanes', []):
                        lane.update(mean_speed_kmh=None, speed_valid=False, count_valid=False)
            for alert in alerts.update(last_state):
                pending_alerts[alert['alert_id']] = alert
            while len(pending_alerts) > 500:
                pending_alerts.pop(next(iter(pending_alerts)))
                last_state['alert_history_coverage_degraded'] = True
            if current-last_publish >= publish_interval or changed or pending_alerts:
                try:
                    store.save_state(config.camera_id, last_state, list(pending_windows.values()),
                                     list(pending_alerts.values()), owner=owner, fencing_token=fencing)
                    pending_windows.clear()
                    pending_alerts.clear()
                    last_publish = current
                except SQLAlchemyError:
                    LOG.warning('metadata_write_unavailable')
                    last_publish = current
            if frame is None and reader.done.is_set():
                break
            if current-last_frame_at > 60:
                # Exit the camera process so its supervisor can replace a stuck
                # native decoder. The API and other processes remain independent.
                raise RuntimeError('El lector no progresó dentro del límite del watchdog.')
        return last_state
    finally:
        if reader is not None:
            reader.close()
        try:
            store.release_camera_lease(config.camera_id, owner, fencing)
        except SQLAlchemyError:
            LOG.warning('lease_release_unavailable')
