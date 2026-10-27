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
    return handler(url, options);
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
  assert.deepEqual(places[0], {id: 'address-1', position: start, address: {freeformAddress: 'Calle A & B, Santo Domingo'}, type: 'address'});
  assert.equal(places.length, 2);
  assert.equal(places[1].address.freeformAddress, 'Calle Dos, Santiago');
  assert.deepEqual(requests.map(url => url.pathname), ['/v1/geocode/autocomplete', '/v1/geocode/search']);
  assert.equal(requests[0].searchParams.get('text'), 'Calle A & B');
  assert.equal(requests[0].searchParams.get('filter'), 'countrycode:do');
  assert.equal(requests[0].searchParams.get('format'), 'json');
  assert.equal(requests[0].searchParams.get('lang'), 'es');
  assert.deepEqual(await client.geocode('  '), []);
  assert.equal(requests.length, 2);
});

test('autocomplete accepts partial place names, normalizes whitespace, and preserves named POIs', async () => {
  const school = {place_id: 'school', name: 'Colegio Jaime Molina Mota', lat: 18.4748758, lon: -69.966376,
    formatted: 'Calle Timoteo Ogando, Santo Domingo', result_type: 'amenity', country_code: 'do'};
  const {client, requests} = mockClient(() => success({results: [school, school,
    {...school, place_id: 'foreign', country_code: 'co'}, {...school, lat: NaN}]}));
  const places = await client.suggestPlaces('  Colegio\n Jaime  ', {bias: end});
  assert.deepEqual(places, [{id: 'school', name: school.name, type: 'poi',
    position: {lat: school.lat, lon: school.lon},
    address: {freeformAddress: 'Colegio Jaime Molina Mota, Calle Timoteo Ogando, Santo Domingo'}}]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/v1/geocode/autocomplete');
  assert.equal(requests[0].searchParams.get('text'), 'Colegio Jaime');
  assert.equal(requests[0].searchParams.get('filter'), 'countrycode:do');
  assert.equal(requests[0].searchParams.get('bias'), 'proximity:-69.9,18.5');
  assert.equal(requests[0].searchParams.get('lang'), 'es');
  for (const input of ['', '  ', 'co', null]) assert.deepEqual(await client.suggestPlaces(input), []);
  assert.equal(requests.length, 1);
});

test('canonical named Places lookup enriches an autocomplete address and removes its duplicate', async () => {
  const club = {name: 'Club San Gerónimo', lat: 18.4728257, lon: -69.9632709, country_code: 'do'};
  const {client, requests} = mockClient(url => url.pathname === '/v1/geocode/autocomplete'
    ? success({results: [{...club, place_id: 'autocomplete-club', result_type: 'postcode', formatted: 'Club San Gerónimo, Santo Domingo'}]})
    : success({features: [{properties: {...club, place_id: 'poi-club', formatted: 'Santo Domingo'}}]}));
  const places = await client.suggestPlaces('Club San Geronimo');
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], {id: 'poi-club', name: club.name, type: 'poi',
    position: {lat: club.lat, lon: club.lon}, address: {freeformAddress: 'Club San Gerónimo, Santo Domingo'}});
  assert.equal(requests[1].pathname, '/v2/places');
  assert.equal(requests[1].searchParams.get('name'), 'Club San Gerónimo');
  assert.equal(requests[1].searchParams.get('filter'), 'circle:-69.9632709,18.4728257,100000');
  assert.equal(requests[1].searchParams.get('bias'), 'proximity:-69.9632709,18.4728257');
  assert.ok(requests[1].searchParams.get('categories').split(',').includes('sport'));
});

test('country selection accepts foreign POIs and worldwide search omits the country restriction', async () => {
  const paris = {place_id: 'eiffel', name: 'Tour Eiffel', lat: 48.85826, lon: 2.2945,
    formatted: 'Tour Eiffel, Paris, France', result_type: 'amenity', country_code: 'fr'};
  const newYork = {place_id: 'nyc', lat: 40.7127, lon: -74.0059,
    formatted: 'New York, United States', country_code: 'us'};
  const {client, requests} = mockClient(() => success({results: [paris, newYork]}));
  assert.deepEqual((await client.suggestPlaces('Tour Eiffel', {country: ' FR ', language: 'fr-FR'})).map(place => place.id), ['eiffel']);
  assert.equal(requests[0].searchParams.get('filter'), 'countrycode:fr');
  assert.equal(requests[0].searchParams.get('lang'), 'fr');
  for (const country of ['all', '']) {
    assert.deepEqual((await client.geocode('Paris or New York', {country, language: 'EN_us'})).map(place => place.id), ['eiffel', 'nyc']);
  }
  for (const url of requests.slice(1)) {
    assert.equal(url.searchParams.has('filter'), false);
    assert.equal(url.searchParams.get('lang'), 'en');
  }
});

