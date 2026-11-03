import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGuestIdentityConfig, submitGuestReport} from '../src/guest-identity-client.js';

test('guest identity configuration requires explicit boolean and sends no identity or credentials', async () => {
  for (const enabled of [false, true]) {
    let observed;
    const signal = new AbortController().signal;
    const result = await fetchGuestIdentityConfig({signal, fetchImpl: async (url, options) => {
      observed = {url, options};
      return {ok: true, json: async () => ({guestIdentityEnabled: enabled})};
    }});
    assert.equal(result, enabled);
    assert.equal(observed.url, '/api/reports');
    assert.equal(observed.options.method, 'GET');
    assert.equal(observed.options.cache, 'no-store');
    assert.equal(observed.options.credentials, 'omit');
    assert.equal(observed.options.signal, signal);
    assert.equal(observed.options.body, undefined);
    assert.deepEqual(observed.options.headers, {Accept: 'application/json'});
  }
});

test('unknown configuration never becomes a disabled identity requirement', async () => {
  const cases = [
    {ok: false, json: async () => ({guestIdentityEnabled: false})},
    ...[null, [], {}, {guestIdentityEnabled: 0}, {guestIdentityEnabled: 'false'},
      {guestIdentityEnabled: null}, {error: 'unavailable'}].map(payload => ({ok: true, json: async () => payload})),
    {ok: true, json: async () => {throw new SyntaxError('invalid JSON');}},
  ];
  for (const response of cases) {
    await assert.rejects(fetchGuestIdentityConfig({fetchImpl: async () => response}));
  }
  await assert.rejects(fetchGuestIdentityConfig({fetchImpl: async () => {throw new TypeError('network failure');}}));
});

test('cancelled identity configuration propagates cancellation instead of choosing a report path', async () => {
  const controller = new AbortController();
  const request = fetchGuestIdentityConfig({signal: controller.signal, fetchImpl: (_url, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
  })});
  controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
});

test('private submission carries identity separately and only whitelists public report fields', async () => {
  const report = {category:'Otro', description:'Semáforo averiado en la esquina.', lat:18.47, lng:-69.94,
    occurredAt:'2026-01-01T10:00:00.000Z', identityHash:'must-not-be-public', cedula:'must-not-be-public'};
  let observed;
  const result = await submitGuestReport({report, cedula:'00000000000', token:'synthetic-test-token', fetchImpl:async (url, options) => {
    observed = {url, options, body:JSON.parse(options.body)};
    return {ok:true, json:async () => ({id:'test-report', status:'pending'})};
  }});
  assert.equal(result.status, 'pending');
  assert.equal(observed.url, '/api/reports');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.cache, 'no-store');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.body.cedula, '00000000000');
  assert.deepEqual(Object.keys(observed.body.report).sort(), ['category','description','lat','lng','occurredAt'].sort());
  assert.equal(observed.options.headers.Authorization, 'Bearer synthetic-test-token');
});

test('private submission errors are bounded codes and never trigger another report path', async () => {
  for (const response of [
    {ok:false, json:async () => ({error:'REPORTS_RATE_LIMIT'})},
    {ok:false, json:async () => ({error:'sensitive backend detail 00000000000'})},
    {ok:true, json:async () => ({id:'report', status:'approved'})},
    {ok:true, json:async () => {throw new SyntaxError('sensitive detail');}},
  ]) {
    let calls = 0;
    await assert.rejects(submitGuestReport({report:{}, cedula:'00000000000', token:'test', fetchImpl:async () => {calls++; return response;}}),
      error => ['REPORTS_RATE_LIMIT','REPORTS_UNAVAILABLE'].includes(error.code) && !error.message.includes('00000000000'));
    assert.equal(calls, 1);
  }
});
