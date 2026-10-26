import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGeoapifyClient} from '../src/geoapify.js';

const start = {lat: 18.48, lon: -69.94};
const end = {lat: 18.5, lon: -69.9};
const coordinates = [[-69.94, 18.48], [-69.92, 18.49], [-69.9, 18.5]];
const success = body => ({ok: true, status: 200, json: async () => body});
function feature(geometry = {type: 'LineString', coordinates}, overrides = {}) {
  return {
    type: 'Feature', geometry,
    properties: {distance: 5600, time: 720, legs: [{steps: [{distance: 100, time: 15, instruction: {text: 'Gira a la derecha.'}}]}], ...overrides},
  };
}
function mockClient(handler) {
  const requests = [];
  const client = createGeoapifyClient({apiKey: 'test-only-placeholder', fetchImpl: async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    return handler(url);
  }});
  return {client, requests};
}

test('geocoding encodes Spanish address queries and normalizes only valid coordinates', async () => {
  const {client, requests} = mockClient(() => success({results: [
    {place_id: 'address-1', lat: 18.48, lon: -69.94, formatted: 'Calle A & B, Santo Domingo'},
    {lat: 19, lon: -70, address_line1: 'Calle Dos', address_line2: 'Santiago'},
    {lat: 91, lon: -69}, {lat: '18.5', lon: -69}, null,
  ]}));
  const places = await client.geocode(' Calle A & B ');
  assert.deepEqual(places[0], {id: 'address-1', position: start, address: {freeformAddress: 'Calle A & B, Santo Domingo'}});
  assert.equal(places.length, 2);
  assert.equal(places[1].address.freeformAddress, 'Calle Dos, Santiago');
  assert.equal(requests[0].pathname, '/v1/geocode/search');
  assert.equal(requests[0].searchParams.get('text'), 'Calle A & B');
  assert.equal(requests[0].searchParams.get('filter'), 'countrycode:do');
  assert.equal(requests[0].searchParams.get('format'), 'json');
  assert.equal(requests[0].searchParams.get('lang'), 'es');
  assert.deepEqual(await client.geocode('  '), []);
  assert.equal(requests.length, 1);
});

test('routing requests supported preferences and preserves GeoJSON longitude/latitude geometry', async () => {
  const shorter = [[-69.94, 18.48], [-69.93, 18.5], [-69.9, 18.5]];
  const {client, requests} = mockClient(url => success({features: [url.searchParams.get('type') === 'short'
    ? feature({type: 'LineString', coordinates: shorter}, {distance: 5300, time: 760})
    : feature({type: 'MultiLineString', coordinates: [coordinates.slice(0, 2), coordinates.slice(1)]})]}));
  const routes = await client.getRoutes(start, end);
  assert.deepEqual(routes.map(route => [route.id, route.name]), [['balanced', 'Recomendada'], ['short', 'Más corta']]);
  assert.deepEqual(routes[0].points, coordinates.map(([longitude, latitude]) => ({latitude, longitude})));
  assert.deepEqual(routes[0].instructions, [{text: 'Gira a la derecha.', distance: 100, seconds: 15}]);
  assert.equal(routes[0].seconds, 720);
  assert.equal(routes[0].distance, 5600);
  assert.deepEqual(requests.map(url => url.searchParams.get('type')), ['balanced', 'short']);
  for (const url of requests) {
    assert.equal(url.pathname, '/v1/routing');
    assert.equal(url.searchParams.get('waypoints'), '18.48,-69.94|18.5,-69.9');
    assert.equal(url.searchParams.get('traffic'), 'free_flow');
    assert.equal(url.searchParams.get('units'), 'metric');
    assert.equal(url.searchParams.get('mode'), 'drive');
    assert.equal(url.searchParams.has('alternatives'), false);
    assert.equal(url.searchParams.has('departure'), false);
    assert.equal('trafficDelay' in routes[0], false);
  }
});

test('identical preferences display one real route and one failed preference preserves the other', async () => {
  const duplicate = mockClient(() => success({features: [feature()]}));
  assert.equal((await duplicate.client.getRoutes(start, end)).length, 1);
  const partial = mockClient(url => url.searchParams.get('type') === 'balanced'
    ? {ok: false, status: 503} : success({features: [feature()]}));
  const routes = await partial.client.getRoutes(start, end);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, 'short');
});

