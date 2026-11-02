import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchItsSnapshot, itsCameraViews, itsCoordinates, normalizeItsSnapshot} from '../src/its-client.js';

const now = Date.parse('2026-11-02T15:00:00Z');
function state(updates = {}) {return {camera_id:'cam',source_mode:'demo',received_at:new Date(now).toISOString(),capture_at:null,
  health:{status:'healthy',usable_for_analytics:true,usable_for_speed:true},speed_valid:true,mean_speed_kmh:8,
  count_valid:true,total_count:0,congestion:'denso',lanes:[{id:'lane',count_valid:true,count:0}],...updates};}
function payload(updates = {}) {return {demo:true,server_time:new Date(now).toISOString(),
  cameras:[{camera_id:'cam',source:{kind:'synthetic',mode:'demo'},location:{latitude:0,longitude:0,country:'DO'},state:state({mean_speed_kmh:30})}],
  states:[state()],alerts:[],...updates};}
const normalize = input => normalizeItsSnapshot(input,{receivedAt:now});

test('ITS preferred states override embedded camera snapshot and retain zero counts and coordinates', () => {
  const view=itsCameraViews(normalize(payload()),now)[0];
  assert.equal(view.speedKmh,8);assert.equal(view.count,0);assert.equal(view.lanes[0].count,0);
  assert.deepEqual(itsCoordinates(view.location),{latitude:0,longitude:0});
  assert.equal(view.captureAtMs,null);assert.equal(view.demo,true);
});

test('ITS removes stale metrics after fifteen seconds without requiring another response', () => {
  const snap=normalize(payload());
  assert.equal(itsCameraViews(snap,now+15000)[0].speedKmh,8);
  const expired=itsCameraViews(snap,now+15001)[0];
  assert.equal(expired.stale,true);assert.equal(expired.speedKmh,null);assert.equal(expired.count,null);
  assert.equal(expired.lanes[0].count,null);assert.equal(expired.congestion,'desconocido');
});

test('ITS repeated cached snapshot cannot reset age using the new fetch completion time', () => {
  const initial=normalize(payload());
  const repeated=normalizeItsSnapshot(payload(),{receivedAt:now+20000,previousTiming:initial.timing});
  assert.equal(itsCameraViews(repeated,now+20000)[0].stale,true);
});

test('ITS compensates a stable clock difference and still expires observations', () => {
  const clientNow=now+3600000;
  const snap=normalizeItsSnapshot(payload(),{receivedAt:clientNow});
  assert.equal(itsCameraViews(snap,clientNow)[0].stale,false);
  assert.equal(itsCameraViews(snap,clientNow+16000)[0].stale,true);
});

test('ITS unavailable speed/count and bad camera health never become numeric zero or traffic stopped', () => {
  for (const update of [{count_valid:false,speed_valid:false}, {health:{status:'degraded',usable_for_analytics:false}},
    ...['offline','unavailable','replay_finished','unrecognized_health'].map(status=>({health:{status,usable_for_analytics:true,usable_for_speed:true}})),
    {received_at:null}, {stale:true}, {source_mode:'live'}]) {
    const view=itsCameraViews(normalize(payload({states:[state(update)]})),now)[0];
    assert.equal(view.speedKmh,null);assert.equal(view.count,null);assert.equal(view.congestion,'desconocido');
  }
});

test('ITS valid measured zero speed is different from unavailable speed', () => {
  const view=itsCameraViews(normalize(payload({states:[state({mean_speed_kmh:0,congestion:'detenido'})]})),now)[0];
  assert.equal(view.speedKmh,0);assert.equal(view.congestion,'detenido');
});

test('ITS refuses non-demo snapshots, filters unexpected source modes and country mismatch', () => {
  assert.throws(()=>normalize(payload({demo:false})),/ITS_INVALID_DEMO/);
  const live={camera_id:'private',source:{kind:'rtsp',mode:'live'},location:{latitude:18,longitude:-69}};
  const snap=normalize(payload({cameras:[...payload().cameras,live]}));
  assert.deepEqual(snap.cameras.map(camera=>camera.id),['cam']);
  assert.equal(itsCameraViews(snap,now,'es').length,0);
  assert.equal(itsCameraViews(snap,now,'do').length,1);
});

test('ITS validates coordinates instead of coercing null or text to zero', () => {
  for (const location of [{latitude:null,longitude:null},{latitude:'0',longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181}]) assert.equal(itsCoordinates(location),null);
});

test('ITS keeps observed facts separate and excludes suppressed/resolved/private alerts', () => {
  const alert={alert_id:'a',camera_id:'cam',source_mode:'demo',status:'open',kind:'congestion_observed',
    observed:[{description:'Velocidad reducida',mean_speed_kmh:8,duration_seconds:30}],
    probable_causes:[{description:'Causa no determinada.',confidence_level:'bajo'}],observation_stale:true};
  const snap=normalize(payload({alerts:[alert,{...alert,alert_id:'suppressed',suppressed:true},
    {...alert,alert_id:'closed',status:'resolved'},{...alert,alert_id:'private',source_mode:'live'}]}));
  assert.equal(snap.alerts.length,1);assert.equal(snap.alerts[0].causes[0].confidence,'bajo');
  assert.equal(snap.alerts[0].observed[0].durationSeconds,30);assert.equal(snap.alerts[0].observationStale,true);
});

test('ITS fetch uses same-origin no-store and never sends account cookies or tokens', async () => {
  let request;
  await fetchItsSnapshot({now:()=>now,fetchImpl:async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>payload()};
  }});
  assert.equal(request.url,'/api/its');assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.cache,'no-store');assert.deepEqual(request.options.headers,{Accept:'application/json'});
});

test('ITS current gateway HTTP Date prevents rejuvenating a cached upstream snapshot on first load', async () => {
  const later=now+30000;
  const snap=await fetchItsSnapshot({now:()=>later,fetchImpl:async()=>({ok:true,
    headers:{get:name=>name==='date'?new Date(later).toUTCString():null},json:async()=>payload()})});
  assert.equal(itsCameraViews(snap,later)[0].stale,true);
});

test('ITS cache Age header keeps an old HTTP response stale', async () => {
  const later=now+30000;
  const snap=await fetchItsSnapshot({now:()=>later,fetchImpl:async()=>({ok:true,
    headers:{get:name=>name==='date'?new Date(now).toUTCString():name==='age'?'30':null},json:async()=>payload()})});
  assert.equal(itsCameraViews(snap,later)[0].stale,true);
});
