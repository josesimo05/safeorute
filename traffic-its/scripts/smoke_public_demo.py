#!/usr/bin/env python3
"""Exercise the actual read-only synthetic demo through REST and WebSocket.

Run with the project's installed runtime dependencies. No detector or API is
mocked. The result proves delivery and fixture arithmetic, never field accuracy.
TLS verification remains enabled; HTTP is allowed only for explicit loopback
self-tests. Operator tokens, source URLs and response bodies aren't printed.
"""
from __future__ import annotations

import argparse
import json
import math
import ssl
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

from websockets.sync.client import connect


class SmokeFailure(RuntimeError):
    """A fixed diagnostic code, deliberately without response or URL details."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not follow an input demo URL into a different service or production.
        return None


def timeout_value(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError('El timeout debe ser un número de segundos.') from None
    if not math.isfinite(seconds) or seconds < 45:
        raise argparse.ArgumentTypeError('El timeout debe ser finito y al menos 45 segundos.')
    return seconds


def demo_origin(value: str, allow_local_http: bool) -> tuple[str, bool]:
    """Accept an origin, not credentials, a URL path, a query or a fragment."""
    try:
        parsed = urlsplit(value)
        port = parsed.port  # Forces validation without ever reflecting input.
        if (not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment
                or (port is not None and not 1 <= port <= 65535)):
            raise ValueError
        local_http = (parsed.scheme == 'http' and allow_local_http
                      and parsed.hostname.lower() in {'127.0.0.1', 'localhost', '::1'})
        if parsed.scheme != 'https' and not local_http:
            raise ValueError
        return urlunsplit((parsed.scheme, parsed.netloc, '', '', '')), local_http
    except ValueError:
        raise SmokeFailure('origin_requires_https_without_credentials_path_query_or_fragment') from None


def run(origin: str, local_http: bool, scenario: str, timeout: float, result: dict) -> None:
    context = ssl.create_default_context()
    handlers = [NoRedirect(), HTTPSHandler(context=context)]
    if local_http:
        handlers.append(ProxyHandler({}))
    opener = build_opener(*handlers)
    deadline = time.monotonic() + timeout
    expected_speed = 8 if scenario == 'congestion' else 30
    checks = result['checks']
    measurements = result['measurements']
    revisions: dict[str, int] = {}
    lane_counts: dict[tuple, int] = {}
    latest_states: dict[str, dict] = {}
    seen_alerts: set[str] = set()
    measurements.update(expected_synthetic_speed_kmh=expected_speed, observed_count_increase=0,
                        websocket_state_events=0, history_rows=0, congestion_alerts_verified=0)

    def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise SmokeFailure('timeout_before_all_checks_passed')
        return left

    def http_json(path: str, body: dict | None = None) -> tuple[int, dict]:
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-cache'}
        data = None if body is None else json.dumps(body).encode('utf-8')
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = Request(origin + path, data=data, headers=headers)
        try:
            response = opener.open(request, timeout=min(10, remaining()))
        except HTTPError as error:
            response = error
        with response:
            status = response.code
            raw = response.read(2_000_001)
        if status != 200:
            return status, {}
        if len(raw) > 2_000_000:
            raise SmokeFailure('response_exceeds_metadata_limit')
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise SmokeFailure('service_did_not_return_json_metadata') from None
        if not isinstance(payload, dict):
            raise SmokeFailure('service_did_not_return_an_object')
        return status, payload

    def consume_state(state: dict) -> None:
        if state.get('source_mode') != 'demo':
            raise SmokeFailure('non_demo_state_refused')
        if state.get('detector_backend') not in (None, 'synthetic_ground_truth'):
            raise SmokeFailure('non_synthetic_detector_refused')
        camera = state.get('camera_id')
        revision = state.get('revision', 0)
        if not camera or not isinstance(revision, int):
            raise SmokeFailure('invalid_state_identity')
        if camera in revisions and revision <= revisions[camera]:
            return
        revisions[camera] = revision
        latest_states[camera] = state
        speed = state.get('mean_speed_kmh')
        if state.get('speed_valid') and isinstance(speed, (int, float)) and math.isfinite(speed):
            if not math.isclose(speed, expected_speed, rel_tol=0, abs_tol=.2):
                raise SmokeFailure('synthetic_speed_does_not_match_selected_scenario')
            checks['expected_synthetic_speed'] = True
            measurements['last_synthetic_speed_kmh'] = speed
        total = 0
        valid_lanes = 0
        for lane in state.get('lanes', []):
            count = lane.get('count')
            if not lane.get('count_valid') or not isinstance(count, int) or count < 0:
                continue
            valid_lanes += 1
            total += count
            key = (camera, state.get('stream_epoch'), lane.get('id'), lane.get('window_start_media_s'))
            previous = lane_counts.get(key)
            if previous is not None:
                if count < previous:
                    raise SmokeFailure('same_window_count_regressed')
                measurements['observed_count_increase'] += count - previous
            lane_counts[key] = count
        if valid_lanes:
            measurements.setdefault('first_count_in_window', total)
            measurements['latest_count_in_window'] = total
        checks['count_increases'] = measurements['observed_count_increase'] > 0

    def consume_alert(alert: dict) -> None:
        if alert.get('source_mode') != 'demo':
            raise SmokeFailure('non_demo_alert_refused')
        if alert.get('kind') != 'congestion_observed' or alert.get('status') != 'open':
            return
        if alert.get('observation_stale') is True:
            return  # An old open episode doesn't prove the current rule fired.
        observed = alert.get('observed')
        causes = alert.get('probable_causes')
        publication = alert.get('publication') or {}
        if (not isinstance(observed, list) or not observed or not isinstance(causes, list) or not causes
                or any(cause.get('code') != 'undetermined' or cause.get('confidence_level') != 'bajo'
                       for cause in causes)
                or publication.get('public_approved') is not False):
            raise SmokeFailure('congestion_alert_does_not_separate_fact_and_uncertain_cause')
        eligible_fact = any(isinstance(fact, dict) and fact.get('fact_code') == 'persistent_congestion'
                            and isinstance(fact.get('duration_seconds'), (int, float))
                            and math.isfinite(fact['duration_seconds']) and fact['duration_seconds'] >= 30
                            for fact in observed)
        if not eligible_fact:
            raise SmokeFailure('congestion_alert_has_no_thirty_second_persistence_evidence')
        seen_alerts.add(str(alert.get('alert_id')))
        measurements['congestion_alerts_verified'] = len(seen_alerts)
        if scenario == 'congestion':
            checks['congestion_alert_observed_with_undetermined_low_confidence_cause'] = True

    def snapshot() -> dict:
        status, payload = http_json('/v1/snapshot')
        if status != 200 or payload.get('demo') is not True:
            raise SmokeFailure('endpoint_is_not_an_anonymous_demo')
        if (payload.get('capabilities') or {}).get('operator_review') is not False:
            raise SmokeFailure('public_demo_does_not_declare_read_only_operator_access')
        checks['demo_read_only'] = True
        cameras = payload.get('cameras', [])
        for camera in cameras:
            source = camera.get('source') or {}
            if source.get('kind') != 'synthetic' or source.get('mode') != 'demo':
                raise SmokeFailure('non_synthetic_camera_refused')
        checks['only_synthetic_sources'] = bool(cameras)
        for state in payload.get('states', []):
            consume_state(state)
        for alert in payload.get('alerts', []):
            consume_alert(alert)
        return payload

    def history() -> None:
        query = urlencode({'limit': 100})
        status, payload = http_json('/v1/metrics/history?' + query)
        if status != 200:
            raise SmokeFailure('history_request_failed')
        rows = payload.get('items', [])
        for row in rows:
            if row.get('source_mode') != 'demo':
                raise SmokeFailure('non_demo_history_refused')
        covered = [row for row in rows if row.get('count_valid') is True
                   and isinstance(row.get('coverage_seconds'), (int, float))
                   and 0 < row['coverage_seconds'] <= row.get('duration_seconds', 60)
                   and row.get('stream_epoch') == (latest_states.get(row.get('camera_id')) or {}).get('stream_epoch')]
        measurements['history_rows'] = len(rows)
        measurements['history_windows_with_coverage'] = len(covered)
        checks['history_with_coverage'] = bool(covered)

    status, ready = http_json('/readyz')
    if status != 200 or ready.get('status') != 'ready':
        raise SmokeFailure('service_is_not_ready')
    checks['readyz'] = True
    initial = snapshot()  # Refuse production before attempting even a denied write.
    status, _ = http_json('/v1/alerts/smoke-test-unknown/review', {'action': 'acknowledge'})
    if status != 401:
        raise SmokeFailure('anonymous_operator_action_was_not_denied_with_401')
    checks['anonymous_review_denied'] = True
    start_cursor = int(initial['cursor'])
    measurements['cursor_start'] = str(start_cursor)
    measurements['cursor_end'] = str(start_cursor)
    checks.update(expected_synthetic_speed=False, count_increases=False, history_with_coverage=False,
                  websocket_updates=False, cursor_advances=False)
    # An already-running server may have supplied a valid speed in its snapshot.
    checks['expected_synthetic_speed'] = 'last_synthetic_speed_kmh' in measurements
    if scenario == 'congestion':
        checks.setdefault('congestion_alert_observed_with_undetermined_low_confidence_cause', False)
    history()
    ws_url = ('ws' if local_http else 'wss') + origin[origin.index('://'):] + '/v1/stream'
    with connect(ws_url, origin=origin, ssl=None if local_http else context,
                 proxy=None if local_http else True, open_timeout=min(10, remaining()),
                 close_timeout=2, max_size=2_000_000, max_queue=32) as ws:
        ws.send(json.dumps({'token': None, 'cursor': str(start_cursor)}))
        next_poll = time.monotonic()
        while True:
            remaining()
            try:
                message = json.loads(ws.recv(timeout=min(1, remaining())))
            except TimeoutError:
                message = None
            if message is not None:
                kind = message.get('event_type')
                if kind in {'resync_required', 'stream.unavailable'}:
                    raise SmokeFailure('websocket_cannot_supply_current_events')
                if message.get('cursor') is not None:
                    cursor = int(message['cursor'])
                    if cursor < int(measurements['cursor_end']):
                        raise SmokeFailure('delivery_cursor_regressed')
                    measurements['cursor_end'] = str(cursor)
                    checks['cursor_advances'] = cursor > start_cursor
                if kind == 'camera.state.updated':
                    consume_state(message['payload'])
                    measurements['websocket_state_events'] += 1
                    checks['websocket_updates'] = True
                elif kind == 'alert.updated':
                    consume_alert(message['payload'])
            if time.monotonic() >= next_poll:
                snapshot()
                history()
                next_poll = time.monotonic() + 2
            if checks and all(checks.values()):
                break
    result['ok'] = True


def main() -> int:
    parser = argparse.ArgumentParser(description='Prueba real REST/WS de la demo pública sintética, sin credenciales.')
    parser.add_argument('url', help='Origen HTTPS de la demostración, sin ruta ni credenciales')
    parser.add_argument('--allow-local-http', action='store_true', help='Solo para pruebas HTTP en loopback')
    parser.add_argument('--timeout', type=timeout_value, default=90, help='Límite en segundos, mínimo 45 (predeterminado: 90)')
    parser.add_argument('--scenario', choices=['fluido', 'congestion'], default='congestion')
    args = parser.parse_args()
    started = time.monotonic()
    result = {'ok': False, 'test': 'public_demo_rest_websocket', 'scenario': args.scenario,
              'not_accuracy_benchmark': True, 'checks': {}, 'measurements': {}}
    try:
        origin, local_http = demo_origin(args.url, args.allow_local_http)
        result['transport'] = 'loopback_http' if local_http else 'https_tls_verified'
        run(origin, local_http, args.scenario, args.timeout, result)
    except SmokeFailure as error:
        result['failure_code'] = str(error)
    except Exception as error:
        # Library exceptions may embed proxy credentials or source URL details.
        result['failure_code'] = 'transport_or_protocol_failure'
        result['error_type'] = type(error).__name__
    result['measurements']['elapsed_seconds'] = round(time.monotonic() - started, 3)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
