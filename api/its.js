// Public, read-only ITS gateway. The browser never chooses an upstream URL or
// sends its Firebase/operator credentials to the traffic service.
export const DEFAULT_ITS_BACKEND_URL = 'https://safeorute-its-demo.onrender.com';
const RESPONSE_LIMIT = 512 * 1024;
const TIMEOUT_MS = 8500;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = value => value === null || typeof value === 'boolean' ||
  typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
function fields(value, names) {
  const result = {};
  if (!record(value)) return result;
  for (const name of names) if (Object.hasOwn(value, name) && scalar(value[name])) {
    result[name] = typeof value[name] === 'string' ? value[name].slice(0, 2000) : value[name];
  }
  return result;
}
function strings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 100).map(item => item.slice(0, 2000)) : [];
}
function sourceIsDemo(value) {
  return value === undefined || value === null || value === 'demo' || value === 'synthetic';
}
function cause(value) {
  return {...fields(value, ['code', 'description', 'confidence_level']),
    criteria_met: strings(value?.criteria_met), missing_evidence: strings(value?.missing_evidence)};
}
function location(value) {
  return fields(value, ['country', 'city', 'latitude', 'longitude']);
}
function state(value) {
  const result = fields(value, ['camera_id', 'road_segment_id', 'source_mode', 'stream_epoch',
    'media_time_s', 'capture_at', 'received_at', 'arrival_age_seconds', 'capture_age_seconds',
    'calibration_status', 'calibration_rmse_metres', 'calibration_id', 'count_valid',
    'speed_valid', 'mean_speed_kmh', 'congestion', 'congestion_reference', 'total_count',
    'observed_vehicles', 'vehicles_with_speed', 'public_alerts_enabled', 'revision', 'stale',
    'validation_status', 'detector_backend', 'history_coverage_degraded', 'alert_history_coverage_degraded']);
  result.location = location(value.location);
  result.health = {...fields(value.health, ['status', 'usable_for_analytics', 'usable_for_speed',
    'capture_age_seconds', 'arrival_age_seconds', 'time_quality', 'contrast', 'sharpness',
    'static_content_seconds']), issues: strings(value.health?.issues)};
  result.lanes = (Array.isArray(value.lanes) ? value.lanes : []).filter(record).slice(0, 100).map(lane => ({
    ...fields(lane, ['id', 'count', 'mean_speed_kmh', 'count_valid', 'speed_valid', 'observed_vehicles',
      'vehicles_with_speed', 'opposite_direction_observations', 'window_start_media_s', 'coverage_seconds']),
    counts_by_class: fields(lane.counts_by_class, ['carro', 'moto', 'guagua_bus', 'camion']),
  }));
  result.data_quality = {...fields(value.data_quality, ['status', 'time_quality', 'synthetic']),
    reasons: strings(value.data_quality?.reasons)};
  result.probable_causes = (Array.isArray(value.probable_causes) ? value.probable_causes : []).filter(record).slice(0, 20).map(cause);
  return result;
}
function camera(value) {
  const result = fields(value, ['camera_id', 'road_segment_id']);
  result.source = fields(value.source, ['kind', 'mode', 'public_alerts_enabled', 'synthetic_speed_kmh', 'demonstration_label']);
  result.location = location(value.location);
  result.calibration = fields(value.calibration, ['status', 'calibration_id', 'validation_rmse_metres']);
  result.processing = fields(value.processing, ['target_processed_fps', 'free_flow_speed_kmh', 'free_flow_reference']);
  result.lanes = (Array.isArray(value.lanes) ? value.lanes : []).filter(record).slice(0, 100).map(lane => fields(lane, ['id']));
  if (record(value.state)) result.state = state(value.state);
  return result;
}
function alert(value) {
  return {
    ...fields(value, ['alert_id', 'camera_id', 'road_segment_id', 'kind', 'source_mode', 'stream_epoch',
      'opened_at', 'updated_at', 'received_at', 'status', 'revision', 'recommended_action',
      'suppressed', 'acknowledged', 'observation_status', 'observation_stale',
      'last_observation_received_at', 'observation_age_seconds']),
    location: location(value.location),
    observed: (Array.isArray(value.observed) ? value.observed : []).filter(record).slice(0, 100).map(fact => ({
      ...fields(fact, ['fact_code', 'description', 'duration_seconds', 'mean_speed_kmh']),
      issues: strings(fact.issues),
    })),
    probable_causes: (Array.isArray(value.probable_causes) ? value.probable_causes : []).filter(record).slice(0, 20).map(cause),
    publication: fields(value.publication, ['audience', 'public_approved']),
  };
}
function publicSnapshot(value) {
  if (!record(value) || value.demo !== true ||
      !['cameras', 'states', 'alerts'].every(key => Array.isArray(value[key]) && value[key].length <= 100 && value[key].every(record)) ||
      typeof value.cursor !== 'string' || !/^\d{1,19}$/.test(value.cursor) ||
      typeof value.server_time !== 'string' || !Number.isFinite(Date.parse(value.server_time))) {
    throw new Error('invalid-snapshot');
  }
  for (const item of [...value.states, ...value.alerts]) if (!sourceIsDemo(item.source_mode)) throw new Error('non-demo');
  for (const item of value.cameras) {
    if (!sourceIsDemo(item.source_mode) ||
        item.source !== undefined && (!record(item.source) ||
          item.source.kind !== undefined && item.source.kind !== 'synthetic' || !sourceIsDemo(item.source.mode)) ||
        record(item.state) && !sourceIsDemo(item.state.source_mode)) throw new Error('non-demo');
  }
  return {
    demo: true, cameras: value.cameras.map(camera), states: value.states.map(state),
    alerts: value.alerts.map(alert), cursor: value.cursor, server_time: value.server_time,
    capabilities: fields(value.capabilities, ['operator_review']),
  };
}

