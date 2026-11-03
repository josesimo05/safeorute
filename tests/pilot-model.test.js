import test from 'node:test';
import assert from 'node:assert/strict';
import {createPilotState, applyPilotAction, DEMO_PROFILES, visibleCases, visibleNotices, publicDemoNotices, isNoticeExpired} from '../apps/authorities/pilot-model.js';

const NOW=Date.parse('2026-11-02T15:00:00.000Z');
const profile=id=>DEMO_PROFILES.find(value=>value.id===id);
const perform=(state,action,id='op-pn',now=NOW)=>applyPilotAction(state,action,profile(id),now);
const code=expected=>error=>error.code===expected;

test('synthetic seed resets independently and offline camera never invents zero traffic',()=>{
  const first=createPilotState(NOW),second=createPilotState(NOW);
  assert.deepEqual(first,second);
  assert.notEqual(first.cases,second.cases);
  first.cases[0].notes.push({text:'temporary'});
  assert.equal(second.cases[0].notes.length,0);
  const offline=second.cameras.find(value=>value.health==='offline');
  assert.equal(offline.speedKmh,null);assert.equal(offline.congestion,null);
  assert.ok(Date.parse(offline.lastSeenAt)<NOW-15*1000);
});

test('demo views are scoped by institution; unknown or forged personas are rejected',()=>{
  const state=createPilotState(NOW);
  assert.ok(visibleCases(state,profile('op-pn')).every(value=>value.institutions.includes('PN')));
  assert.ok(visibleNotices(state,profile('op-digesett')).every(value=>value.institution==='DIGESETT'));
  assert.equal(visibleCases(state,profile('admin-demo')).length,state.cases.length);
  assert.throws(()=>visibleCases(state,{...profile('op-pn'),role:'admin'}),code('PROFILE'));
});

test('case updates and notes preserve prior state, require scope, and detect stale versions',()=>{
  const state=createPilotState(NOW),current=state.cases.find(value=>value.id==='SR-1024');
  const updated=perform(state,{type:'CASE_UPDATE',caseId:current.id,patch:{state:'verified',priority:'media'},expectedVersion:current.version});
  assert.equal(updated.cases[0].state,'verified');assert.equal(state.cases[0].state,'reviewing');
  assert.equal(updated.cases[0].version,2);assert.equal(updated.audit.length,state.audit.length+1);
  assert.throws(()=>perform(updated,{type:'CASE_UPDATE',caseId:current.id,patch:{state:'assigned'},expectedVersion:1}),code('CONFLICT'));
  assert.throws(()=>perform(state,{type:'CASE_NOTE',caseId:'SR-1025',text:'Nota ficticia'}),code('FORBIDDEN'));
  assert.throws(()=>perform(state,{type:'CASE_NOTE',caseId:current.id,text:'Nota ficticia'},'reader-pn'),code('FORBIDDEN'));
  const noted=perform(updated,{type:'CASE_NOTE',caseId:current.id,text:'  Inspección solo de demostración.  ',expectedVersion:2});
  assert.equal(noted.cases[0].notes[0].text,'Inspección solo de demostración.');assert.equal(updated.cases[0].notes.length,0);
});

