// Server-only guest submission: national ID numbers are transient input, never
// document fields or log messages. HMACs rotate by UTC day and stay private.
import {createHmac} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {validate} from '../src/logic.js';

export const REPORTS_UNAVAILABLE = 'REPORTS_UNAVAILABLE';
export const REPORTS_RATE_LIMIT = 'REPORTS_RATE_LIMIT';
export const REPORTS_NOT_CONFIGURED = 'REPORTS_NOT_CONFIGURED';

function failure(code = REPORTS_UNAVAILABLE) {
  return Object.assign(new Error(code), {code});
}

export function normalizeCedula(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^[0-9 -]+$/.test(value)) return null;
  const normalized = value.replace(/[ -]/g, '');
  // This is a format check only. There is no registry lookup or identity proof.
  return /^[0-9]{11}$/.test(normalized) ? normalized : null;
}

export function identityDigest(secret, day, normalizedCedula) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) || normalizeCedula(normalizedCedula) !== normalizedCedula) throw failure();
  return createHmac('sha256', secret).update(`saferoute-guest-v1\0${day}\0${normalizedCedula}`, 'utf8').digest('hex');
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 &&
    !['.', '..'].includes(uid) && !/[\/\u0000-\u001f\u007f]/.test(uid);
}

// Call only after Firebase Admin has verified the token signature, issuer,
// audience and revocation status. This helper validates decoded claim shape.
export function anonymousGuestUid(identity) {
  if (!validUid(identity?.uid) || identity.firebase?.sign_in_provider !== 'anonymous') throw failure();
  return identity.uid;
}

function snapshotData(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean' || typeof snapshot.data !== 'function') throw failure();
  if (!snapshot.exists) return null;
  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  return value;
}

function policyEnabled(snapshot) {
  const policy = snapshotData(snapshot);
  if (!policy) return false;
  if (typeof policy.requireGuestIdentity !== 'boolean') throw failure();
  return policy.requireGuestIdentity;
}

function timestampMillis(value) {
  if (!(value instanceof Timestamp)) throw failure();
  const result = value.toMillis();
  if (!Number.isSafeInteger(result) || result < 0) throw failure();
  return result;
}

export function createGuestReportService(db, {secret, now = () => Date.now(), dailyLimit = 10, cooldownMs = 60_000} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function' ||
      typeof now !== 'function' || typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100 ||
      !Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 86400_000) throw failure();
  const policyRef = db.collection('systemPolicies').doc('reporting');
  return {
    async enabled() {
      try {return policyEnabled(await policyRef.get());} catch {throw failure();}
    },
    async submit({uid, cedula, report}) {
      if (!validUid(uid) || normalizeCedula(cedula) !== cedula || !report || validate(report)) throw failure();
      // Keep the persistence boundary explicit as well as validating the HTTP
      // contract. An internal caller cannot accidentally add identity fields.
      const publicReport = {
        category: report.category, description: report.description.trim(), occurredAt: report.occurredAt,
        lat: Number(report.lat.toFixed(3)), lng: Number(report.lng.toFixed(3)),
      };
      const reportRef = db.collection('reports').doc();
      const uidRef = db.collection('submissionLimits').doc(uid);
      try {
        await db.runTransaction(async transaction => {
          // Recompute day/digest on each retry, including a retry at midnight.
          const current = now();
          if (!Number.isSafeInteger(current) || current < 0) throw failure();
          const day = new Date(current).toISOString().slice(0, 10);
          const identityRef = db.collection('guestIdentityLimits').doc(identityDigest(secret, day, cedula));
          const snapshots = await transaction.getAll(policyRef, uidRef, identityRef);
          if (!Array.isArray(snapshots) || snapshots.length !== 3) throw failure();
          if (!policyEnabled(snapshots[0])) throw failure(REPORTS_NOT_CONFIGURED);
          const user = snapshotData(snapshots[1]), identity = snapshotData(snapshots[2]);
          let identityCount = 0;
          if (user) {
            const at = timestampMillis(user.at);
            if (at > current || typeof user.lastReport !== 'string' || !user.lastReport || user.lastReport.includes('/')) throw failure();
            if (current - at < cooldownMs) throw failure(REPORTS_RATE_LIMIT);
          }
          if (identity) {
            const at = timestampMillis(identity.at), expiry = timestampMillis(identity.expiresAt);
            if (identity.day !== day || new Date(at).toISOString().slice(0, 10) !== day || at > current || expiry <= at ||
                !Number.isSafeInteger(identity.count) || identity.count < 1 || identity.count > dailyLimit) throw failure();
            identityCount = identity.count;
            if (current - at < cooldownMs || identityCount >= dailyLimit) throw failure(REPORTS_RATE_LIMIT);
          }
          const at = Timestamp.fromMillis(current);
          // At most 48 h from creation. Firestore TTL must be configured by the
          // operator; this field alone does not delete a document automatically.
          const expiresAt = Timestamp.fromMillis(Date.parse(`${day}T00:00:00.000Z`) + 2 * 86400_000);
          transaction.create(reportRef, {...publicReport, status: 'pending', source: 'community', createdAt: at});
          transaction.set(uidRef, {at, lastReport: reportRef.id});
          transaction.set(identityRef, {day, at, count: identityCount + 1, expiresAt});
        });
        return {id: reportRef.id, status: 'pending'};
      } catch (error) {
        const code = [REPORTS_RATE_LIMIT, REPORTS_NOT_CONFIGURED].includes(error?.code) ? error.code : REPORTS_UNAVAILABLE;
        throw failure(code);
      }
    },
  };
}
