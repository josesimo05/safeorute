import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';
import {createBudgetLimiter, reserveSupportBudget} from '../server/support-budget.js';

// Serializable, atomic test double for the Firestore transaction contract. It
// does not emulate the Firestore service or require a real Firebase account.
class MemoryFirestore {
  documents = new Map();
  commits = [];
  reads = [];
  tail = Promise.resolve();
  failCommit = false;
  retryNext = false;
  collection(name) {
    assert.equal(name, 'supportLimits');
    return {doc: id => ({path:name + '/' + id})};
  }
  get(id) {return this.documents.get('supportLimits/' + id);}
  change(id, patch) {this.documents.set('supportLimits/' + id, {...this.get(id), ...patch});}
  runTransaction(work) {
    const operation = this.tail.then(async () => {
      const attempt = async () => {
        const writes = [];
        const result = await work({
          getAll: async (...references) => {
            assert.equal(writes.length, 0, 'all reads precede writes');
            assert.equal(references.length, 2);
            this.reads.push(references.map(reference => reference.path));
            return references.map(reference => ({
              exists:this.documents.has(reference.path),
              data:() => this.documents.has(reference.path) ? {...this.documents.get(reference.path)} : undefined,
            }));
          },
          set:(reference, value) => writes.push([reference.path, {...value}]),
        });
        return {writes, result};
      };
      if (this.retryNext) {
        this.retryNext = false;
        await attempt(); // The first tentative writes are discarded.
      }
      const {writes, result} = await attempt();
      if (this.failCommit) {
        this.failCommit = false;
        throw new Error('native failure with private-project-path');
      }
      for (const [path, value] of writes) this.documents.set(path, value);
      this.commits.push(writes);
      return result;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}

const initialTime = Date.parse('2026-11-02T14:15:16.123Z');
const rejectedWith = code => error => error.code === code && error.message === code;

test('support reservations persist only counters and actual server Timestamp values in one transaction', async () => {
  const db = new MemoryFirestore();
  await createBudgetLimiter(db, {now:() => initialTime})('user-1');
  assert.equal(db.commits.length, 1);
  assert.deepEqual(db.reads, [['supportLimits/user-1', 'supportLimits/_global']]);
  assert.deepEqual(Object.keys(db.get('user-1')).sort(), ['at', 'count', 'day']);
  assert.deepEqual(Object.keys(db.get('_global')).sort(), ['at', 'dailyCount', 'day', 'month', 'monthlyCount']);
  assert.equal(db.get('user-1').count, 1);
  assert.equal(db.get('_global').dailyCount, 1);
  assert.equal(db.get('_global').monthlyCount, 1);
  assert.equal(db.get('_global').month, '2026-11');
  assert.equal(db.get('user-1').day, '2026-11-02');
  for (const document of db.documents.values()) {
    assert.ok(document.at instanceof Timestamp);
    assert.equal(document.at.toMillis(), initialTime);
    assert.ok(!Object.keys(document).some(key => /question|text|prompt|email|token|answer/i.test(key)));
  }
});

test('support cooldown uses server timestamps and allows the exact sixty-second boundary', async () => {
  const db = new MemoryFirestore();
  let current = initialTime;
  const reserve = createBudgetLimiter(db, {now:() => current});
  await reserve('same-user');
  current += 59999;
  await assert.rejects(reserve('same-user'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('same-user').count, 1);
  current++;
  await reserve('same-user');
  assert.equal(db.get('same-user').count, 2);
  assert.equal(db.get('same-user').at.toMillis(), current);
});

test('support per-user daily limit survives a new limiter instance sharing the database', async () => {
  const db = new MemoryFirestore();
  const options = {now:() => initialTime, cooldownMs:0, perUserDailyLimit:2};
  await createBudgetLimiter(db, options)('person');
  await createBudgetLimiter(db, options)('person');
  await assert.rejects(createBudgetLimiter(db, options)('person'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('person').count, 2);
  assert.equal(db.get('_global').dailyCount, 2);
});

test('support global limits remain atomic across one hundred concurrent requests and shared limiters', async () => {
  const db = new MemoryFirestore();
  const options = {now:() => initialTime, dailyLimit:7, monthlyLimit:17, cooldownMs:0};
  const first = createBudgetLimiter(db, options), second = createBudgetLimiter(db, options);
  const results = await Promise.allSettled(Array.from({length:100}, (_, index) =>
    (index % 2 ? first : second)('user-' + index)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 7);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'SUPPORT_RATE_LIMIT').length, 93);
  assert.equal(db.get('_global').dailyCount, 7);
  assert.equal(db.get('_global').monthlyCount, 7);
  assert.equal(db.documents.size, 8);
  await assert.rejects(createBudgetLimiter(db, options)('after-restart'), rejectedWith('SUPPORT_RATE_LIMIT'));
});

test('the default ceilings enforce ten per user, fifty per UTC day and one thousand per month', async () => {
  const userDb = new MemoryFirestore();
  let userTime = initialTime;
  const userReserve = createBudgetLimiter(userDb, {now:() => userTime});
  for (let index = 0; index < 10; index++) {
    await userReserve('person');
    userTime += 60000;
  }
  await assert.rejects(userReserve('person'), rejectedWith('SUPPORT_RATE_LIMIT'));
  const db = new MemoryFirestore();
  const start = Date.parse('2026-11-01T12:00:00Z');
  let current = start;
  const reserve = createBudgetLimiter(db, {now:() => current});
  for (let dayIndex = 0; dayIndex < 20; dayIndex++) {
    current = start + dayIndex * 86400000;
    for (let index = 0; index < 50; index++) await reserve('person-' + index);
    await assert.rejects(reserve('extra-daily'), rejectedWith('SUPPORT_RATE_LIMIT'));
    assert.equal(db.get('_global').dailyCount, 50);
  }
  current += 86400000;
  await assert.rejects(reserve('extra-monthly'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('_global').monthlyCount, 1000);
  current = Date.parse('2026-12-01T00:00:00Z');
  await reserve('new-month');
  assert.equal(db.get('_global').monthlyCount, 1);
});

test('support monthly counter survives UTC day changes and resets only in the next month', async () => {
  const db = new MemoryFirestore();
  let current = Date.parse('2026-01-30T12:00:00Z');
  const reserve = createBudgetLimiter(db, {now:() => current, dailyLimit:3, monthlyLimit:5, cooldownMs:0});
  for (let index = 0; index < 3; index++) await reserve('day-one-' + index);
  current = Date.parse('2026-01-31T12:00:00Z');
  await reserve('day-two-a');
  await reserve('day-two-b');
  await assert.rejects(reserve('day-two-c'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('_global').dailyCount, 2);
  assert.equal(db.get('_global').monthlyCount, 5);
  current = Date.parse('2026-02-01T00:00:00Z');
  await reserve('day-one-0');
  assert.equal(db.get('_global').day, '2026-02-01');
  assert.equal(db.get('_global').month, '2026-02');
  assert.equal(db.get('_global').dailyCount, 1);
  assert.equal(db.get('_global').monthlyCount, 1);
  assert.equal(db.get('day-one-0').count, 1);
});

test('support cooldown still applies across a UTC midnight reset', async () => {
  const db = new MemoryFirestore();
  let current = Date.parse('2026-11-02T23:59:50Z');
  const reserve = createBudgetLimiter(db, {now:() => current});
  await reserve('person');
  current = Date.parse('2026-11-03T00:00:10Z');
  await assert.rejects(reserve('person'), rejectedWith('SUPPORT_RATE_LIMIT'));
  current = Date.parse('2026-11-03T00:00:50Z');
  await reserve('person');
  assert.equal(db.get('person').count, 1);
  assert.equal(db.get('_global').dailyCount, 1);
  assert.equal(db.get('_global').monthlyCount, 2);
});

test('a failed paid call consumes its prior reservation and cannot reset the daily quota', async () => {
  const db = new MemoryFirestore();
  let current = initialTime;
  const reserve = createBudgetLimiter(db, {now:() => current, perUserDailyLimit:1});
  await reserve('person');
  await assert.rejects(Promise.reject(new Error('simulated provider failure')));
  current += 60000;
  await assert.rejects(reserve('person'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('_global').monthlyCount, 1);
  assert.equal(db.get('person').count, 1);
});

test('failed database commits do not partially charge, reset existing counters or leak native errors', async () => {
  const db = new MemoryFirestore();
  const reserve = createBudgetLimiter(db, {now:() => initialTime, cooldownMs:0});
  await reserve('first');
  db.failCommit = true;
  await assert.rejects(reserve('second'), rejectedWith('SUPPORT_UNAVAILABLE'));
  assert.equal(db.get('second'), undefined);
  assert.equal(db.get('_global').dailyCount, 1);
  await reserve('second');
  assert.equal(db.get('_global').dailyCount, 2);
  assert.equal(db.get('_global').monthlyCount, 2);
});

test('retried support transactions recompute UTC time and commit the reservation only once', async () => {
  const db = new MemoryFirestore();
  const moments = [Date.parse('2026-01-31T23:59:59Z'), Date.parse('2026-02-01T00:00:01Z')];
  db.retryNext = true;
  await createBudgetLimiter(db, {now:() => moments.shift()})('person');
  assert.equal(db.commits.length, 1);
  assert.equal(db.get('person').count, 1);
  assert.equal(db.get('_global').dailyCount, 1);
  assert.equal(db.get('_global').monthlyCount, 1);
  assert.equal(db.get('_global').day, '2026-02-01');
  assert.equal(db.get('_global').at.toMillis(), Date.parse('2026-02-01T00:00:01Z'));
});

test('corrupt support counter and timestamp records fail closed instead of resetting quotas', async () => {
  const changes = [
    ...[NaN, Infinity, -1, 1.5, '1', undefined].map(value => db => db.change('person', {count:value})),
    ...[NaN, Infinity, -1, .5, '1'].map(value => db => db.change('_global', {monthlyCount:value})),
    db => db.change('person', {at:new Date(initialTime)}),
    db => db.change('person', {at:initialTime}),
    db => db.change('person', {day:'2026-02-30'}),
    db => db.change('person', {day:'2026-11-01'}),
    db => db.change('_global', {month:'2026-13'}),
    db => db.change('_global', {month:'2026-10'}),
    db => db.change('_global', {dailyCount:2, monthlyCount:1}),
    db => db.documents.delete('supportLimits/_global'),
  ];
  for (const change of changes) {
    const db = new MemoryFirestore();
    const reserve = createBudgetLimiter(db, {now:() => initialTime, cooldownMs:0});
    await reserve('person');
    change(db);
    await assert.rejects(reserve('person'), rejectedWith('SUPPORT_UNAVAILABLE'));
    assert.equal(db.commits.length, 1);
  }
});

test('lowering a valid configured limit blocks existing usage without rewriting it', async () => {
  const db = new MemoryFirestore();
  const first = createBudgetLimiter(db, {now:() => initialTime, cooldownMs:0});
  for (let index = 0; index < 5; index++) await first('user-' + index);
  const lower = createBudgetLimiter(db, {now:() => initialTime, dailyLimit:3, cooldownMs:0});
  await assert.rejects(lower('another-user'), rejectedWith('SUPPORT_RATE_LIMIT'));
  assert.equal(db.get('_global').dailyCount, 5);
});

test('malformed support options and unsafe document identities fail closed before a transaction', async () => {
  const db = new MemoryFirestore();
  for (const badDb of [null, {}, {collection() {}}]) {
    assert.throws(() => createBudgetLimiter(badDb), rejectedWith('SUPPORT_UNAVAILABLE'));
  }
  for (const options of [{dailyLimit:0}, {dailyLimit:1001}, {dailyLimit:'50'}, {monthlyLimit:20001},
    {monthlyLimit:NaN}, {perUserDailyLimit:51}, {perUserDailyLimit:1.5}, {cooldownMs:-1}, {now:123}]) {
    assert.throws(() => createBudgetLimiter(db, options), rejectedWith('SUPPORT_UNAVAILABLE'));
  }
  const reserve = createBudgetLimiter(db);
  for (const uid of ['', '_global', '.', '..', 'private-user/path', 'x'.repeat(129), null, 123]) {
    await assert.rejects(reserve(uid), rejectedWith('SUPPORT_UNAVAILABLE'));
  }
  assert.equal(db.reads.length, 0);
  assert.equal(db.commits.length, 0);
  await assert.rejects(createBudgetLimiter(db, {now:() => NaN})('person'), rejectedWith('SUPPORT_UNAVAILABLE'));
});

test('the default support helper reads bounded environment limits and reuses the initialized Admin app', async t => {
  const app = initializeApp({projectId:'support-budget-unit-test'});
  const firestore = getFirestore(app), db = new MemoryFirestore();
  t.mock.method(firestore, 'collection', name => db.collection(name));
  t.mock.method(firestore, 'runTransaction', work => db.runTransaction(work));
  let current = initialTime;
  t.mock.method(Date, 'now', () => current);
  const names = ['SUPPORT_AI_DAILY_LIMIT', 'SUPPORT_AI_MONTHLY_LIMIT', 'SUPPORT_AI_USER_DAILY_LIMIT'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.SUPPORT_AI_DAILY_LIMIT = '2';
    process.env.SUPPORT_AI_MONTHLY_LIMIT = '3';
    process.env.SUPPORT_AI_USER_DAILY_LIMIT = '1';
    await reserveSupportBudget('a');
    await assert.rejects(reserveSupportBudget('a'), rejectedWith('SUPPORT_RATE_LIMIT'));
    await reserveSupportBudget('b');
    await assert.rejects(reserveSupportBudget('c'), rejectedWith('SUPPORT_RATE_LIMIT'));
    current += 86400000;
    await reserveSupportBudget('c');
    await assert.rejects(reserveSupportBudget('d'), rejectedWith('SUPPORT_RATE_LIMIT'));
    process.env.SUPPORT_AI_MONTHLY_LIMIT = '4';
    await reserveSupportBudget('d');
    assert.equal(db.get('_global').monthlyCount, 4);
    const reads = db.reads.length;
    for (const [name, value] of [
      ['SUPPORT_AI_DAILY_LIMIT','1001'], ['SUPPORT_AI_MONTHLY_LIMIT','20001'],
      ['SUPPORT_AI_USER_DAILY_LIMIT','51'], ['SUPPORT_AI_DAILY_LIMIT','0'],
      ['SUPPORT_AI_DAILY_LIMIT','NaN'], ['SUPPORT_AI_DAILY_LIMIT','2.5'],
      ['SUPPORT_AI_DAILY_LIMIT',''], ['SUPPORT_AI_DAILY_LIMIT',' 2'],
    ]) {
      const old = process.env[name];
      process.env[name] = value;
      await assert.rejects(reserveSupportBudget('invalid-configuration'), rejectedWith('SUPPORT_UNAVAILABLE'));
      process.env[name] = old;
    }
    assert.equal(db.reads.length, reads);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await deleteApp(app);
  }
});
