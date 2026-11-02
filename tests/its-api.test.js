import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createItsHandler, DEFAULT_ITS_BACKEND_URL, itsViteProxy} from '../api/its.js';

const timestamp = '2026-11-02T12:00:00.000Z';
function snapshot() {
  return {
    demo: true, cursor: '41', server_time: timestamp, capabilities: {operator_review: false},
    cameras: [{
      camera_id: 'cam-demo-01', source: {kind: 'synthetic', mode: 'demo', synthetic_speed_kmh: 8},
      location: {latitude: 18.4861, longitude: -69.9312, city: 'Ubicación ilustrativa'},
    }],
    states: [{
      camera_id: 'cam-demo-01', source_mode: 'demo', received_at: timestamp,
      mean_speed_kmh: null, speed_valid: false, count_valid: true, total_count: 0,
      health: {status: 'healthy', usable_for_analytics: true, usable_for_speed: false},
      lanes: [{id: 'lane-1', count: 0, count_valid: true, mean_speed_kmh: null,
        counts_by_class: {carro: 0, moto: 0, guagua_bus: 0, camion: 0}}],
    }],
    alerts: [{
      alert_id: 'alert-demo', camera_id: 'cam-demo-01', source_mode: 'demo',
      kind: 'congestion_observed', status: 'open', observation_stale: true,
      observed: [{fact_code: 'persistent_congestion', duration_seconds: 30, mean_speed_kmh: 8}],
      probable_causes: [{code: 'undetermined', description: 'Causa no determinada.', confidence_level: 'bajo'}],
    }],
  };
}
function response() {
  return {
    statusCode: 0, headers: {}, body: '', writableEnded: false,
    setHeader(name, value) {this.headers[name.toLowerCase()] = value;},
    end(body) {this.body = body;this.writableEnded = true;},
  };
}
function jsonResponse(value = snapshot(), options = {}) {
  return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}, ...options});
}
async function invoke(handler, req = {method: 'GET', url: '/api/its'}) {
  const res = response();
  await handler(req, res);
  return {...res, json: JSON.parse(res.body)};
}

test('ITS gateway requests only the fixed anonymous snapshot and preserves unavailable values', async () => {
  const payload = snapshot();
  payload.unexpected = {private_key: 'must-not-escape'};
  payload.cameras[0].source.source_uri = 'rtsp://private-camera';
  payload.states[0].track_ids = [123];
  payload.alerts[0].review = {note: 'operator-private-note'};
  let actualUrl, actualOptions;
  const handler = createItsHandler({fetchImpl: async (url, options) => {
    actualUrl = url; actualOptions = options; return jsonResponse(payload);
  }});
  const result = await invoke(handler, {method: 'GET', url: '/api/its',
    headers: {authorization: 'Bearer firebase-test-value', cookie: 'private-cookie'}});
  assert.equal(result.statusCode, 200);
  assert.equal(actualUrl, DEFAULT_ITS_BACKEND_URL + '/v1/snapshot');
  assert.deepEqual(actualOptions.headers, {Accept: 'application/json'});
  assert.equal(actualOptions.credentials, 'omit');
  assert.equal(actualOptions.redirect, 'manual');
  assert.equal(actualOptions.cache, 'no-store');
  assert.equal(result.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(result.json.states[0].mean_speed_kmh, null);
  assert.equal(result.json.states[0].total_count, 0);
  assert.equal(result.json.states[0].received_at, timestamp);
  assert.equal(result.json.alerts[0].observation_stale, true);
  for (const privateText of ['must-not-escape', 'source_uri', 'track_ids', 'operator-private-note']) {
    assert.ok(!result.body.includes(privateText), privateText);
  }
});

test('ITS gateway is read only and never contacts an upstream for unsupported methods or query parameters', async () => {
  let calls = 0;
  const handler = createItsHandler({fetchImpl: async () => {calls++;return jsonResponse();}});
  for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const result = await invoke(handler, {method, url: '/api/its'});
    assert.equal(result.statusCode, 405);
    assert.equal(result.headers.allow, 'GET');
  }
  for (const req of [{method:'GET', url:'/api/its?url=https://private.test'},
    {method:'GET', url:'/api/its', query:{path:'/v1/alerts'}},
    {method:'GET', url:'http://[malformed'}]) {
    const result = await invoke(handler, req);
    assert.equal(result.statusCode, 400);
    assert.equal(result.json.error, 'unsupported_query');
  }
  assert.equal(calls, 0);
});

test('ITS gateway rejects non-demo data instead of relabelling it as synthetic', async () => {
  const changes = [
    value => {value.demo = false;},
    value => {value.states[0].source_mode = 'live';},
    value => {value.alerts[0].source_mode = 'replay';},
    value => {value.cameras[0].source.kind = 'rtsp';},
    value => {value.cameras[0].source.mode = 'live';},
    value => {value.cameras[0].state = {source_mode: 'live'};},
    value => {value.states = {};},
    value => {value.alerts = [null];},
    value => {value.cursor = 'not-a-cursor';},
    value => {value.server_time = 'not-a-time';},
  ];
  for (const change of changes) {
    const value = snapshot();change(value);
    const result = await invoke(createItsHandler({fetchImpl: async () => jsonResponse(value)}));
    assert.equal(result.statusCode, 502);
    assert.deepEqual(result.json, {error: 'its_invalid_response'});
  }
});

