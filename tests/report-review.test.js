import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleModerator, moderatorIsActive, prepareReportReview, createReportReviewer, prepareReportWithdrawal, createReportWithdrawer} from '../src/report-review.js';

const account = uid => ({uid,isAnonymous:false,emailVerified:true});
const report = () => ({category:'Otro',description:'Semáforo apagado junto a la intersección.',lat:18.476,lng:-69.943,
  occurredAt:'2026-01-01T10:00:00.000Z',status:'pending',source:'community',createdAt:{seconds:1767261600}});
const failure = code => error => error.code === code;

// An atomic serializable double of the real Web SDK get/update/set transaction
// contract. It does not emulate Firestore rules, credentials or network access.
class MemoryReviews {
  documents = new Map([['reports/report-1',report()],['reportModerators/mod-1',{active:true}],['reportModerators/mod-2',{active:true}]]);
  writes = [];
  tail = Promise.resolve();
  failCommit = false;
  retry = null;
  onRead = null;
  reference = (collection,id) => ({path:`${collection}/${id}`});
  transaction = callback => {
    const operation = this.tail.then(async () => {
      const run = async () => {
        const staged=[];
        await callback({
          get:async ref => {
            assert.equal(staged.length,0,'transaction reads must precede writes');
            this.onRead?.(ref);
            const value=this.documents.get(ref.path);
            return {exists:()=>value!==undefined,data:()=>value===undefined?undefined:structuredClone(value)};
          },
          update:(ref,patch)=>staged.push({type:'update',path:ref.path,data:structuredClone(patch)}),
          set:(ref,data)=>staged.push({type:'set',path:ref.path,data:structuredClone(data)}),
        });
        return staged;
      };
      if(this.retry){await run();const retry=this.retry;this.retry=null;retry();}
      const staged=await run();
      if(this.failCommit)throw new Error('simulated native transaction failure');
      for(const write of staged)this.documents.set(write.path,write.type==='update'?{...this.documents.get(write.path),...write.data}:write.data);
      this.writes.push(staged);
    });
    this.tail=operation.catch(()=>{});
    return operation;
  };
  reviewer(currentUser=()=>account('mod-1')) {
    return createReportReviewer({currentUser,reference:this.reference,transaction:this.transaction,timestamp:()=>({serverTimestamp:true})});
  }
  withdrawer(currentUser=()=>account('mod-1')) {
    return createReportWithdrawer({currentUser,reference:this.reference,transaction:this.transaction,timestamp:()=>({serverTimestamp:true})});
  }
}

test('a moderator needs a verified non-anonymous account and an explicit active membership', () => {
  assert.equal(eligibleModerator(account('mod-1')),true);
  for(const user of [null,{...account('x'),isAnonymous:true},{...account('x'),emailVerified:false},{...account('x'),uid:'../x'}]) {
    assert.equal(eligibleModerator(user),false);
    assert.equal(moderatorIsActive(user,{active:true}),false);
  }
  assert.equal(moderatorIsActive(account('mod-1'),{active:true}),true);
  for(const membership of [null,{}, {active:false},{active:'true'}])assert.equal(moderatorIsActive(account('mod-1'),membership),false);
});

test('review changes only status and stores the reviewer outside the public document', async () => {
  const db=new MemoryReviews();
  const original=structuredClone(db.documents.get('reports/report-1'));
  assert.deepEqual(await db.reviewer()('report-1','approved'),{id:'report-1',status:'approved'});
  const stored=db.documents.get('reports/report-1');
  assert.deepEqual(stored,{...original,status:'approved'});
  assert.deepEqual(Object.keys(stored).sort(),Object.keys(original).sort());
  assert.deepEqual(db.documents.get('reportReviews/report-1'),{reportId:'report-1',moderatorUid:'mod-1',status:'approved',reviewedAt:{serverTimestamp:true}});
  assert.deepEqual(db.writes[0].map(write=>write.type),['update','set']);
});

test('unverified, anonymous, inactive, and missing-membership accounts cannot write a review', async () => {
  for(const user of [{...account('mod-1'),emailVerified:false},{...account('mod-1'),isAnonymous:true},account('unknown')]) {
    const db=new MemoryReviews();
    await assert.rejects(db.reviewer(()=>user)('report-1','approved'),failure('moderation/not-authorized'));
    assert.equal(db.writes.length,0);
  }
  const db=new MemoryReviews();db.documents.set('reportModerators/mod-1',{active:false});
  await assert.rejects(db.reviewer()('report-1','rejected'),failure('moderation/not-authorized'));
  assert.equal(db.documents.get('reports/report-1').status,'pending');
});

