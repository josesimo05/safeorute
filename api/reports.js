import {getApp, initializeApp, cert} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {validate} from '../src/logic.js';
import {normalizeCedula, anonymousGuestUid, createGuestReportService} from '../server/guest-reports.js';

const MAX_BODY_BYTES = 8192;
const REPORT_KEYS = ['category', 'description', 'lat', 'lng', 'occurredAt'];

function settings() {
  const flag = process.env.REPORT_GUEST_ID_ENABLED;
  if (flag === undefined || flag === '' || flag === 'false') return {enabled: false};
  if (flag !== 'true') throw new Error('invalid-reporting-settings');
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const secret = process.env.REPORT_ID_HMAC_KEY;
  if (!serviceAccount || typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 || Buffer.byteLength(secret, 'utf8') > 4096) throw new Error('reporting-settings-missing');
  return {enabled: true, serviceAccount, secret};
}

function appFor(config) {
  // A named Admin app avoids accidentally sharing credentials with an optional
  // AI route in the local Vite process. Never expose account/parser errors.
  const account = JSON.parse(config.serviceAccount);
  if (typeof account.project_id !== 'string' || !account.project_id) throw new Error('missing-project');
  const name = 'saferoute-guest-reports';
  let app;
  try {app = getApp(name);} catch {app = initializeApp({projectId: account.project_id, credential: cert(account)}, name);}
  if (app.options.projectId !== account.project_id) throw new Error('reporting-project-changed');
  return app;
}

async function authenticate(token, config) {
  const identity = await getAuth(appFor(config)).verifyIdToken(token, true);
  return anonymousGuestUid(identity);
}

function service(config) {
  return createGuestReportService(getFirestore(appFor(config)), {secret: config.secret});
}

function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function invalid(code = 'REPORTS_INVALID_REQUEST') {
  return Object.assign(new Error(code), {code});
}

async function bodyOf(req) {
  const declaredSize = req.headers?.['content-length'];
  if (declaredSize !== undefined && (!/^\d+$/.test(String(declaredSize)) || Number(declaredSize) > MAX_BODY_BYTES)) throw invalid('REPORTS_BODY_TOO_LARGE');
  if (req.body !== undefined) {
    // Vercel may already have parsed JSON; raw strings must be bounded before
    // parsing, including irrelevant whitespace around a small JSON object.
    if (typeof req.body === 'string' && Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) throw invalid('REPORTS_BODY_TOO_LARGE');
    const value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (Buffer.byteLength(JSON.stringify(value) || '', 'utf8') > MAX_BODY_BYTES) throw invalid('REPORTS_BODY_TOO_LARGE');
    return value;
  }
  if (!req[Symbol.asyncIterator]) throw invalid();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw invalid('REPORTS_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function validatedSubmission(body) {
  if (!exactObject(body, ['report', 'cedula']) || !exactObject(body.report, REPORT_KEYS)) throw invalid();
  const cedula = normalizeCedula(body.cedula);
  const report = body.report;
  if (!cedula || typeof report.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.occurredAt) || validate(report)) throw invalid();
  const time = new Date(report.occurredAt);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== report.occurredAt) throw invalid();
  return {cedula, report: {
    category: report.category, description: report.description.trim(), occurredAt: report.occurredAt,
    // Privacy precision is enforced server-side even when a modified client
    // sends exact coordinates. No precise client coordinate is persisted.
    lat: Number(report.lat.toFixed(3)), lng: Number(report.lng.toFixed(3)),
  }};
}

export function createReportsHandler(options = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, {error: 'REPORTS_INVALID_REQUEST'});
    }
    let config;
    try {config = (options.settings || settings)();} catch {return send(res, 503, {error: 'REPORTS_UNAVAILABLE'});}
    // Explicit staged rollout: installations with no enabled server flag keep
    // their existing anonymous report flow and do not collect national IDs.
    if (!config?.enabled) return req.method === 'GET'
      ? send(res, 200, {guestIdentityEnabled: false})
      : send(res, 503, {error: 'REPORTS_NOT_CONFIGURED'});
    if (req.method === 'GET') {
      try {
        const backend = (options.service || service)(config);
        if (!await backend.enabled()) return send(res, 503, {error: 'REPORTS_NOT_CONFIGURED'});
        return send(res, 200, {guestIdentityEnabled: true});
      } catch {return send(res, 503, {error: 'REPORTS_UNAVAILABLE'});}
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return send(res, 400, {error: 'REPORTS_INVALID_REQUEST'});
    let submission;
    try {submission = validatedSubmission(await bodyOf(req));} catch (error) {
      return send(res, error?.code === 'REPORTS_BODY_TOO_LARGE' ? 413 : 400,
        {error: error?.code === 'REPORTS_BODY_TOO_LARGE' ? 'REPORTS_BODY_TOO_LARGE' : 'REPORTS_INVALID_REQUEST'});
    }
    const authorization = req.headers?.authorization;
    const token = typeof authorization === 'string' ? authorization.match(/^Bearer (\S{1,8192})$/)?.[1] : null;
    if (!token) return send(res, 401, {error: 'REPORTS_AUTH_REQUIRED'});
    let uid;
    try {uid = await (options.authenticate || authenticate)(token, config);} catch {return send(res, 401, {error: 'REPORTS_AUTH_REQUIRED'});}
    try {
      // Malformed/unauthenticated POST requests never read private policy or
      // quotas. The transaction checks the policy again before any write.
      const backend = (options.service || service)(config);
      if (!await backend.enabled()) return send(res, 503, {error: 'REPORTS_NOT_CONFIGURED'});
      const result = await backend.submit({...submission, uid});
      return send(res, 201, {id: result.id, status: 'pending'});
    } catch (error) {
      const code = ['REPORTS_RATE_LIMIT', 'REPORTS_NOT_CONFIGURED'].includes(error?.code) ? error.code : 'REPORTS_UNAVAILABLE';
      return send(res, code === 'REPORTS_RATE_LIMIT' ? 429 : 503, {error: code});
    }
  };
}

export default createReportsHandler();

export function reportsViteProxy(options = {}) {
  const install = server => {
    const handler = createReportsHandler(options);
    server.middlewares.use((req, res, next) => {
      if ((req.url || '').split('?')[0] !== '/api/reports') return next();
      return handler(req, res);
    });
  };
  return {name: 'saferoute-reports-api', configureServer: install, configurePreviewServer: install};
}