test('foreign named POIs use their autocomplete coordinates for Places instead of the map bias', async () => {
  const paris = {name: 'Tour Eiffel', lat: 48.85826, lon: 2.2945, country_code: 'fr'};
  const {client, requests} = mockClient(url => url.pathname === '/v1/geocode/autocomplete'
    ? success({results: [{...paris, place_id: 'eiffel-street', result_type: 'street', formatted: 'Paris, France'}]})
    : success({features: [
      {properties: {...paris, place_id: 'eiffel-poi', formatted: 'Paris, France'}},
      {properties: {...paris, place_id: 'wrong-country', country_code: 'us'}},
    ]}));
  const places = await client.suggestPlaces('Eiffel', {country: 'fr', language: 'en', bias: start});
  assert.deepEqual(places.map(place => [place.id, place.type]), [['eiffel-poi', 'poi']]);
  assert.equal(requests[1].searchParams.get('filter'), 'circle:2.2945,48.85826,100000');
  assert.equal(requests[1].searchParams.get('bias'), 'proximity:2.2945,48.85826');
  assert.equal(requests[1].searchParams.get('lang'), 'en');
});

test('worldwide named search without an autocomplete candidate stays near the supplied map location', async () => {
  const {client, requests} = mockClient(url => success(url.pathname === '/v2/places'
    ? {features: [{properties: {place_id: 'landmark', name: 'Named landmark', country_code: 'gb'},
      geometry: {type: 'Point', coordinates: [-0.12, 51.5]}}]}
    : {results: []}));
  const places = await client.suggestPlaces('Named landmark', {country: 'all', language: 'en-GB', bias: {lat: 51.5, lon: -0.12}});
  assert.deepEqual(places[0].position, {lat: 51.5, lon: -0.12});
  assert.equal(requests[0].searchParams.has('filter'), false);
  assert.equal(requests[1].searchParams.get('filter'), 'circle:-0.12,51.5,100000');
  assert.equal(requests[1].searchParams.get('bias'), 'proximity:-0.12,51.5');
});

test('manual geocoding merges autocomplete POIs with full-address results without claiming missing exact places', async () => {
  const school = {place_id: 'school', lat: start.lat, lon: start.lon, name: 'Colegio Jaime Molina Mota',
    formatted: 'Colegio Jaime Molina Mota, Santo Domingo', result_type: 'amenity'};
  const {client} = mockClient(url => success({results: url.pathname.endsWith('/autocomplete')
    ? [school] : [school, {place_id: 'street', lat: end.lat, lon: end.lon, formatted: 'Calle Jaime, Santo Domingo'}]}));
  assert.deepEqual((await client.geocode('Colegio Jaime')).map(place => [place.id, place.type]), [['school', 'poi'], ['street', 'address']]);
  const empty = mockClient(url => success(url.pathname === '/v2/places' ? {features: []} : {results: []}));
  assert.deepEqual(await empty.client.suggestPlaces('Un lugar sin datos'), []);
  const postcode = mockClient(url => success(url.pathname === '/v2/places' ? {features: []}
    : {results: [{place_id: 'area', name: 'Club San Gerónimo', lat: start.lat, lon: start.lon, result_type: 'postcode'}]}));
  assert.equal((await postcode.client.suggestPlaces('Club San Geronimo'))[0].type, 'address');
});

