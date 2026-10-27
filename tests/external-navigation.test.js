import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationUrl} from '../src/external-navigation.js';

const origin = {lat: 18.486058, lon: -69.931212};
const destination = {lat: 18.472389, lon: -69.884031};
const places = {origin, destination};
const providers = ['Google Maps', 'Apple Maps', 'Waze'];

test('Waze uses its canonical universal link and the selected Santo Domingo destination', () => {
  const url = new URL(navigationUrl('Waze', places));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'www.waze.com');
  assert.equal(url.pathname, '/ul');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ll: '18.472389,-69.884031',
    navigate: 'yes',
    utm_source: 'saferoute',
  });
  assert.equal(url.hash, '');
});

test('Google Maps preserves selected origin and destination in driving directions', () => {
  const url = new URL(navigationUrl('Google Maps', places));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.pathname, '/maps/dir/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    api: '1',
    origin: '18.486058,-69.931212',
    destination: '18.472389,-69.884031',
    travelmode: 'driving',
  });
});

test('Apple Maps preserves selected origin and destination in driving directions', () => {
  const url = new URL(navigationUrl('Apple Maps', places));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'maps.apple.com');
  assert.equal(url.pathname, '/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    saddr: '18.486058,-69.931212',
    daddr: '18.472389,-69.884031',
    dirflg: 'd',
  });
});

test('coordinate query encoding round-trips negative longitude without extra parameters', () => {
  for (const provider of providers) {
    const href = navigationUrl(provider, places);
    assert.match(href, /18\.472389%2C-69\.884031/);
    const url = new URL(href);
    const key = provider === 'Waze' ? 'll' : provider === 'Apple Maps' ? 'daddr' : 'destination';
    assert.equal(url.searchParams.get(key), `${destination.lat},${destination.lon}`);
  }
});

test('zero and geographic coordinate limits are valid', () => {
  for (const provider of providers) {
    assert.ok(navigationUrl(provider, {origin: {lat: 0, lon: 0}, destination: {lat: -90, lon: 180}}));
    assert.ok(navigationUrl(provider, {origin: {lat: 90, lon: -180}, destination: {lat: 0, lon: 0}}));
  }
});

test('missing selections and malformed coordinates produce no navigation link', () => {
  const invalidPoints = [
    null, undefined, {}, {lat: 18.47}, {lon: -69.94},
    {lat: 90.01, lon: 0}, {lat: -90.01, lon: 0},
    {lat: 0, lon: 180.01}, {lat: 0, lon: -180.01},
    {lat: NaN, lon: 0}, {lat: 0, lon: NaN},
    {lat: Infinity, lon: 0}, {lat: 0, lon: -Infinity},
    {lat: '18.47', lon: -69.94}, {lat: 18.47, lon: '-69.94'},
    {lat: null, lon: null}, {lat: '', lon: ''},
    {lat: 18.47, lon: '-69.94&navigate=no'},
  ];
  for (const provider of providers) {
    assert.equal(navigationUrl(provider), null);
    assert.equal(navigationUrl(provider, null), null);
    assert.equal(navigationUrl(provider, {}), null);
    for (const point of invalidPoints) {
      assert.equal(navigationUrl(provider, {origin, destination: point}), null);
      assert.equal(navigationUrl(provider, {origin: point, destination}), null);
    }
  }
});

test('unsupported provider names never fall back to another navigation service', () => {
  for (const provider of [undefined, null, '', 'waze', 'Unknown']) {
    assert.equal(navigationUrl(provider, places), null);
  }
});
