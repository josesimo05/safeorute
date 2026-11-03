import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Timestamp} from 'firebase-admin/firestore';
import {createReportsHandler} from '../api/reports.js';
import {normalizeCedula, anonymousGuestUid, identityDigest, createGuestReportService} from '../server/guest-reports.js';

const SECRET = 'private-test-key-with-more-than-32-bytes';
const ID = '00112345678';
const CURRENT = Date.parse('2026-11-02T12:00:00.000Z');
const REPORT = {category: 'Otro', description: 'Semáforo averiado: Reporte comunitario.', lat: 18.476421, lng: -69.943281, occurredAt: '2026-01-01T12:00:00.000Z'};
const snapshot = value => ({exists: value !== undefined, data: () => value});
const response = () => ({statusCode:0, headers:{}, setHeader(key, value) {this.headers[key] = value;}, end(value) {this.value = JSON.parse(value); this.writableEnded = true;}});
const request = (body = {report: REPORT, cedula: '001-1234567-8'}) => ({method:'POST', headers:{'content-type':'application/json', authorization:'Bearer test-guest-token'}, body});
const failed = code => error => error.code === code && error.message === code;

// This atomic serializable double checks the real Admin transaction contract,
// including reading every quota before writing and discarded retry writes.
class MemoryFirestore {
  documents = new Map([['systemPolicies/reporting', {requireGuestIdentity:true}]]);
  commits = [];
  reads = [];
  sequence = 0;
  tail = Promise.resolve();
  failCommit = false;
  retryNext = false;
  beforeRetry = null;
  collection(name) {
    assert.ok(['reports','systemPolicies','submissionLimits','guestIdentityLimits'].includes(name));
    return {doc: id => {
      const value = id || `report-${++this.sequence}`;
      const path = `${name}/${value}`;
      return {id:value, path, get:async () => snapshot(this.documents.get(path))};
    }};
  }
  runTransaction(work) {
    const operation = this.tail.then(async () => {
      const attempt = async () => {
        const writes = [];
        await work({
          getAll:async (...references) => {
            assert.equal(writes.length, 0);
            this.reads.push(references.map(reference => reference.path));
            return references.map(reference => snapshot(this.documents.get(reference.path)));
          },
          create:(reference,value) => {assert.ok(!this.documents.has(reference.path)); writes.push([reference.path, value]);},
          set:(reference,value) => writes.push([reference.path,value]),
        });
        return writes;
      };
      if (this.retryNext) {
        this.retryNext = false;
        await attempt();
        this.beforeRetry?.();
      }
      const writes = await attempt();
      if (this.failCommit) throw new Error('private credential/project failure');
      for (const [path,value] of writes) this.documents.set(path,value);
      this.commits.push(writes);
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}

function setup(overrides = {}) {
  const calls = [];
  const backend = {
    enabled:async () => {calls.push(['policy']); return true;},
    submit:async value => {calls.push(['submit',value]); return {id:'created-report',status:'pending'};},
  };
  const handler = createReportsHandler({settings:() => ({enabled:true, secret:SECRET}),
    authenticate:async token => {calls.push(['auth',token]); return 'anonymous-user';}, service:() => backend, ...overrides});
  return {handler,calls,backend};
}

test('cédula format normalization does not pretend to verify registry ownership', () => {
  assert.equal(normalizeCedula(ID), ID);
  assert.equal(normalizeCedula('001-1234567-8'), ID);
  assert.equal(normalizeCedula('001 1234567 8'), ID);
  for (const invalid of [undefined, 112345678, '', '0011234567', '001123456789', '001.1234567.8', '001\n12345678', '٠٠١١٢٣٤٥٦٧٨', 'x'.repeat(40)]) assert.equal(normalizeCedula(invalid), null);
});

test('HMAC fingerprints require a private key and differ across UTC days and keys', () => {
  const digest = identityDigest(SECRET, '2026-11-02', ID);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, identityDigest(SECRET, '2026-11-02', ID));
  assert.notEqual(digest, identityDigest(SECRET, '2026-11-03', ID));
  assert.notEqual(digest, identityDigest(`${SECRET}-rotated`, '2026-11-02', ID));
  assert.ok(!digest.includes(ID));
  assert.throws(() => identityDigest('short', '2026-11-02', ID));
});

test('decoded claims require an anonymous provider and a safe UID after token verification', () => {
  assert.equal(anonymousGuestUid({uid:'guest',firebase:{sign_in_provider:'anonymous'}}),'guest');
  for (const identity of [null,{}, {uid:'guest'}, {uid:'guest',firebase:{sign_in_provider:'password'}},
    {uid:'guest',firebase:{sign_in_provider:'custom'}}, {uid:'nested/path',firebase:{sign_in_provider:'anonymous'}},
    {uid:'',firebase:{sign_in_provider:'anonymous'}}]) assert.throws(() => anonymousGuestUid(identity));
});

test('capabilities expose only the staged flag; disabled installation does not access Firebase', async () => {
  let accessed = false;
  const handler = createReportsHandler({settings:() => ({enabled:false}), service:() => {accessed = true; throw new Error('must not access');}});
  const res = response();
  await handler({method:'GET',headers:{}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.value,{guestIdentityEnabled:false});
  assert.equal(accessed,false);
  assert.equal(res.headers['Cache-Control'],'no-store');
  const post = response(); await handler(request(),post);
  assert.equal(post.statusCode,503);
  assert.equal(post.value.error,'REPORTS_NOT_CONFIGURED');
});

test('enabled capabilities require a confirmed private policy and hide backend failures', async () => {
  for (const available of [false, 'failure']) {
    const {handler} = setup({service:() => ({enabled:async () => {if (available === 'failure') throw new Error(ID); return available;}})});
    const res=response(); await handler({method:'GET'},res);
    assert.equal(res.statusCode,503);
    assert.ok(!JSON.stringify(res.value).includes(ID));
  }
  const {handler} = setup(); const res=response(); await handler({method:'GET'},res);
  assert.deepEqual(res.value,{guestIdentityEnabled:true});
});

test('guest POST verifies bearer identity, normalizes transient ID and rounds persisted location', async () => {
  const {handler,calls} = setup(); const res=response(); await handler(request(),res);
  assert.equal(res.statusCode,201);
  assert.deepEqual(res.value,{id:'created-report',status:'pending'});
  const submission = calls.find(value => value[0] === 'submit')[1];
  assert.equal(submission.cedula, ID);
  assert.equal(submission.uid,'anonymous-user');
  assert.deepEqual(submission.report,{...REPORT,lat:18.476,lng:-69.943});
  assert.ok(!JSON.stringify(res.value).includes(ID));
});

test('missing, malformed or revoked authentication cannot submit or echo tokens and cédulas', async () => {
  for (const authorization of [undefined, [], 'Basic test','Bearer token with spaces']) {
    const {handler,calls}=setup(); const res=response();
    await handler({...request(),headers:{'content-type':'application/json',authorization}},res);
    assert.equal(res.statusCode,401);
    assert.ok(!calls.some(value => value[0] === 'submit'));
    assert.ok(!calls.some(value => value[0] === 'policy'));
  }
  const {handler,calls}=setup({authenticate:async () => {throw new Error(`revoked ${ID} private-token`);}});
  const res=response(); await handler(request(),res);
  assert.equal(res.statusCode,401);
  assert.ok(!calls.some(value => value[0] === 'submit'));
  assert.ok(!calls.some(value => value[0] === 'policy'));
  assert.ok(!JSON.stringify(res.value).includes(ID));
});

test('body validation rejects extra private fields, invalid dates and types, raw ID in public text', async () => {
  const invalid = [
    {report:REPORT,cedula:ID,identityHash:'injected'},
    {report:{...REPORT,status:'approved'},cedula:ID},
    {report:{...REPORT,category:'invented'},cedula:ID},
    {report:{...REPORT,lat:91},cedula:ID},
    {report:{...REPORT,occurredAt:'2026-02-30T12:00:00.000Z'},cedula:ID},
    {report:{...REPORT,occurredAt:'2099-01-01T12:00:00.000Z'},cedula:ID},
    {report:{...REPORT,description:`Mi cédula es ${ID}`},cedula:ID},
    {report:REPORT,cedula:1},
    {report:REPORT,cedula:'short'},
  ];
  for (const body of invalid) {
    const {handler,calls}=setup(); const res=response(); await handler(request(body),res);
    assert.equal(res.statusCode,400);
    assert.ok(!calls.some(value => value[0] === 'submit'));
  }
});

test('HTTP methods, content types and raw/parsed/declared oversized bodies are bounded', async () => {
  const {handler,calls}=setup();
  const badMethod=response(); await handler({...request(),method:'DELETE'},badMethod);
  assert.equal(badMethod.statusCode,405);
  const badType=response(); await handler({...request(),headers:{authorization:'Bearer valid','content-type':'text/plain'}},badType);
  assert.equal(badType.statusCode,400);
  for (const req of [request(' '.repeat(8193)), request({report:REPORT,cedula:ID,padding:'x'.repeat(8193)}),
    {...request(),headers:{...request().headers,'content-length':'8193'}}]) {
    const res=response(); await handler(req,res);
    assert.equal(res.statusCode,413);
  }
  assert.ok(!calls.some(value => value[0] === 'submit'));
});

test('rate limits and transaction errors use stable non-sensitive response codes', async () => {
  for (const [code,status] of [['REPORTS_RATE_LIMIT',429],['REPORTS_NOT_CONFIGURED',503],['native-private-error',503]]) {
    const {handler}=setup({service:() => ({enabled:async () => true,submit:async () => {throw Object.assign(new Error(`${ID} private-service-key`),{code});}})});
    const res=response(); await handler(request(),res);
    assert.equal(res.statusCode,status);
    assert.ok(!JSON.stringify(res.value).includes(ID));
    assert.ok(!JSON.stringify(res.value).includes('private-service-key'));
  }
});

test('actual Node HTTP adapter reads bounded JSON without Vercel-specific helpers', async () => {
  const {handler}=setup();
  const server=createServer(handler);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/reports`;
    const accepted=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-guest-token'},body:JSON.stringify(request().body)});
    assert.equal(accepted.status,201);
    const oversized=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(9000)});
    assert.equal(oversized.status,413);
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});

test('one atomic submission persists only existing public fields and private daily counters', async () => {
  const db=new MemoryFirestore();
  const service=createGuestReportService(db,{secret:SECRET,now:() => CURRENT});
  assert.equal(await service.enabled(),true);
  const result=await service.submit({uid:'guest-1',cedula:ID,report:{...REPORT,cedula:ID,identityHash:'must-not-persist'}});
  assert.equal(result.status,'pending');
  assert.equal(db.commits.length,1);
  const writes=db.commits[0]; assert.equal(writes.length,3);
  const publicReport=db.documents.get(`reports/${result.id}`);
  assert.deepEqual(Object.keys(publicReport).sort(),['category','createdAt','description','lat','lng','occurredAt','source','status']);
  assert.equal(publicReport.createdAt.toMillis(),CURRENT);
  assert.equal(publicReport.lat,18.476);
  assert.equal(publicReport.lng,-69.943);
  const quotaPath=[...db.documents.keys()].find(path => path.startsWith('guestIdentityLimits/'));
  assert.match(quotaPath,/guestIdentityLimits\/[a-f0-9]{64}$/);
  const quota=db.documents.get(quotaPath);
  assert.deepEqual(Object.keys(quota).sort(),['at','count','day','expiresAt']);
  assert.equal(quota.count,1);
  assert.equal(quota.expiresAt.toMillis(),Date.parse('2026-11-04T00:00:00Z'));
  for (const [,value] of writes) {
    const serialized=JSON.stringify(value);
    assert.ok(!serialized.includes(ID));
    assert.ok(!serialized.includes(SECRET));
    assert.ok(!Object.keys(value).some(key => /cedula|identity|hash|token/i.test(key)));
  }
});

test('same device and same ID across devices share cooldown and daily quota atomically', async () => {
  const db=new MemoryFirestore(); let current=CURRENT;
  const service=createGuestReportService(db,{secret:SECRET,now:() => current});
  await service.submit({uid:'guest-1',cedula:ID,report:REPORT});
  await assert.rejects(service.submit({uid:'guest-2',cedula:ID,report:REPORT}),failed('REPORTS_RATE_LIMIT'));
  await assert.rejects(service.submit({uid:'guest-1',cedula:'00212345678',report:REPORT}),failed('REPORTS_RATE_LIMIT'));
  current+=60_000;
  await service.submit({uid:'guest-2',cedula:ID,report:REPORT});
  for (let index=2;index<10;index++) {
    current+=60_000;
    await service.submit({uid:`guest-${index+1}`,cedula:ID,report:REPORT});
  }
  current+=60_000;
  await assert.rejects(service.submit({uid:'guest-11',cedula:ID,report:REPORT}),failed('REPORTS_RATE_LIMIT'));
  assert.equal(db.commits.length,10);
});

test('concurrent devices cannot overspend an ID quota and failed commits do not create reports', async () => {
  const db=new MemoryFirestore();
  const service=createGuestReportService(db,{secret:SECRET,now:() => CURRENT,cooldownMs:0,dailyLimit:3});
  const outcomes=await Promise.allSettled(Array.from({length:15},(_,index) => service.submit({uid:`device-${index}`,cedula:ID,report:REPORT})));
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length,3);
  assert.equal([...db.documents.keys()].filter(key => key.startsWith('reports/')).length,3);
  const failedDb=new MemoryFirestore(); failedDb.failCommit=true;
  await assert.rejects(createGuestReportService(failedDb,{secret:SECRET,now:() => CURRENT}).submit({uid:'guest-1',cedula:ID,report:REPORT}),failed('REPORTS_UNAVAILABLE'));
  assert.equal([...failedDb.documents.keys()].filter(key => key.startsWith('reports/')).length,0);
});

test('UTC midnight rotates identity fingerprints and transaction retries recompute the day', async () => {
  const db=new MemoryFirestore(); let current=Date.parse('2026-11-02T23:58:00.000Z');
  const service=createGuestReportService(db,{secret:SECRET,now:() => current});
  await service.submit({uid:'guest-before',cedula:ID,report:REPORT});
  const firstQuota=[...db.documents.keys()].find(key => key.startsWith('guestIdentityLimits/'));
  current=Date.parse('2026-11-02T23:59:59.999Z');
  db.retryNext=true;
  db.beforeRetry=() => {current=Date.parse('2026-11-03T00:00:00.000Z');};
  await service.submit({uid:'guest-after',cedula:ID,report:REPORT});
  const quotas=[...db.documents.keys()].filter(key => key.startsWith('guestIdentityLimits/'));
  assert.equal(quotas.length,2);
  const newQuota=quotas.find(key => key !== firstQuota);
  assert.equal(db.documents.get(newQuota).day,'2026-11-03');
  assert.equal(db.documents.get(newQuota).count,1);
});

test('policy changes, corrupt quota counters and hostile UIDs fail closed', async () => {
  const db=new MemoryFirestore(); const service=createGuestReportService(db,{secret:SECRET,now:() => CURRENT});
  db.documents.set('systemPolicies/reporting',{requireGuestIdentity:false});
  assert.equal(await service.enabled(),false);
  await assert.rejects(service.submit({uid:'guest',cedula:ID,report:REPORT}),failed('REPORTS_NOT_CONFIGURED'));
  db.documents.set('systemPolicies/reporting',{requireGuestIdentity:true});
  for (const uid of ['', '../bad', 'two/segments', 'x'.repeat(129)]) await assert.rejects(service.submit({uid,cedula:ID,report:REPORT}),failed('REPORTS_UNAVAILABLE'));
  const digest=identityDigest(SECRET,'2026-11-02',ID);
  db.documents.set(`guestIdentityLimits/${digest}`,{day:'2026-11-02',count:-1,at:Timestamp.fromMillis(CURRENT),expiresAt:Timestamp.fromMillis(CURRENT+86400_000)});
  await assert.rejects(service.submit({uid:'guest',cedula:ID,report:REPORT}),failed('REPORTS_UNAVAILABLE'));
  assert.equal(db.commits.length,0);
});