function backendUrl(options) {
  const configured = options.backendOrigin ?? process.env.ITS_BACKEND_URL ?? DEFAULT_ITS_BACKEND_URL;
  const value = typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_ITS_BACKEND_URL;
  const url = new URL(value);
  const mode = options.mode ?? process.env.NODE_ENV;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && loopback && ['development', 'test'].includes(mode))) {
    throw new Error('invalid-backend');
  }
  return url.origin + '/v1/snapshot';
}
function discard(response) {
  try {response.body?.cancel().catch(() => {});} catch {}
}
async function boundedJson(response, limit) {
  if (!response.body || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    discard(response);
    throw new Error('invalid-response');
  }
  if (Number(response.headers.get('content-length')) > limit) {
    discard(response);
    throw new Error('large-response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        reader.cancel().catch(() => {});
        throw new Error('large-response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {body.set(chunk, offset);offset += chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
}
function send(res, code, value) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = code;
  res.end(JSON.stringify(value));
}

export function createItsHandler(options = {}) {
  return async function itsHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, {error: 'method_not_allowed'});
    }
    let hasQuery;
    try {hasQuery = Boolean(new URL(req.url || '/api/its', 'http://its.invalid').search || req.query && Object.keys(req.query).length);}
    catch {return send(res, 400, {error: 'unsupported_query'});}
    if (hasQuery) {
      return send(res, 400, {error: 'unsupported_query'});
    }
    let upstream;
    try {upstream = backendUrl(options);} catch {return send(res, 503, {error: 'its_unavailable'});}
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    try {
      const response = await (options.fetchImpl ?? globalThis.fetch)(upstream, {
        method: 'GET', headers: {Accept: 'application/json'}, signal: controller.signal,
        redirect: 'manual', cache: 'no-store', credentials: 'omit',
      });
      if (response.status >= 300 && response.status < 400) {
        discard(response);
        return send(res, 502, {error: 'its_invalid_response'});
      }
      if (!response.ok) {
        discard(response);
        return send(res, 503, {error: 'its_unavailable'});
      }
      try {
        const snapshot = publicSnapshot(await boundedJson(response, options.maxResponseBytes ?? RESPONSE_LIMIT));
        return send(res, 200, snapshot);
      } catch {
        return send(res, controller.signal.aborted ? 504 : 502, {error: controller.signal.aborted ? 'its_timeout' : 'its_invalid_response'});
      }
    } catch (error) {
      const timedOut = controller.signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name);
      return send(res, timedOut ? 504 : 503, {error: timedOut ? 'its_timeout' : 'its_unavailable'});
    } finally {
      clearTimeout(timer);
    }
  };
}

export default createItsHandler();

// Vite doesn't execute Vercel functions. Reuse this exact handler in local dev
// and preview, so /api/its has the same behavior in the built PWA and production.
export function itsViteProxy(options = {}) {
  function install(server) {
    const handler = createItsHandler({...options, mode: 'development'});
    server.middlewares.use((req, res, next) => {
      let path;
      try {path = new URL(req.url || '/', 'http://its.invalid').pathname;} catch {return next();}
      if (path !== '/api/its') return next();
      return handler(req, res);
    });
  }
  return {name: 'saferoute-its-api', configureServer: install, configurePreviewServer: install};
}
