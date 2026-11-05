// Real Firestore rules/emulator integration. This suite never contacts production.
// See docs/VERIFICAR_REPORTES_COMPARTIDOS.md for the verified emulator setup.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import nodeTest from 'node:test';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,writeBatch,serverTimestamp,Timestamp,updateDoc,runTransaction,onSnapshot,setLogLevel} from 'firebase/firestore';
import {createReportReviewer} from '../../src/report-review.js';
import {approvedRouteReports} from '../../src/logic.js';
setLogLevel('silent');
const results=[];
const projectId='demo-saferoute-sharing';
const emulator=process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/);
if (!emulator || Number(emulator[2]) > 65535 || !projectId.startsWith('demo-')) {
  throw new Error('Set FIRESTORE_EMULATOR_HOST to an explicit loopback emulator; production fallback is forbidden.');
}
const host=emulator[1]==='[::1]'?'::1':emulator[1], port=Number(emulator[2]);
const env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')}});
const user=(uid,verified=true,provider='google.com')=>env.authenticatedContext(uid,{email:`${uid}@example.invalid`,email_verified:verified,firebase:{sign_in_provider:provider}}).firestore();
const writer=user('writer-a',false,'anonymous');
const reader=env.unauthenticatedContext().firestore();
const stranger=user('stranger');
const mod=user('reviewer');
const mod2=user('reviewer-two');
const unverified=user('not-verified',false);
const anonymousMod=user('anon-with-record',true,'anonymous');
const inactive=user('inactive-reviewer');
const report=(extra={})=>({category:'Otro',description:'Semáforo de prueba sin funcionar.',lat:18.476,lng:-69.943,occurredAt:'2026-01-01T12:00:00.000Z',status:'pending',source:'community',createdAt:Timestamp.fromMillis(Date.now()),...extra});
async function seed(path,value){return env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),value));}
async function test(name,run){await nodeTest(name,{concurrency:false},async()=>{await run();results.push({name,passed:true});});}
const review=(db,uid)=>createReportReviewer({currentUser:()=>({uid,emailVerified:true,isAnonymous:false}),reference:(c,id)=>doc(db,c,id),transaction:fn=>runTransaction(db,fn),timestamp:()=>serverTimestamp()});
try {
 await env.clearFirestore();
 for(const uid of ['reviewer','reviewer-two','not-verified','anon-with-record'])await seed(`reportModerators/${uid}`,{active:true});
 await seed('reportModerators/inactive-reviewer',{active:false});
 await seed('reports/pending-private',report());
 await seed('reports/approved-public',report({status:'approved'}));
 await test('public clients see approved reports but cannot read pending data',async()=>{
  assert.equal((await assertSucceeds(getDoc(doc(reader,'reports/approved-public')))).data().status,'approved');
  await assertFails(getDoc(doc(reader,'reports/pending-private')));
  const snapshot=await assertSucceeds(getDocs(query(collection(reader,'reports'),where('status','==','approved'))));
  assert.equal(snapshot.docs.length,1);
 });
 await test('only verified active moderators can read review queue',async()=>{
  assert.equal((await assertSucceeds(getDocs(query(collection(mod,'reports'),where('status','==','pending'))))).docs.length,1);
  for(const db of [stranger,unverified,anonymousMod,inactive])await assertFails(getDoc(doc(db,'reports/pending-private')));
 });
 await test('clients cannot grant themselves moderator roles or list memberships',async()=>{
  await assertFails(setDoc(doc(stranger,'reportModerators/stranger'),{active:true}));
  await assertFails(setDoc(doc(mod,'reportModerators/stranger'),{active:true}));
  await assertFails(getDocs(collection(mod,'reportModerators')));
  assert.equal((await assertSucceeds(getDoc(doc(stranger,'reportModerators/stranger')))).exists(),false);
  await assertFails(getDoc(doc(stranger,'reportModerators/reviewer')));
 });
 await test('moderator cannot publish without atomic audit or alter incident contents',async()=>{
  await assertFails(updateDoc(doc(mod,'reports/pending-private'),{status:'approved'}));
  const batch=writeBatch(mod);
  batch.update(doc(mod,'reports/pending-private'),{status:'approved',description:'Changed report description.'});
  batch.set(doc(mod,'reportReviews/pending-private'),{reportId:'pending-private',moderatorUid:'reviewer',status:'approved',reviewedAt:serverTimestamp()});
  await assertFails(batch.commit());
  const locationBatch=writeBatch(mod);
  locationBatch.update(doc(mod,'reports/pending-private'),{status:'approved',lat:0});
  locationBatch.set(doc(mod,'reportReviews/pending-private'),{reportId:'pending-private',moderatorUid:'reviewer',status:'approved',reviewedAt:serverTimestamp()});
  await assertFails(locationBatch.commit());
 });
 await test('unsafe legacy pending report stays private and can be rejected without copying private fields',async()=>{
  const legacy=report({description:'Contacto privado de prueba: 809-555-0101.',privateEmail:'private-fixture@example.invalid'});
  await seed('reports/unsafe-legacy',legacy);
  await assert.rejects(review(mod,'reviewer')('unsafe-legacy','approved'),{code:'moderation/invalid-report'});
  const approval=writeBatch(mod);
  approval.update(doc(mod,'reports/unsafe-legacy'),{status:'approved'});
  approval.set(doc(mod,'reportReviews/unsafe-legacy'),{reportId:'unsafe-legacy',moderatorUid:'reviewer',status:'approved',reviewedAt:serverTimestamp()});
  await assertFails(approval.commit());
  await assertSucceeds(review(mod,'reviewer')('unsafe-legacy','rejected'));
  const rejected=(await getDoc(doc(mod,'reports/unsafe-legacy'))).data();
  assert.deepEqual(rejected,{...legacy,status:'rejected'});
  const audit=(await getDoc(doc(mod,'reportReviews/unsafe-legacy'))).data();
  assert.deepEqual(Object.keys(audit).sort(),['reportId','moderatorUid','status','reviewedAt'].sort());
  assert.equal(audit.status,'rejected');
  await assertFails(getDoc(doc(reader,'reports/unsafe-legacy')));
  await assertFails(getDoc(doc(reader,'reportReviews/unsafe-legacy')));
  const publicReports=await assertSucceeds(getDocs(query(collection(reader,'reports'),where('status','==','approved'))));
  assert.ok(!publicReports.docs.some(row=>row.id==='unsafe-legacy'));
 });
 await test('verified ordinary or unverified accounts cannot approve even with an audit',async()=>{
  for(const db of [stranger,unverified,anonymousMod,inactive]){
   const batch=writeBatch(db);
   batch.update(doc(db,'reports/pending-private'),{status:'approved'});
   batch.set(doc(db,'reportReviews/pending-private'),{reportId:'pending-private',moderatorUid:'stranger',status:'approved',reviewedAt:serverTimestamp()});
   await assertFails(batch.commit());
  }
 });
 await test('legacy anonymous submission batch is accepted and remains invisible before review',async()=>{
  const batch=writeBatch(writer);
  batch.set(doc(writer,'reports/from-writer-a'),report({createdAt:serverTimestamp()}));
  batch.set(doc(writer,'submissionLimits/writer-a'),{at:serverTimestamp(),lastReport:'from-writer-a'});
  await assertSucceeds(batch.commit());
  await assertFails(getDoc(doc(reader,'reports/from-writer-a')));
  await assertFails(getDoc(doc(writer,'reports/from-writer-a')));
  const immediate=writeBatch(writer);
  immediate.set(doc(writer,'reports/rate-too-soon'),report({createdAt:serverTimestamp()}));
  immediate.set(doc(writer,'submissionLimits/writer-a'),{at:serverTimestamp(),lastReport:'rate-too-soon'});
  await assertFails(immediate.commit());
 });
 await test('two independent SDK clients receive approved incident by real realtime listener without reload',async()=>{
  const events=[];let stop;
  const selectedRoute=Object.freeze({id:'reader-selected-route',points:Object.freeze([{latitude:18.474,longitude:-69.943},{latitude:18.478,longitude:-69.943}])});
  const originalRoute=JSON.stringify(selectedRoute);
  let initialResolve;const initial=new Promise(resolve=>initialResolve=resolve);
  let publishedResolve,publishedReject;const published=new Promise((resolve,reject)=>{publishedResolve=resolve;publishedReject=reject;});
  const timer=setTimeout(()=>publishedReject(new Error('realtime publication timed out')),10000);
  try{
   stop=onSnapshot(query(collection(reader,'reports'),where('status','==','approved')),snapshot=>{
    const rows=snapshot.docs.map(d=>({id:d.id,...d.data()}));events.push(rows);
    initialResolve();
    if(rows.some(row=>row.id==='from-writer-a'))publishedResolve(rows);
   },publishedReject);
   await initial;
   assert.ok(!events.at(-1).some(row=>row.id==='from-writer-a'));
   const beforeCount=approvedRouteReports(selectedRoute,events.at(-1)).length;
   const result=await review(mod,'reviewer')('from-writer-a','approved');
   assert.equal(result.status,'approved');
   const rows=await published;
   assert.ok(events.length>=2);
   const routeReports=approvedRouteReports(selectedRoute,rows);
   assert.equal(routeReports.length,beforeCount+1);
   assert.ok(routeReports.some(row=>row.id==='from-writer-a'));
   assert.equal(JSON.stringify(selectedRoute),originalRoute);
   const received=rows.find(row=>row.id==='from-writer-a');
   assert.equal(received.description,'Semáforo de prueba sin funcionar.');
   assert.deepEqual(Object.keys(received).filter(key=>key!=='id').sort(),['category','description','lat','lng','occurredAt','status','source','createdAt'].sort());
  }finally{clearTimeout(timer);stop?.();}
 });
 await test('audit is private and append only after a successful real review transaction',async()=>{
  await assertFails(getDoc(doc(reader,'reportReviews/from-writer-a')));
  const audit=(await assertSucceeds(getDoc(doc(mod,'reportReviews/from-writer-a')))).data();
  assert.equal(audit.moderatorUid,'reviewer');assert.equal(audit.status,'approved');
  await assertFails(updateDoc(doc(mod,'reportReviews/from-writer-a'),{status:'rejected'}));
  await assertFails(updateDoc(doc(mod,'reports/from-writer-a'),{status:'rejected'}));
 });
 await test('two concurrent reviewers produce a single winner and matching audit',async()=>{
  await seed('reports/review-race',report());
  const attempts=await Promise.allSettled([review(mod,'reviewer')('review-race','approved'),review(mod2,'reviewer-two')('review-race','rejected')]);
  assert.equal(attempts.filter(value=>value.status==='fulfilled').length,1);
  const final=(await getDoc(doc(mod,'reports/review-race'))).data();
  const audit=(await getDoc(doc(mod,'reportReviews/review-race'))).data();
  assert.equal(audit.status,final.status);
 });
 await test('revocation blocks later transactions with an otherwise valid moderator token',async()=>{
  await seed('reports/after-revoke',report());
  await seed('reportModerators/reviewer',{active:false});
  await assertFails(updateDoc(doc(mod,'reports/after-revoke'),{status:'approved'}));
  await assert.rejects(review(mod,'reviewer')('after-revoke','approved'));
  await seed('reportModerators/reviewer',{active:true});
 });
 await test('mandatory private identity policy denies the old anonymous direct-write route',async()=>{
  await seed('systemPolicies/reporting',{requireGuestIdentity:true});
  const newWriter=user('another-guest',false,'anonymous');
  const batch=writeBatch(newWriter);
  batch.set(doc(newWriter,'reports/missing-identity'),report({createdAt:serverTimestamp()}));
  batch.set(doc(newWriter,'submissionLimits/another-guest'),{at:serverTimestamp(),lastReport:'missing-identity'});
  await assertFails(batch.commit());
  await assertFails(getDoc(doc(reader,'systemPolicies/reporting')));
  await assertFails(getDoc(doc(reader,'guestIdentityLimits/no-public-access')));
 });
 await test('public client cannot create an already-approved report',async()=>{
  const batch=writeBatch(stranger);
  batch.set(doc(stranger,'reports/approve-on-create'),report({status:'approved',createdAt:serverTimestamp()}));
  batch.set(doc(stranger,'submissionLimits/stranger'),{at:serverTimestamp(),lastReport:'approve-on-create'});
  await assertFails(batch.commit());
 });
 assert.equal(results.length,13,'Every real-emulator scenario must pass.');
 console.log(`${results.length} REAL EMULATOR TESTS PASSED`);
}finally{await env.cleanup();}
