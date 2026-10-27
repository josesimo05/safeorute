import test from 'node:test';
import assert from 'node:assert/strict';
import {getDirection, languages, resolveLanguage, translateText} from '../src/i18n.js';
import {sourceStrings, translationRows, translations} from '../src/translations.js';

test('all eight offline languages contain every UI string and preserve placeholders', () => {
  const sourceKeys = Object.keys(translations.es).sort();
  assert.equal(languages.length, 8);
  assert.equal(new Set(sourceStrings).size, sourceStrings.length);
  assert.ok(sourceKeys.length > 200);
  const placeholders = text => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();
  for (const row of translationRows) {
    assert.equal(row.length, languages.length, row[0]);
    assert.ok(row.every(value => typeof value === 'string' && value.trim()), row[0]);
  }
  for (const {code} of languages) {
    assert.deepEqual(Object.keys(translations[code]).sort(), sourceKeys, code);
    for (const source of sourceKeys) {
      assert.deepEqual(placeholders(translations[code][source]), placeholders(source), `${code}: ${source}`);
    }
  }
});

test('locale variants resolve to supported packs with a Spanish fallback', () => {
  for (const [locale, expected] of [
    ['en-US', 'en'], ['fr_CA', 'fr'], ['pt-BR', 'pt'], [' DE-de ', 'de'],
    ['zh-Hans-CN', 'zh'], ['ar-SA', 'ar'], ['it', 'it'], ['ja-JP', 'es'],
    ['', 'es'], [null, 'es'], [undefined, 'es'], [42, 'es'],
  ]) assert.equal(resolveLanguage(locale), expected);
  assert.equal(translateText('Origen', 'unsupported'), 'Origen');
});

test('Arabic selects right-to-left layout while other packs stay left-to-right', () => {
  assert.equal(getDirection('ar-EG'), 'rtl');
  for (const {code, dir} of languages) {
    assert.equal(getDirection(code), dir);
    if (code !== 'ar') assert.equal(dir, 'ltr');
  }
  assert.equal(getDirection('unknown'), 'ltr');
});

test('explicit templates preserve numeric values and user-supplied labels literally', () => {
  assert.equal(translateText('{count} rutas disponibles', 'en', {count: 12}), '12 routes available');
  assert.equal(translateText('{distance} km · tiempo estimado', 'fr', {distance: '4.7'}), '4.7 km · durée estimée');
  const label = '<Club María & Sons> $& {count}';
  assert.equal(translateText('Buscar {field}', 'en', {field: label}), `Search ${label}`);
  assert.equal(translateText('Ruta {number}', 'zh', {number: 0}), '路线 0');
  assert.equal(translateText('Ruta {number}', 'en'), 'Route {number}');
  assert.equal(translateText('Plantilla {name}', 'fr', {name: 'María'}), 'Plantilla María');
});

test('only known UI copy and narrowly defined numeric app messages are translated', () => {
  assert.equal(translateText('4 reportes', 'en'), '4 reports');
  assert.equal(translateText('Geoapify calculó 2 rutas distintas.', 'fr'), 'Geoapify a calculé 2 itinéraires distincts.');
  for (const original of [
    'Bache frente a la casa de María.',
    'Colegio Jaime Molina Mota',
    'Calle 12, Santo Domingo',
    'Gira a la derecha en Avenida Central',
    'Ruta 3 frente a mi casa',
    'No hay 3 reportes en esta esquina',
    'constructor', '__proto__',
  ]) {
    for (const {code} of languages) assert.equal(translateText(original, code), original);
  }
  assert.equal(translateText(null, 'en'), null);
  assert.equal(translateText(123, 'en'), 123);
});

test('core controls and detailed error messages are available in every pack', () => {
  for (const {code} of languages.filter(language => language.code !== 'es')) {
    for (const source of [
      'Idioma y país', 'Entrar / Crear cuenta', 'Enviar a revisión', 'Limpiar filtros',
      'Sin conexión.', 'Los nombres de lugares y los reportes se muestran en su idioma original.',
      'El correo o la contraseña no son correctos. Revisa tus datos.',
      'No se pudo conectar con Geoapify. Revisa tu conexión y vuelve a intentar.',
    ]) {
      assert.ok(Object.hasOwn(translations[code], source), `${code}: ${source}`);
      assert.notEqual(translateText(source, code), source, `${code}: ${source}`);
    }
  }
});