test('malformed and disconnected route geometry is never joined into invented paths', async () => {
  const malformed = [
    {type: 'LineString', coordinates: null},
    {type: 'LineString', coordinates: [[-69, 18]]},
    {type: 'LineString', coordinates: [[-69, 18], ['-69.1', 18.1]]},
    {type: 'LineString', coordinates: [[-69, 18], [-69.1, 91]]},
    {type: 'MultiLineString', coordinates: [coordinates.slice(0, 2), [[-70, 19], [-70.1, 19.1]]]},
    {type: 'Polygon', coordinates: [coordinates]},
  ];
  for (const geometry of malformed) {
    const {client} = mockClient(() => success({features: [feature(geometry)]}));
    assert.deepEqual(await client.getRoutes(start, end), []);
  }
  const {client} = mockClient(() => success({features: [feature(undefined, {time: '720'})]}));
  assert.deepEqual(await client.getRoutes(start, end), []);
});

test('nearby services use documented categories and longitude-first circle filters', async () => {
  const {client, requests} = mockClient(url => success({features: [
    {properties: {place_id: url.searchParams.get('categories'), name: 'Servicio', formatted: 'Calle Principal'}, geometry: {type: 'Point', coordinates: [-69.94, 18.48]}},
    {properties: {lat: 200, lon: -69}},
  ]}));
  const places = await client.nearbyPlaces(start);
  assert.deepEqual(requests.map(url => url.searchParams.get('categories')), [
    'service.vehicle.fuel', 'healthcare.pharmacy', 'commercial.supermarket', 'healthcare.hospital',
  ]);
  assert.deepEqual(places.map(place => [place.type, place.icon]), [
    ['Gasolineras', '⛽'], ['Farmacias', '✚'], ['Supermercados', '🛒'], ['Hospitales', '🏥'],
  ]);
  assert.equal(places[0].lat, start.lat);
  assert.equal(places[0].lon, start.lon);
  assert.equal(places[0].address, 'Calle Principal');
  for (const url of requests) {
    assert.equal(url.pathname, '/v2/places');
    assert.equal(url.searchParams.get('filter'), 'circle:-69.94,18.48,5000');
    assert.equal(url.searchParams.get('bias'), 'proximity:-69.94,18.48');
  }
});

test('map themes select official raster styles and missing configuration uses OSM', async () => {
  const {client} = mockClient(() => success({}));
  assert.equal(client.hasRouting, true);
  assert.match(client.tileUrl('light'), /^https:\/\/maps\.geoapify\.com\/v1\/tile\/osm-carto\/\{z\}\/\{x\}\/\{y\}\.png\?apiKey=/);
  assert.match(client.tileUrl('dark'), /\/tile\/dark-matter\//);
  let requests = 0;
  const missing = createGeoapifyClient({fetchImpl: () => {requests++;}});
  assert.equal(missing.hasRouting, false);
  assert.equal(missing.tileUrl('dark'), 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  await assert.rejects(missing.geocode('Santo Domingo'), /VITE_GEOAPIFY_API_KEY/);
  assert.equal(requests, 0);
});

test('HTTP, network, malformed responses, and invalid points produce safe actionable errors', async () => {
  for (const [status, pattern] of [[401, /clave/], [403, /dominios/], [429, /límite/], [503, /disponible/], [400, /datos/]]) {
    const {client} = mockClient(() => ({ok: false, status, json: async () => {throw new Error('provider secret');}}));
    await assert.rejects(client.getRoutes(start, end), error => pattern.test(error.message) && !error.message.includes('test-only-placeholder'));
  }
  const broken = createGeoapifyClient({apiKey: 'test-only-placeholder', fetchImpl: async () => {throw new Error('URL with provider secret');}});
  await assert.rejects(broken.geocode('Santo Domingo'), error => /conexión/.test(error.message) && !error.message.includes('secret'));
  const {client, requests} = mockClient(() => success({unexpected: []}));
  await assert.rejects(client.geocode('Santo Domingo'), /búsqueda no válida/);
  await assert.rejects(client.getRoutes(start, end), /ruta no válida/);
  await assert.rejects(client.nearbyPlaces(start), /lugares no válidos/);
  const count = requests.length;
  await assert.rejects(client.getRoutes({lat: NaN, lon: -69}, end), /punto válido/);
  await assert.rejects(client.nearbyPlaces({lat: 18, lon: 181}), /punto válido/);
  assert.equal(requests.length, count);
});
