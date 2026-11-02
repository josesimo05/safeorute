// Reserve the paid support budget before contacting an AI provider.
// Only counters and server timestamps are persisted; never question text.
import {getFirestore, Timestamp} from 'firebase-admin/firestore';

const UNAVAILABLE = 'SUPPORT_UNAVAILABLE';
const RATE_LIMIT = 'SUPPORT_RATE_LIMIT';
const bounds = {dailyLimit:1000, monthlyLimit:20000, perUserDailyLimit:50};
function failure(code = UNAVAILABLE) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function positiveInteger(value, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw failure();
  return value;
}
function counter(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure();
  return value;
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure();
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw failure();
  return value;
}
function month(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw failure();
  return value;
}
function milliseconds(value) {
  if (!(value instanceof Timestamp)) throw failure();
  const result = value.toMillis();
  if (!Number.isFinite(result)) throw failure();
  return result;
}
function data(snapshot) {
  if (!snapshot || typeof snapshot.exists !== 'boolean' || typeof snapshot.data !== 'function') throw failure();
  if (!snapshot.exists) return null;
  const result = snapshot.data();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw failure();
  return result;
}
function validateUser(value, today) {
  if (!value) return null;
  const at = milliseconds(value.at);
  const storedDay = day(value.day);
  const count = counter(value.count);
  if (storedDay > today || new Date(at).toISOString().slice(0, 10) !== storedDay) throw failure();
  return {day:storedDay, count, at};
}
function validateGlobal(value, today, thisMonth) {
  if (!value) return null;
  const at = milliseconds(value.at);
  const storedDay = day(value.day), storedMonth = month(value.month);
  const dailyCount = counter(value.dailyCount), monthlyCount = counter(value.monthlyCount);
  if (storedDay > today || storedMonth > thisMonth || storedDay.slice(0, 7) !== storedMonth ||
      new Date(at).toISOString().slice(0, 10) !== storedDay || monthlyCount < dailyCount) throw failure();
  return {day:storedDay, month:storedMonth, dailyCount, monthlyCount};
}
function validUid(uid) {
  // _global is the shared budget document, never an identity.
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 &&
    !['.', '..', '_global'].includes(uid) && !/[\/\u0000-\u001f\u007f]/.test(uid);
}

export function createBudgetLimiter(db, {
  now = () => Date.now(), dailyLimit = 50, monthlyLimit = 1000,
  perUserDailyLimit = 10, cooldownMs = 60000,
} = {}) {
  positiveInteger(dailyLimit, bounds.dailyLimit);
  positiveInteger(monthlyLimit, bounds.monthlyLimit);
  positiveInteger(perUserDailyLimit, bounds.perUserDailyLimit);
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 86400000 ||
      typeof now !== 'function' || !db || typeof db.collection !== 'function' ||
      typeof db.runTransaction !== 'function') throw failure();

  return async function reserve(uid) {
    if (!validUid(uid)) throw failure();
    try {
      const collection = db.collection('supportLimits');
      const userRef = collection.doc(uid), globalRef = collection.doc('_global');
      await db.runTransaction(async transaction => {
        // Recompute time on each retry: a transaction may straddle midnight.
        const current = now();
        if (!Number.isSafeInteger(current) || current < 0) throw failure();
        const at = Timestamp.fromMillis(current);
        const today = new Date(current).toISOString().slice(0, 10), thisMonth = today.slice(0, 7);
        // One transactional read of both documents, before any writes.
        const snapshots = await transaction.getAll(userRef, globalRef);
        if (!Array.isArray(snapshots) || snapshots.length !== 2) throw failure();
        const user = validateUser(data(snapshots[0]), today);
        const global = validateGlobal(data(snapshots[1]), today, thisMonth);
        // A user reservation cannot exist without the global side of its
        // transaction. Do not silently reset a missing shared counter.
        if (user && !global) throw failure();
        const userCount = user?.day === today ? user.count : 0;
        const dailyCount = global?.day === today ? global.dailyCount : 0;
        const monthlyCount = global?.month === thisMonth ? global.monthlyCount : 0;
        if (user && current - user.at < cooldownMs || userCount >= perUserDailyLimit ||
            dailyCount >= dailyLimit || monthlyCount >= monthlyLimit) throw failure(RATE_LIMIT);
        transaction.set(userRef, {day:today, count:userCount + 1, at});
        transaction.set(globalRef, {
          day:today, dailyCount:dailyCount + 1, month:thisMonth, monthlyCount:monthlyCount + 1, at,
        });
      });
    } catch (error) {
      // Firestore errors may contain project paths or credentials. Expose
      // stable codes only, including when a transaction callback is retried.
      throw failure(error?.code === RATE_LIMIT ? RATE_LIMIT : UNAVAILABLE);
    }
  };
}

function environmentLimit(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw failure();
  return positiveInteger(Number(raw), maximum);
}

export async function reserveSupportBudget(uid) {
  try {
    const options = {
      dailyLimit:environmentLimit('SUPPORT_AI_DAILY_LIMIT', 50, bounds.dailyLimit),
      monthlyLimit:environmentLimit('SUPPORT_AI_MONTHLY_LIMIT', 1000, bounds.monthlyLimit),
      perUserDailyLimit:environmentLimit('SUPPORT_AI_USER_DAILY_LIMIT', 10, bounds.perUserDailyLimit),
    };
    // The route has already initialized the default Admin app and verified uid.
    await createBudgetLimiter(getFirestore(), options)(uid);
  } catch (error) {
    throw failure(error?.code === RATE_LIMIT ? RATE_LIMIT : UNAVAILABLE);
  }
}
