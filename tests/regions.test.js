import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countryMapView, countryOptions, normalizeCountry} from '../src/regions.js';

test('el selector incluye países de diferentes continentes con nombres localizados', () => {
  const english = countryOptions('en');
  assert.equal(new Set(english.map(item => item.code)).size, english.length);
  assert.ok(english.length >= 240);
  for (const code of ['do', 'us', 'fr', 'br', 'cn', 'za', 'au', 'jp']) assert.ok(english.some(item => item.code === code));
  assert.equal(english.find(item => item.code === 'fr').name, 'France');
  assert.equal(countryOptions('es').find(item => item.code === 'us').name, 'Estados Unidos');
});

test('la selección inválida vuelve a búsqueda mundial y los códigos válidos se normalizan', () => {
  assert.equal(normalizeCountry('FR'), 'fr');
  assert.equal(normalizeCountry('us'), 'us');
  for (const value of ['', 'all', null, undefined, 'invalid', 'fr&apiKey=bad']) assert.equal(normalizeCountry(value), 'all');
});

test('cada país del selector tiene una vista geográfica válida disponible sin conexión', () => {
  const countries = countryOptions('es');
  assert.equal(countries.length, 249);
  for (const {code} of countries) {
    const {center, zoom} = countryMapView(code);
    assert.equal(center.length, 2, code);
    assert.ok(Number.isFinite(center[0]) && Math.abs(center[0]) <= 85, code);
    assert.ok(Number.isFinite(center[1]) && Math.abs(center[1]) <= 180, code);
    assert.ok(Number.isInteger(zoom) && zoom >= 2 && zoom <= 12, code);
    assert.notDeepEqual(center, countryMapView('all').center, code);
  }
});

test('las vistas de otros países salen de República Dominicana y se centran en su territorio', () => {
  const bounds = {
    us: [25, 50, -125, -65],
    fr: [40, 52, -5, 10],
    bo: [-24, -9, -70, -57],
    es: [35, 45, -10, 5],
    do: [17.5, 20, -72, -68],
    jp: [30, 46, 129, 146],
    za: [-35, -22, 16, 33],
  };
  for (const [code, [south, north, west, east]] of Object.entries(bounds)) {
    const {center: [lat, lon]} = countryMapView(code);
    assert.ok(lat >= south && lat <= north && lon >= west && lon <= east, code);
  }
  assert.ok(countryMapView('us').zoom < countryMapView('fr').zoom);
  assert.ok(countryMapView('fr').zoom < countryMapView('ad').zoom);
  assert.deepEqual(countryMapView('FR'), countryMapView('fr'));
});

test('búsqueda mundial y entradas inválidas vuelven a una vista mundial independiente', () => {
  const world = {center: [20, 0], zoom: 2};
  for (const value of ['all', '', null, undefined, 'invalid', 'constructor', '__proto__']) {
    assert.deepEqual(countryMapView(value), world);
  }
  const first = countryMapView('fr');
  first.center[0] = 0;
  assert.notEqual(countryMapView('fr').center[0], 0);
});