test('ITS gateway accepts a cold-start snapshot without inventing cameras or speeds', async () => {
  const value = {...snapshot(), cameras: [], states: [], alerts: [], cursor: '0'};
  const result = await invoke(createItsHandler({fetchImpl: async () => jsonResponse(value)}));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json.states, []);
  assert.deepEqual(result.json.cameras, []);
});

test('ITS upstream configuration permits HTTPS origins but not credentials, paths, queries or remote HTTP', async () => {
  let calls = 0;
  for (const backendOrigin of ['http://private.test', 'https://user:password@service.test',
    'https://service.test/path', 'https://service.test?key=secret', 'https://service.test#secret',
    'not a url']) {
    const handler = createItsHandler({backendOrigin, mode:'production',
      fetchImpl: async () => {calls++;return jsonResponse();}});
    const result = await invoke(handler);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json, {error: 'its_unavailable'});
  }
  assert.equal(calls, 0);
});

test('ITS loopback override is available to development/test only', async () => {
  for (const mode of ['development', 'test']) {
    let requested;
    const handler = createItsHandler({backendOrigin:'http://127.0.0.1:8010', mode,
      fetchImpl:async url => {requested=url;return jsonResponse();}});
    assert.equal((await invoke(handler)).statusCode, 200);
    assert.equal(requested, 'http://127.0.0.1:8010/v1/snapshot');
  }
  const prod=createItsHandler({backendOrigin:'http://127.0.0.1:8010',mode:'production',
    fetchImpl:async()=>{throw new Error('must-not-run');}});
  assert.equal((await invoke(prod)).statusCode, 503);
});

test('ITS reads its server-side override when handling a request, not when the module loads', async () => {
  const previous=process.env.ITS_BACKEND_URL;
  const requested=[];
  const handler=createItsHandler({fetchImpl:async url=>{requested.push(url);return jsonResponse();}});
  try {
    process.env.ITS_BACKEND_URL='https://first.example.test';
    await invoke(handler);
    process.env.ITS_BACKEND_URL='https://second.example.test';
    await invoke(handler);
    assert.deepEqual(requested,['https://first.example.test/v1/snapshot','https://second.example.test/v1/snapshot']);
  } finally {
    if(previous===undefined)delete process.env.ITS_BACKEND_URL;
    else process.env.ITS_BACKEND_URL=previous;
  }
});

test('ITS does not follow redirects or expose upstream errors/HTML', async () => {
  const results=[
    [new Response('private-error', {status:503}), 503, 'its_unavailable'],
    [new Response('redirect-private', {status:302,headers:{location:'https://other.test'}}), 502, 'its_invalid_response'],
    [new Response('<html>private-page</html>', {headers:{'content-type':'text/html'}}), 502, 'its_invalid_response'],
    [new Response('{invalid private JSON', {headers:{'content-type':'application/json'}}), 502, 'its_invalid_response'],
  ];
  for(const [upstream,code,error]of results) {
    const result=await invoke(createItsHandler({fetchImpl:async()=>upstream}));
    assert.equal(result.statusCode,code);
    assert.deepEqual(result.json,{error});
    assert.ok(!result.body.includes('private'));
  }
});

test('ITS bounds declared and streamed response sizes and cancels oversized bodies', async () => {
  let declaredCancelled=false;
  const declared=new ReadableStream({cancel(){declaredCancelled=true;}});
  const responseWithLength=new Response(declared,{headers:{'content-type':'application/json','content-length':'1000000'}});
  const result=await invoke(createItsHandler({maxResponseBytes:100,fetchImpl:async()=>responseWithLength}));
  assert.equal(result.statusCode,502);
  assert.ok(declaredCancelled);
  let streamedCancelled=false;
  const body=new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(101));},
    cancel(){streamedCancelled=true;},
  });
  const streamed=await invoke(createItsHandler({maxResponseBytes:100,
    fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json'}})}));
  assert.equal(streamed.statusCode,502);
  assert.ok(streamedCancelled);
});

test('ITS timeout aborts the upstream request and returns a controlled timeout response', async () => {
  let aborted=false;
  const handler=createItsHandler({timeoutMs:15,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('private timeout text','AbortError'));},{once:true});
  })});
  const result=await invoke(handler);
  assert.ok(aborted);
  assert.equal(result.statusCode,504);
  assert.deepEqual(result.json,{error:'its_timeout'});
});

test('ITS network failures do not reflect credentials or native exception text', async () => {
  const handler=createItsHandler({fetchImpl:async()=>{throw new Error('https://user:secret@private-backend');}});
  const result=await invoke(handler);
  assert.equal(result.statusCode,503);
  assert.deepEqual(result.json,{error:'its_unavailable'});
});

test('ITS handler works with a real Node HTTP response and the Vite plugin installs dev and preview routes', async t => {
  const handler=createItsHandler({fetchImpl:async()=>jsonResponse()});
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/its');
  assert.equal(result.status,200);
  assert.equal((await result.json()).demo,true);
  for(const configure of ['configureServer','configurePreviewServer']) {
    let middleware,nextCalls=0;
    const plugin=itsViteProxy({fetchImpl:async()=>jsonResponse()});
    plugin[configure]({middlewares:{use(value){middleware=value;}}});
    assert.equal(typeof middleware,'function');
    middleware({url:'/src/App.jsx'},response(),()=>nextCalls++);
    assert.equal(nextCalls,1);
    const proxyResult=response();
    await middleware({method:'GET',url:'/api/its'},proxyResult,()=>nextCalls++);
    assert.equal(proxyResult.statusCode,200);
    assert.equal(JSON.parse(proxyResult.body).demo,true);
    assert.equal(nextCalls,1);
  }
});