test('concurrent reviewers cannot overwrite a completed decision or its audit record', async () => {
  const db=new MemoryReviews();
  const results=await Promise.allSettled([db.reviewer()('report-1','approved'),db.reviewer(()=>account('mod-2'))('report-1','rejected')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'moderation/already-reviewed');
  assert.equal(db.writes.length,1);
  assert.equal(db.documents.get('reports/report-1').status,'approved');
  assert.equal(db.documents.get('reportReviews/report-1').moderatorUid,'mod-1');
});

test('membership revocation is checked again on transaction retry and discards tentative writes', async () => {
  const db=new MemoryReviews();
  db.retry=()=>db.documents.set('reportModerators/mod-1',{active:false});
  await assert.rejects(db.reviewer()('report-1','approved'),failure('moderation/not-authorized'));
  assert.equal(db.writes.length,0);
  assert.equal(db.documents.get('reports/report-1').status,'pending');
  assert.equal(db.documents.has('reportReviews/report-1'),false);
});

test('a session change while reading cannot attribute a decision to the previous user', async () => {
  const db=new MemoryReviews();let user=account('mod-1');
  db.onRead=ref=>{if(ref.path.startsWith('reportReviews/'))user=account('mod-2');};
  await assert.rejects(db.reviewer(()=>user)('report-1','approved'),failure('moderation/session-changed'));
  assert.equal(db.writes.length,0);
});

test('a commit failure never leaves a published status without its review audit', async () => {
  const db=new MemoryReviews();db.failCommit=true;
  await assert.rejects(db.reviewer()('report-1','approved'));
  assert.equal(db.documents.get('reports/report-1').status,'pending');
  assert.equal(db.documents.has('reportReviews/report-1'),false);
});

test('review rejects arbitrary fields, invalid decisions, and missing or already reviewed reports', async () => {
  const parameters={reportId:'report-1',report:report(),nextStatus:'approved',moderatorUid:'mod-1',reviewedAt:{serverTimestamp:true}};
  assert.throws(()=>prepareReportReview({...parameters,report:{...report(),email:'private@example.test'}}),failure('moderation/invalid-report'));
  assert.throws(()=>prepareReportReview({...parameters,nextStatus:'pending'}),failure('moderation/invalid-decision'));
  assert.throws(()=>prepareReportReview({...parameters,report:{...report(),status:'rejected'}}),failure('moderation/already-reviewed'));
  const db=new MemoryReviews();
  await assert.rejects(db.reviewer()('missing','approved'),failure('moderation/report-not-found'));
  assert.equal(db.writes.length,0);
});

test('unsafe pending text or legacy private fields can be rejected without publishing or copying them into audit', async () => {
  const poisoned={...report(),description:'Llama al 809-555-1234 para identificar a alguien.',privateEmail:'private@example.test'};
  const parameters={reportId:'report-1',report:poisoned,nextStatus:'approved',moderatorUid:'mod-1',reviewedAt:{serverTimestamp:true}};
  assert.throws(()=>prepareReportReview(parameters),failure('moderation/invalid-report'));
  assert.throws(()=>prepareReportReview({...parameters,report:{...report(),description:poisoned.description}}),failure('moderation/invalid-report'));
  const db=new MemoryReviews();db.documents.set('reports/report-1',poisoned);
  await db.reviewer()('report-1','rejected');
  assert.deepEqual(db.documents.get('reports/report-1'),{...poisoned,status:'rejected'});
  const audit=db.documents.get('reportReviews/report-1');
  assert.deepEqual(Object.keys(audit).sort(),['moderatorUid','reportId','reviewedAt','status']);
  assert.equal(JSON.stringify(audit).includes('809'),false);
  assert.equal(JSON.stringify(audit).includes('private@example.test'),false);
});

test('withdrawal changes only publication status and preserves the original approval audit', async () => {
  const db=new MemoryReviews();
  const approved={...report(),status:'approved'};
  const originalReview={reportId:'report-1',moderatorUid:'mod-2',status:'approved',reviewedAt:{seconds:1767261600}};
  db.documents.set('reports/report-1',approved);
  db.documents.set('reportReviews/report-1',originalReview);
  assert.deepEqual(await db.withdrawer()('report-1'),{id:'report-1',status:'withdrawn'});
  assert.deepEqual(db.documents.get('reports/report-1'),{...approved,status:'withdrawn'});
  assert.deepEqual(db.documents.get('reportReviews/report-1'),originalReview);
  assert.deepEqual(db.documents.get('reportWithdrawals/report-1'),{
    reportId:'report-1',moderatorUid:'mod-1',status:'withdrawn',withdrawnAt:{serverTimestamp:true},
  });
  assert.deepEqual(db.writes[0].map(write=>({type:write.type,path:write.path})),[
    {type:'update',path:'reports/report-1'}, {type:'set',path:'reportWithdrawals/report-1'},
  ]);
});

test('withdrawal can hide legacy Console-published records without copying their content to audit', async () => {
  const db=new MemoryReviews();
  const legacy={status:'approved',description:'Contenido antiguo con 809-555-1234.',privateEmail:'private@example.test'};
  db.documents.set('reports/report-1',legacy);
  await db.withdrawer()('report-1');
  assert.deepEqual(db.documents.get('reports/report-1'),{...legacy,status:'withdrawn'});
  assert.equal(db.documents.has('reportReviews/report-1'),false);
  const audit=db.documents.get('reportWithdrawals/report-1');
  assert.deepEqual(Object.keys(audit).sort(),['moderatorUid','reportId','status','withdrawnAt']);
  assert.equal(JSON.stringify(audit).includes('809'),false);
  assert.equal(JSON.stringify(audit).includes('private@example.test'),false);
});

test('withdrawal rejects unpublished, already withdrawn, missing, and invalid report identifiers', async () => {
  for(const status of ['pending','rejected','withdrawn']){
    const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status});
    await assert.rejects(db.withdrawer()('report-1'),failure(status==='withdrawn'?'moderation/already-withdrawn':'moderation/not-published'));
    assert.equal(db.writes.length,0);
  }
  const db=new MemoryReviews();
  await assert.rejects(db.withdrawer()('missing'),failure('moderation/report-not-found'));
  await assert.rejects(db.withdrawer()('../invalid'),failure('moderation/invalid-request'));
  const input={reportId:'report-1',report:{status:'approved'},moderatorUid:'mod-1',withdrawnAt:{serverTimestamp:true}};
  assert.throws(()=>prepareReportWithdrawal({...input,withdrawnAt:undefined}),failure('moderation/invalid-request'));
  assert.throws(()=>prepareReportWithdrawal({...input,moderatorUid:'../invalid'}),failure('moderation/invalid-request'));
  assert.throws(()=>createReportWithdrawer({}),failure('moderation/invalid-adapter'));
  assert.equal(db.writes.length,0);
});

