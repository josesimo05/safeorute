import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeProgress} from '../src/route-progress.js';

const route = {
  id: 'balanced', seconds: 400,
  points: [
    {latitude: 0, longitude: 0},
    {latitude: 0, longitude: .001},
    {latitude: 0, longitude: .002},
    {latitude: .001, longitude: .002},
    {latitude: .002, longitude: .002},
  ],
  instructions: [
    {text: 'Head east.', fromIndex: 0, toIndex: 2},
    {text: 'Turn left.', fromIndex: 2, toIndex: 4},
    {text: 'Arrive at your destination.', fromIndex: 4, toIndex: 4},
  ],
};

test('GPS progress follows the selected geometry and estimates remaining distance/time', () => {
  const result = routeProgress(route, {lat: 0, lon: .001, accuracy: 5});
  assert.ok(Math.abs(result.totalDistance - 444.78) < .1);
  assert.ok(Math.abs(result.distanceAlong - 111.195) < .1);
  assert.ok(Math.abs(result.remainingDistance - 333.585) < .1);
  assert.ok(Math.abs(result.remainingSeconds - 300) < .1);
  assert.ok(result.distanceFromRoute < .01);
  assert.equal(result.offRoute, false);
  assert.equal(result.arrived, false);
  assert.equal(result.accuratePosition, true);
});

test('upcoming text is located at its start index, never the end of the following road', () => {
  const start = routeProgress(route, {lat: 0, lon: 0});
  assert.equal(start.instructionIndex, 0);
  assert.equal(start.distanceToInstruction, 0);
  const halfway = routeProgress(route, {lat: 0, lon: .001});
  assert.equal(halfway.instruction.text, 'Turn left.');
  assert.equal(halfway.instructionIndex, 1);
  assert.ok(Math.abs(halfway.distanceToInstruction - 111.195) < .1);
  assert.equal(halfway.currentInstruction.text, 'Head east.');
  const turning = routeProgress(route, {lat: 0, lon: .002});
  assert.equal(turning.instructionIndex, 1);
  assert.ok(turning.distanceToInstruction < .01);
  const afterTurn = routeProgress(route, {lat: .0003, lon: .002});
  assert.equal(afterTurn.instructionIndex, 2);
  assert.equal(afterTurn.instruction.text, 'Arrive at your destination.');
});

test('off-route is measured from the polyline and poor accuracy cannot declare departure or arrival', () => {
  const away = routeProgress(route, {lat: -.002, lon: .001, accuracy: 5});
  assert.ok(away.distanceFromRoute > 220);
  assert.equal(away.offRoute, true);
  assert.equal(away.arrived, false);
  const uncertain = routeProgress(route, {lat: -.002, lon: .001, accuracy: 300});
  assert.equal(uncertain.accuratePosition, false);
  assert.equal(uncertain.offRoute, false);
  const atEnd = {lat: .002, lon: .002};
  assert.equal(routeProgress(route, {...atEnd, accuracy: 5}).arrived, true);
  for (const accuracy of [undefined, null, 30, 1000, NaN, -1]) {
    assert.equal(routeProgress(route, {...atEnd, accuracy}).arrived, false);
  }
  const noAccuracy = routeProgress(route, {lat: -.002, lon: .001});
  assert.equal(noAccuracy.positionAccuracy, null);
  assert.equal(noAccuracy.accuratePosition, false);
  assert.equal(noAccuracy.offRoute, false);
  assert.ok(noAccuracy.remainingDistance > 0);
});

test('being near the destination early on a loop is not arrival', () => {
  const loop = {...route, points: [
    {latitude: 0, longitude: 0}, {latitude: 0, longitude: .01},
    {latitude: .01, longitude: .01}, {latitude: .01, longitude: 0},
    {latitude: 0, longitude: 0},
  ]};
  const start = routeProgress(loop, {lat: 0, lon: 0, accuracy: 3});
  assert.equal(start.distanceAlong, 0);
  assert.equal(start.arrived, false);
  const almostThere = routeProgress(loop, {lat: .0002, lon: 0, accuracy: 3});
  const end = routeProgress(loop, {lat: 0, lon: 0, accuracy: 3}, almostThere);
  assert.equal(end.arrived, true);
});

test('a route without indexed steps gives geometry progress without invented directions', () => {
  const unindexed = {...route, instructions: [
    {text: 'Text only.'}, {text: 'Bad indices.', fromIndex: -1, toIndex: 999},
    {text: 'Null indices.', fromIndex: null, toIndex: null},
  ]};
  const result = routeProgress(unindexed, {lat: 0, lon: .001});
  assert.ok(result.remainingDistance > 0);
  assert.equal(result.instruction, null);
  assert.equal(result.instructionIndex, -1);
  assert.equal(result.distanceToInstruction, null);
  assert.equal(routeProgress({...route, instructions: []}, {lat: 0, lon: .001}).instruction, null);
});

test('small GPS jitter is held while genuine backtracking and new geometry reset progress', () => {
  const initial = routeProgress(route, {lat: 0, lon: .0015, accuracy: 5});
  const jitter = routeProgress(route, {lat: 0, lon: .0014, accuracy: 5}, initial);
  assert.equal(jitter.distanceAlong, initial.distanceAlong);
  const backwards = routeProgress(route, {lat: 0, lon: .001, accuracy: 5}, jitter);
  assert.ok(backwards.distanceAlong < jitter.distanceAlong - 50);
  const replacement = {...route, points: route.points.map(point => ({...point, latitude: point.latitude + .001}))};
  const different = routeProgress(replacement, {lat: .001, lon: .0014, accuracy: 5}, initial);
  assert.notEqual(different.routeKey, initial.routeKey);
  assert.ok(different.distanceAlong < initial.distanceAlong);
});

test('projection crosses the antimeridian along the short arc', () => {
  const crossing = {seconds: 200, points: [{latitude: 0, longitude: 179.9}, {latitude: 0, longitude: -179.9}]};
  const result = routeProgress(crossing, {lat: 0, lon: 180, accuracy: 3});
  assert.ok(Math.abs(result.totalDistance - 22239) < 5);
  assert.ok(Math.abs(result.distanceAlong / result.totalDistance - .5) < .00001);
  assert.ok(result.distanceFromRoute < .01);
  assert.equal(result.offRoute, false);
});

test('invalid fixes and unusable route geometry fail safely', () => {
  for (const position of [null, {}, {lat: NaN, lon: 0}, {lat: 91, lon: 0}, {lat: 0, lon: -181}]) {
    assert.equal(routeProgress(route, position), null);
  }
  for (const invalid of [null, {}, {points: []}, {points: [route.points[0]]},
    {points: [route.points[0], {latitude: 100, longitude: 0}]},
    {points: [route.points[0], route.points[0]]},
    {points: [{latitude: 0, longitude: 0}, {latitude: 0, longitude: 180}]},
  ]) assert.equal(routeProgress(invalid, {lat: 0, lon: 0}), null);
  const unknownTime = routeProgress({...route, seconds: NaN}, {lat: 0, lon: .001});
  assert.equal(unknownTime.remainingSeconds, null);
});
