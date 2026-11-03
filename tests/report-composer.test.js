import test from 'node:test';
import assert from 'node:assert/strict';
import {composeReportDescription, reportDetailsLimit, reportDuplicateIdentity} from '../src/report-composer.js';
import {categories, duplicate, validate} from '../src/logic.js';
import {languages, translateText} from '../src/i18n.js';

const report = {
  category: 'Otro', description: 'Un árbol caído bloquea el paso.',
  lat: 18.47, lng: -69.94, occurredAt: '2026-01-01T10:00:00.000Z',
};

test('los reportes sin detalle cumplen el esquema en los ocho idiomas, incluido chino', () => {
  for (const {code} of languages) {
    for (const category of categories.filter(value => value !== 'Otro')) {
      const description = composeReportDescription({category,
        fallback:translateText('Reporte comunitario de {category}.', code, {category:translateText(category, code)})});
      assert.equal(validate({...report, category, description}), '', `${code}: ${description}`);
    }
    const description = composeReportDescription({category:'Otro', customType:'水',
      fallback:translateText('Reporte comunitario.', code)});
    assert.equal(validate({...report, description}), '', `${code}: ${description}`);
  }
});

test('un tipo libre no necesita palabras clave y conserva el detalle escrito', () => {
  const description = composeReportDescription({
    category: 'Otro', customType: '  Ruido excesivo  ',
    description: '  Música muy alta junto al parque.  ', fallback: 'Otro incidente reportado.',
  });
  assert.equal(description, 'Ruido excesivo: Música muy alta junto al parque.');
  assert.equal(validate({...report, description}), '');
  assert.equal(composeReportDescription({
    category: 'Otro', customType: 'Tubería rota', description: '', fallback: 'Incidente reportado.',
  }), 'Tubería rota: Incidente reportado.');
});

test('las categorías conocidas aceptan su texto por defecto sin sustituir detalles', () => {
  assert.equal(composeReportDescription({
    category: 'Bache', customType: 'No debe cambiar la categoría', description: ' ', fallback: 'Reporte comunitario de bache.',
  }), 'Reporte comunitario de bache.');
  assert.equal(composeReportDescription({
    category: 'Bache', description: 'Un hoyo profundo en el carril derecho.', fallback: 'Reporte comunitario de bache.',
  }), 'Un hoyo profundo en el carril derecho.');
});

test('Otro no inventa un incidente cuando no hay tipo ni detalle', () => {
  assert.equal(composeReportDescription({category: 'Otro', customType: ' ', description: '', fallback: 'Otro incidente.'}), '');
  assert.equal(composeReportDescription({category: 'Otro', description: report.description}), report.description);
  assert.equal(composeReportDescription(), '');
});

test('el límite incluye el prefijo y no descarta texto que exceda 600 caracteres', () => {
  const customType = 'Inundación';
  const limit = reportDetailsLimit('Otro', ` ${customType} `);
  assert.equal(limit, 600 - customType.length - 2);
  const exact = composeReportDescription({category: 'Otro', customType, description: 'x'.repeat(limit)});
  assert.equal(exact.length, 600);
  assert.equal(validate({...report, description: exact}), '');
  const tooLong = composeReportDescription({category: 'Otro', customType, description: 'x'.repeat(limit + 1)});
  assert.equal(tooLong.length, 601);
  assert.equal(validate({...report, description: tooLong}), 'Escribe entre 12 y 600 caracteres.');
  assert.equal(reportDetailsLimit('Bache', customType), 600);
  assert.equal(reportDetailsLimit('Otro', ' '), 600);
  assert.equal(reportDetailsLimit('Otro', 'x'.repeat(60)), 538);
});

test('la validación de datos personales incluye el nombre libre del tipo', () => {
  for (const customType of ['809-555-1234', 'persona@example.com', 'https://example.com']) {
    const description = composeReportDescription({category: 'Otro', customType, fallback: 'Incidente reportado.'});
    assert.equal(validate({...report, description}), 'No incluyas enlaces, correos ni teléfonos.');
  }
});

test('el mismo tipo Otro normalizado cuenta como posible duplicado con detalles distintos', () => {
  const current = {...report, description: 'Inundación: Agua acumulada en la esquina.'};
  const previous = {...report, description: '  ＩＮＵＮＤＡＣＩＯＮ: Otro detalle de la misma inundación.'};
  assert.equal(duplicate(current, [previous]), previous);
  assert.equal(reportDuplicateIdentity('  Ruido   excesivo: Un detalle.'), 'ruido excesivo');
  assert.equal(duplicate(current, [{...previous, lat: 19}]), undefined);
  assert.equal(duplicate(current, [{...previous, occurredAt: '2026-01-01T12:00:00.000Z'}]), undefined);
});

test('tipos distintos y reportes Otro antiguos con hechos diferentes no se bloquean entre sí', () => {
  const current = {...report, description: 'Inundación: Agua en la vía.'};
  assert.equal(duplicate(current, [{...report, description: 'Ruido excesivo: Música muy alta.'}]), undefined);
  assert.equal(duplicate(report, [{...report, description: 'Un tubo roto afecta la acera.'}]), undefined);
  const sameLegacy = {...report, description: '  UN ÁRBOL CAÍDO   BLOQUEA EL PASO. '};
  assert.equal(duplicate(report, [sameLegacy]), sameLegacy);
});

test('una frase larga con dos puntos no se trata como nombre corto de tipo', () => {
  const description = `${'x'.repeat(61)}: detalle posterior`;
  assert.equal(reportDuplicateIdentity(description), description);
});