test('withdrawal requires a verified non-anonymous active moderator', async () => {
  for(const user of [null,{...account('mod-1'),emailVerified:false},{...account('mod-1'),isAnonymous:true},account('unknown')]){
    const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
    await assert.rejects(db.withdrawer(()=>user)('report-1'),failure('moderation/not-authorized'));
    assert.equal(db.writes.length,0);
  }
  const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
  db.documents.set('reportModerators/mod-1',{active:false});
  await assert.rejects(db.withdrawer()('report-1'),failure('moderation/not-authorized'));
  assert.equal(db.writes.length,0);
});

test('concurrent withdrawals have one winner and cannot overwrite the first withdrawal audit', async () => {
  const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
  const results=await Promise.allSettled([db.withdrawer()('report-1'),db.withdrawer(()=>account('mod-2'))('report-1')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'moderation/already-withdrawn');
  assert.equal(db.writes.length,1);
  assert.equal(db.documents.get('reportWithdrawals/report-1').moderatorUid,'mod-1');
  await assert.rejects(db.reviewer()('report-1','approved'),failure('moderation/already-reviewed'));
  assert.equal(db.documents.get('reports/report-1').status,'withdrawn');
});

test('withdrawal checks role revocation again on transaction retry', async () => {
  const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
  db.retry=()=>db.documents.set('reportModerators/mod-1',{active:false});
  await assert.rejects(db.withdrawer()('report-1'),failure('moderation/not-authorized'));
  assert.equal(db.writes.length,0);
  assert.equal(db.documents.get('reports/report-1').status,'approved');
  assert.equal(db.documents.has('reportWithdrawals/report-1'),false);
});

test('withdrawal does not use a previous account after a session change', async () => {
  const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
  let user=account('mod-1');
  db.onRead=ref=>{if(ref.path.startsWith('reportWithdrawals/'))user=account('mod-2');};
  await assert.rejects(db.withdrawer(()=>user)('report-1'),failure('moderation/session-changed'));
  assert.equal(db.writes.length,0);
  assert.equal(db.documents.get('reports/report-1').status,'approved');
});

test('a failed withdrawal commit leaves the publication and its audit unchanged', async () => {
  const db=new MemoryReviews();db.documents.set('reports/report-1',{...report(),status:'approved'});
  db.failCommit=true;
  await assert.rejects(db.withdrawer()('report-1'));
  assert.equal(db.documents.get('reports/report-1').status,'approved');
  assert.equal(db.documents.has('reportWithdrawals/report-1'),false);
  assert.equal(db.writes.length,0);
});