test('operator cannot self-approve and admin role does not grant publication permissions',()=>{
  const state=createPilotState(NOW);
  const submitted=perform(state,{type:'NOTICE_SUBMIT',noticeId:'AV-DEMO-001',expectedVersion:1});
  assert.throws(()=>perform(submitted,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-001',expectedVersion:2}),code('APPROVAL'));
  assert.throws(()=>perform(submitted,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-001',expectedVersion:2},'admin-demo'),code('FORBIDDEN'));
  assert.throws(()=>perform(submitted,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-001',expectedVersion:2},'sup-digesett'),code('FORBIDDEN'));
  let own=perform(state,{type:'NOTICE_CREATE',title:'Borrador de un supervisor',text:'Este ejemplo también necesita revisión por otra persona.',zone:'Santo Domingo',institution:'PN',validUntil:new Date(NOW+3600000).toISOString()},'sup-pn');
  const ownId=own.notices[0].id;
  own=perform(own,{type:'NOTICE_SUBMIT',noticeId:ownId,expectedVersion:1},'sup-pn');
  assert.throws(()=>perform(own,{type:'NOTICE_APPROVE',noticeId:ownId,expectedVersion:2},'sup-pn'),code('APPROVAL'));
});

test('a different supervisor approves the exact current version, then simulated publication can be retracted',()=>{
  let state=createPilotState(NOW);
  state=perform(state,{type:'NOTICE_SUBMIT',noticeId:'AV-DEMO-001',expectedVersion:1});
  state=perform(state,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-001',expectedVersion:2},'sup-pn');
  const approved=state.notices.find(value=>value.id==='AV-DEMO-001');
  assert.equal(approved.approvedBy,'sup-pn');assert.equal(approved.approvedVersion,approved.version);
  assert.throws(()=>perform(state,{type:'NOTICE_PUBLISH',noticeId:approved.id,expectedVersion:2},'sup-pn'),code('CONFLICT'));
  state=perform(state,{type:'NOTICE_PUBLISH',noticeId:approved.id,expectedVersion:3},'sup-pn');
  assert.ok(publicDemoNotices(state,NOW).some(value=>value.id===approved.id));
  assert.throws(()=>perform(state,{type:'NOTICE_EDIT',noticeId:approved.id,patch:{text:'Cambio después de publicar.'},expectedVersion:4}),code('FORBIDDEN'));
  assert.throws(()=>perform(state,{type:'NOTICE_RETRACT',noticeId:approved.id,reason:'',expectedVersion:4},'sup-pn'),code('INVALID'));
  state=perform(state,{type:'NOTICE_RETRACT',noticeId:approved.id,reason:'Retiro de demostración por corrección.',expectedVersion:4},'sup-pn');
  assert.ok(!publicDemoNotices(state,NOW).some(value=>value.id===approved.id));
  assert.equal(state.audit[0].action,'Aviso de prueba retirado');
});

test('editing an approved draft invalidates approval, requires review again, and cannot mutate hidden fields',()=>{
  let state=createPilotState(NOW);
  state=perform(state,{type:'NOTICE_SUBMIT',noticeId:'AV-DEMO-001',expectedVersion:1});
  state=perform(state,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-001',expectedVersion:2},'sup-pn');
  state=perform(state,{type:'NOTICE_EDIT',noticeId:'AV-DEMO-001',patch:{text:'Un mensaje ficticio corregido para ciudadanos.'},expectedVersion:3});
  const notice=state.notices.find(value=>value.id==='AV-DEMO-001');
  assert.equal(notice.status,'draft');assert.equal(notice.approvedBy,null);assert.equal(notice.approvedVersion,null);
  assert.throws(()=>perform(state,{type:'NOTICE_PUBLISH',noticeId:notice.id,expectedVersion:4},'sup-pn'),code('APPROVAL'));
  assert.throws(()=>perform(state,{type:'NOTICE_EDIT',noticeId:notice.id,patch:{approvedBy:'op-pn'},expectedVersion:4}),code('INVALID'));
});

test('expired notices cannot be submitted, approved, published or shown in citizen preview',()=>{
  const state=createPilotState(NOW),future=NOW+8*3600000;
  assert.ok(state.notices.every(value=>isNoticeExpired(value,future)));
  assert.equal(publicDemoNotices(state,future).length,0);
  assert.throws(()=>perform(state,{type:'NOTICE_SUBMIT',noticeId:'AV-DEMO-001',expectedVersion:1},'op-pn',future),code('EXPIRY'));
  assert.throws(()=>perform(state,{type:'NOTICE_APPROVE',noticeId:'AV-DEMO-002',expectedVersion:2},'sup-digesett',future),code('EXPIRY'));
});

test('new notice creation whitelists fields and remains a draft with an audit entry',()=>{
  const state=createPilotState(NOW);
  const next=perform(state,{type:'NOTICE_CREATE',title:'Cierre ficticio de ejemplo',text:'Mensaje de prueba suficientemente descriptivo.',zone:'Santo Domingo',institution:'PN',validUntil:new Date(NOW+3600000).toISOString(),approvedBy:'op-pn'});
  const created=next.notices[0];
  assert.equal(created.status,'draft');assert.equal(created.authorId,'op-pn');assert.equal(created.approvedBy,null);
  assert.equal(next.notices.length,state.notices.length+1);assert.equal(state.notices.length,3);
  assert.match(next.audit[0].detail,/No se publicó/);
  assert.throws(()=>perform(state,{type:'NOTICE_CREATE',title:'Otro ejemplo',text:'Texto del aviso para esta simulación.',zone:'Santo Domingo',institution:'DIGESETT',validUntil:new Date(NOW+3600000).toISOString()}),code('FORBIDDEN'));
});