test('cancelled autocomplete cannot return stale results or leak provider details', async () => {
  let releaseOld;
  const {client, requests} = mockClient((url, options) => {
    if (url.searchParams.get('text') === 'Colegio viejo') {
      return new Promise(resolve => {
        releaseOld = () => resolve(success({results: [{place_id: 'old', lat: start.lat, lon: start.lon, formatted: 'Viejo'}]}));
        assert.equal(options.signal.aborted, false);
      });
    }
    return success({results: [{place_id: 'new', lat: end.lat, lon: end.lon, formatted: 'Colegio nuevo', result_type: 'amenity'}]});
  });
  const controller = new AbortController();
  const old = client.suggestPlaces('Colegio viejo', {signal: controller.signal});
  controller.abort('unsafe provider secret');
  const current = await client.suggestPlaces('Colegio nuevo');
  releaseOld();
  await assert.rejects(old, error => error.name === 'AbortError' && !error.message.includes('secret'));
  assert.equal(current[0].id, 'new');
  const count = requests.length;
  await assert.rejects(client.suggestPlaces('Colegio viejo', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(requests.length, count);

  const network = createGeoapifyClient({apiKey: 'test-only-placeholder', fetchImpl: (_url, {signal}) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('unsafe URL provider secret')), {once: true});
  })});
  const inFlight = new AbortController();
  const cancelled = network.suggestPlaces('Colegio', {signal: inFlight.signal});
  inFlight.abort();
  await assert.rejects(cancelled, error => error.name === 'AbortError' && !error.message.includes('secret'));
});

test('suggestion HTTP failures remain actionable and do not expose URLs or credentials', async () => {
  for (const [status, pattern] of [[401, /clave/], [403, /dominios/], [429, /límite/], [503, /disponible/]]) {
    const {client} = mockClient(() => ({ok: false, status}));
    await assert.rejects(client.suggestPlaces('Colegio Jaime'), error => pattern.test(error.message)
      && !error.message.includes('test-only-placeholder') && !error.message.includes('https://'));
  }
  const {client} = mockClient(url => success(url.pathname === '/v1/geocode/autocomplete' ? {results: []} : {features: 'invalid'}));
  await assert.rejects(client.suggestPlaces('Club San Geronimo'), /lugares no válidos/);
  const deniedPlace = mockClient(url => url.pathname === '/v2/places' ? {ok: false, status: 403}
    : success({results: [{name: 'Club San Gerónimo', lat: start.lat, lon: start.lon, result_type: 'postcode'}]}));
  await assert.rejects(deniedPlace.client.suggestPlaces('Club San Geronimo'), /dominios/);
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

test('routing and nearby requests receive the selected language while preserving coordinate ordering', async () => {
  const paris = {lat: 48.85826, lon: 2.2945};
  const louvre = {lat: 48.8606, lon: 2.3376};
  const {client, requests} = mockClient(url => success({features: url.pathname === '/v1/routing'
    ? [feature({type: 'LineString', coordinates: [[paris.lon, paris.lat], [louvre.lon, louvre.lat]]})] : []}));
  const routes = await client.getRoutes(paris, louvre, {language: 'en-US'});
  await client.nearbyPlaces(paris, {language: 'fr-FR'});
  assert.deepEqual(routes[0].points[0], {latitude: paris.lat, longitude: paris.lon});
  for (const url of requests.filter(url => url.pathname === '/v1/routing')) {
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.equal(url.searchParams.get('waypoints'), '48.85826,2.2945|48.8606,2.3376');
  }
  for (const url of requests.filter(url => url.pathname === '/v2/places')) {
    assert.equal(url.searchParams.get('lang'), 'fr');
    assert.equal(url.searchParams.get('filter'), 'circle:2.2945,48.85826,5000');
  }
});

test('Arabic and Chinese UI languages use supported routing instructions and retain their Places language', async () => {
  for (const language of ['ar', 'zh']) {
    const {client, requests} = mockClient(url => url.pathname === '/v1/routing'
      ? url.searchParams.get('lang') === 'en'
        ? success({features: [feature()]})
        : {ok: false, status: 400}
      : success({features: []}));
    assert.equal((await client.getRoutes(start, end, {language})).length, 1);
    await client.nearbyPlaces(start, {language});
    assert.ok(requests.filter(url => url.pathname === '/v1/routing').every(url => url.searchParams.get('lang') === 'en'));
    assert.ok(requests.filter(url => url.pathname === '/v2/places').every(url => url.searchParams.get('lang') === language));
  }
});

test('map themes select official raster styles and missing configuration uses OSM', async () => {
  const {client} = mockClient(() => success({}));
  assert.equal(client.hasRouting, true);
  assert.match(client.tileUrl('light'), /^https:\/\/maps\.geoapify\.com\/v1\/tile\/osm-carto\/\{z\}\/\{x\}\/\{y\}\.png\?apiKey=/);
  assert.match(client.tileUrl('dark'), /\/tile\/dark-matter-yellow-roads\//);
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
