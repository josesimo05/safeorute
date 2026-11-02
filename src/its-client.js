// Public synthetic ITS metadata only. No account token or GPS is sent here.
export const ITS_SNAPSHOT_PATH = '/api/its';
export const ITS_POLL_MS = 8000;
export const ITS_STALE_MS = 15000;

const number = value => typeof value === 'number' && Number.isFinite(value);
const count = value => number(value) && Number.isInteger(value) && value >= 0 && value <= 1e9 ? value : null;
const text = (value, length = 200) => typeof value === 'string' ? value.slice(0, length) : '';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const congestionCodes = new Set(['fluido', 'moderado', 'denso', 'detenido']);
const usableHealth = new Set(['healthy', 'ok', 'degraded']);

export function itsCoordinates(location) {
  const value = object(location);
  return number(value.latitude) && Math.abs(value.latitude) <= 90
    && number(value.longitude) && Math.abs(value.longitude) <= 180
    ? {latitude: value.latitude, longitude: value.longitude} : null;
}

function normalizeState(value) {
  const state = object(value);
  if (!['demo', 'synthetic'].includes(state.source_mode)) return null;
  const health = object(state.health);
  return {
    receivedAtMs: timestamp(state.received_at), captureAtMs: timestamp(state.capture_at),
    receivedAt: text(state.received_at, 60), stale: state.stale === true,
    health: text(health.status, 60) || 'unknown',
    usable: health.usable_for_analytics !== false && health.usable_for_speed !== false,
    speedValid: state.speed_valid === true,
    speedKmh: number(state.mean_speed_kmh) && state.mean_speed_kmh >= 0 && state.mean_speed_kmh <= 400 ? state.mean_speed_kmh : null,
    countValid: state.count_valid === true, totalCount: count(state.total_count),
    congestion: congestionCodes.has(state.congestion) ? state.congestion : 'desconocido',
    lanes: (Array.isArray(state.lanes) ? state.lanes : []).slice(0, 30).map(lane => ({
      id: text(lane?.id, 96), count: lane?.count_valid === true ? count(lane.count) : null,
    })),
  };
}

/** Timing is anchored to an advancing server clock, never to fetch completion. */
export function normalizeItsSnapshot(payload, {receivedAt = Date.now(), requestStartedAt = receivedAt, responseTimeMs = null, previousTiming = null} = {}) {
  const input = object(payload);
  if (input.demo !== true || !Array.isArray(input.cameras) || !Array.isArray(input.states) || !Array.isArray(input.alerts)) {
    throw new Error('ITS_INVALID_DEMO');
  }
  const serverTimeMs = timestamp(input.server_time);
  // The same-origin gateway's HTTP Date (plus cache Age, when provided) is an
  // independent clock anchor if the upstream snapshot itself was cached.
  const clockTimeMs = number(responseTimeMs) ? responseTimeMs : serverTimeMs;
  let offsetMs = previousTiming?.offsetMs ?? 0;
  if (clockTimeMs !== null && (!previousTiming || clockTimeMs > (previousTiming.clockTimeMs ?? -Infinity))) {
    const candidate = clockTimeMs - (requestStartedAt + receivedAt) / 2;
    // A repeated/old snapshot must not make received_at new again. Retain the
    // existing offset through abrupt changes rather than refreshing old data.
    if (!previousTiming || Math.abs(candidate - offsetMs) <= 2000) offsetMs = candidate;
  }
  const timing = {offsetMs, serverTimeMs,
    clockTimeMs: Math.max(clockTimeMs ?? -Infinity, previousTiming?.clockTimeMs ?? -Infinity)};
  const states = new Map();
  for (const state of input.states.slice(0, 100)) {
    const id = text(state?.camera_id, 96);
    if (id) states.set(id, normalizeState(state));
  }
  const cameras = [];
  const ids = new Set();
  for (const item of input.cameras.slice(0, 50)) {
    const source = object(item?.source);
    const id = text(item?.camera_id || item?.id, 96);
    if (!id || ids.has(id) || source.kind !== 'synthetic' || source.mode !== 'demo') continue;
    const rawLocation = object(item.location), coordinates = itsCoordinates(rawLocation);
    ids.add(id);
    cameras.push({
      id, demo: true,
      label: text(item.name || item.camera_id || item.id, 120),
      demonstrationLabel: text(source.demonstration_label, 180),
      location: {latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null,
        country: text(rawLocation.country, 2).toUpperCase(), city: text(rawLocation.city, 180)},
      state: states.has(id) ? states.get(id) : normalizeState(item.state),
    });
  }
  const alerts = [];
  for (const item of input.alerts.slice(0, 200)) {
    if (!ids.has(item?.camera_id) || !['demo', 'synthetic'].includes(item.source_mode)
        || item.status !== 'open' || item.suppressed === true || item.review?.action === 'suppress') continue;
    const id = text(item.alert_id || item.id, 96);
    if (!id) continue;
    const observed = (Array.isArray(item.observed) ? item.observed : []).slice(0, 8).map(fact => ({
      description: text(fact?.description, 400),
      speedKmh: number(fact?.mean_speed_kmh) ? fact.mean_speed_kmh : null,
      durationSeconds: number(fact?.duration_seconds) && fact.duration_seconds >= 0 ? fact.duration_seconds : null,
    }));
    const causes = (Array.isArray(item.probable_causes) ? item.probable_causes : []).slice(0, 4).map(cause => ({
      description: text(cause?.description, 400),
      confidence: ['alto', 'medio', 'bajo'].includes(cause?.confidence_level) ? cause.confidence_level : null,
    }));
    alerts.push({id, cameraId: item.camera_id, kind: text(item.kind, 60),
      openedAtMs: timestamp(item.opened_at), observationStale: item.observation_stale === true,
      observed, causes, recommendation: text(item.recommended_action, 400)});
  }
  return {cameras, alerts, timing};
}

