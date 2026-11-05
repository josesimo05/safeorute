import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedRouteReports, distance, reportsNearRoute, routeReportCount} from '../src/logic.js';

const route = {points:[{latitude:18.47, longitude:-69.94}, {latitude:18.48, longitude:-69.94}]};
const report = (id, patch = {}) => ({id, lat:18.475, lng:-69.9405, status:'approved', category:'Bache', description:'Bache junto al carril derecho.', ...patch});

test('el corredor incluye segmentos y extremos próximos y excluye incidentes lejanos', () => {
  const middle = report('middle');
  const endpoint = report('endpoint', {lat:18.4695, lng:-69.94});
  const far = report('far', {lng:-69.95});
  assert.deepEqual(reportsNearRoute(route, [middle, endpoint, far]), [middle, endpoint]);
  assert.equal(routeReportCount(route, [middle, endpoint, far]), 2);
});

test('solo los publicados entran al conjunto aprobado, sin tomar filtros de exploración', () => {
  const published = report('published', {category:'Otro'});
  const pending = report('pending', {status:'pending'});
  const rejected = report('rejected', {status:'rejected'});
  const unspecified = report('unspecified', {status:undefined});
  const rows = [published, pending, rejected, unspecified];
  assert.deepEqual(approvedRouteReports(route, rows), [published]);
  // The geometry helper remains reusable independently of publication policy.
  assert.equal(reportsNearRoute(route, rows).length, 4);
});

test('una aprobación en el flujo compartido aparece en una ruta ya calculada', () => {
  const pending = report('shared-new', {status:'pending'});
  assert.deepEqual(approvedRouteReports(route, [pending]), []);
  const approved = {...pending, status:'approved'};
  const beforeRoute = structuredClone(route);
  assert.deepEqual(approvedRouteReports(route, [approved]), [approved]);
  assert.deepEqual(route, beforeRoute);
});

test('el límite del corredor utiliza metros e incluye el borde sin ampliar el radio', () => {
  const edge = report('edge');
  const meters = distance(edge, {lat:edge.lat, lng:-69.94});
  assert.deepEqual(reportsNearRoute(route, [edge], meters), [edge]);
  assert.deepEqual(reportsNearRoute(route, [edge], meters - .01), []);
});

test('rutas degeneradas y una coordenada única se manejan sin dividir por cero', () => {
  const point = {latitude:18.475, longitude:-69.94};
  const exact = report('exact', {lng:-69.94});
  assert.deepEqual(reportsNearRoute({points:[point, point]}, [exact], 0), [exact]);
  assert.deepEqual(reportsNearRoute({points:[point]}, [exact], 0), [exact]);
});

test('datos inválidos no crean proximidad ni unen segmentos a través de puntos inválidos', () => {
  const valid = report('valid');
  for (const input of [null, {}, {points:[]}, {points:'not-a-route'}, {points:[{latitude:91, longitude:0}]}]) {
    assert.deepEqual(reportsNearRoute(input, [valid]), []);
  }
  assert.deepEqual(reportsNearRoute({points:[route.points[0], null, route.points[1]]}, [valid]), []);
  assert.deepEqual(reportsNearRoute(route, null), []);
  assert.deepEqual(reportsNearRoute(route, [report('bad', {lat:NaN}), report('bad2', {lng:181})]), []);
  for (const radius of [-1, NaN, Infinity, '150']) assert.deepEqual(reportsNearRoute(route, [valid], radius), []);
});

test('el cálculo conserva referencias, orden y datos de entrada', () => {
  const rows = [report('first'), report('second', {lat:18.476})];
  const original = structuredClone({route, rows});
  const nearby = approvedRouteReports(route, rows);
  assert.equal(nearby[0], rows[0]);
  assert.equal(nearby[1], rows[1]);
  assert.deepEqual({route, rows}, original);
});
