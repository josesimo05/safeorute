import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countryOptions, normalizeCountry} from '../src/regions.js';

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