export function itsCameraViews(snapshot, nowMs = Date.now(), country = 'all') {
  if (!snapshot) return [];
  const code = String(country).toUpperCase();
  return snapshot.cameras.filter(camera => country === 'all' || camera.location.country === code).map(camera => {
    const state = camera.state;
    const elapsed = state?.receivedAtMs === null || !state ? null : nowMs + snapshot.timing.offsetMs - state.receivedAtMs;
    const stale = !state || state.stale || elapsed === null || elapsed > ITS_STALE_MS || elapsed < -5000;
    const usable = !stale && state.usable && usableHealth.has(state.health);
    return {
      id: camera.id, label: camera.label, location: camera.location, demo: true,
      demonstrationLabel: camera.demonstrationLabel, stale, usable,
      speedKmh: usable && state.speedValid ? state.speedKmh : null,
      count: usable && state.countValid ? state.totalCount : null,
      congestion: usable && state.speedValid && state.speedKmh !== null ? state.congestion : 'desconocido',
      health: stale ? 'stale' : state.health, receivedAtMs: state?.receivedAtMs ?? null,
      captureAtMs: state?.captureAtMs ?? null, ageSeconds: elapsed === null ? null : Math.max(0, Math.floor(elapsed / 1000)),
      lanes: (state?.lanes || []).map(lane => ({...lane, count: usable && state.countValid ? lane.count : null})),
    };
  });
}

export async function fetchItsSnapshot({signal, fetchImpl = fetch, previousTiming = null, now = Date.now} = {}) {
  const started = now();
  const response = await fetchImpl(ITS_SNAPSHOT_PATH, {signal, cache: 'no-store', credentials: 'omit', headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error('ITS_UNAVAILABLE');
  const responseDate = timestamp(response.headers?.get?.('date'));
  const ageHeader = response.headers?.get?.('age');
  const ageSeconds = typeof ageHeader === 'string' && /^\d+$/.test(ageHeader) ? Number(ageHeader) : 0;
  const responseTimeMs = responseDate === null ? null : responseDate + ageSeconds * 1000;
  return normalizeItsSnapshot(await response.json(), {requestStartedAt: started, receivedAt: now(), responseTimeMs, previousTiming});
}
