// Distances are metres on a spherical Earth. GPS is projected onto the selected
// provider geometry; this module never substitutes or calculates another route.
const EARTH_RADIUS = 6371000;
const radians = value => value * Math.PI / 180;
const degrees = value => value * 180 / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapRadians = value => Math.atan2(Math.sin(value), Math.cos(value));

function validPoint(point) {
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}

function angle(a, b) {
  const latA = radians(a.lat), latB = radians(b.lat);
  const dLat = latB - latA, dLon = wrapRadians(radians(b.lon - a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(clamp(h, 0, 1)), Math.sqrt(clamp(1 - h, 0, 1)));
}

function bearing(a, b) {
  const latA = radians(a.lat), latB = radians(b.lat);
  const dLon = wrapRadians(radians(b.lon - a.lon));
  return Math.atan2(Math.sin(dLon) * Math.cos(latB),
    Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(dLon));
}

function interpolate(a, b, fraction, segmentAngle) {
  if (fraction <= 0) return {...a};
  if (fraction >= 1) return {...b};
  const wa = Math.sin((1 - fraction) * segmentAngle) / Math.sin(segmentAngle);
  const wb = Math.sin(fraction * segmentAngle) / Math.sin(segmentAngle);
  const latA = radians(a.lat), latB = radians(b.lat);
  const lonA = radians(a.lon), lonB = radians(b.lon);
  const x = wa * Math.cos(latA) * Math.cos(lonA) + wb * Math.cos(latB) * Math.cos(lonB);
  const y = wa * Math.cos(latA) * Math.sin(lonA) + wb * Math.cos(latB) * Math.sin(lonB);
  const z = wa * Math.sin(latA) + wb * Math.sin(latB);
  return {lat: degrees(Math.atan2(z, Math.hypot(x, y))), lon: degrees(Math.atan2(y, x))};
}

function geometry(route) {
  if (!route || !Array.isArray(route.points) || route.points.length < 2) return null;
  const points = route.points.map(point => ({lat: point?.latitude, lon: point?.longitude}));
  if (points.some(point => !validPoint(point))) return null;
  const cumulative = [0], segments = [];
  let signature = 2166136261;
  for (const point of points) {
    // Include the full geometry so an old progress object cannot affect a new
    // calculation that reuses the same route id and origin/destination.
    for (const character of `${point.lat},${point.lon};`) {
      signature ^= character.charCodeAt(0);
      signature = Math.imul(signature, 16777619);
    }
  }
  for (let index = 1; index < points.length; index++) {
    const segmentAngle = angle(points[index - 1], points[index]);
    // An antipodal segment has no unique nearest great-circle path.
    if (segmentAngle >= Math.PI - 1e-10) return null;
    const length = segmentAngle * EARTH_RADIUS;
    if (length > 0) segments.push({index: index - 1, a: points[index - 1], b: points[index], angle: segmentAngle, length, start: cumulative[index - 1]});
    cumulative.push(cumulative[index - 1] + length);
  }
  const totalDistance = cumulative.at(-1);
  if (!(totalDistance > 0)) return null;
  return {points, cumulative, segments, totalDistance, routeKey: `${route.id || ''}:${signature >>> 0}`};
}

function nearestProjection(shape, position, previous) {
  let nearest;
  for (const segment of shape.segments) {
    const angleToPosition = angle(segment.a, position);
    const alongAngle = Math.atan2(Math.sin(angleToPosition)
      * Math.cos(bearing(segment.a, position) - bearing(segment.a, segment.b)), Math.cos(angleToPosition));
    const fraction = clamp(alongAngle / segment.angle, 0, 1);
    const projectedPosition = interpolate(segment.a, segment.b, fraction, segment.angle);
    const distanceFromRoute = angle(position, projectedPosition) * EARTH_RADIUS;
    const distanceAlong = segment.start + segment.length * fraction;
    const candidate = {projectedPosition, distanceFromRoute, distanceAlong, segmentIndex: segment.index};
    // At a crossing, prefer the segment nearest the previous progress rather
    // than jumping to a much later visit to the same intersection.
    const tie = nearest && Math.abs(distanceFromRoute - nearest.distanceFromRoute) <= 1;
    const previousDistance = previous?.distanceAlong ?? 0;
    if (!nearest || distanceFromRoute < nearest.distanceFromRoute - 1
      || (tie && Math.abs(distanceAlong - previousDistance) < Math.abs(nearest.distanceAlong - previousDistance))) nearest = candidate;
  }
  return nearest;
}

function instructionsAt(route, shape, distanceAlong) {
  const indexed = (Array.isArray(route.instructions) ? route.instructions : []).flatMap((step, index) => {
    const {fromIndex, toIndex} = step || {};
    if (typeof step?.text !== 'string' || !step.text.trim()
      || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
      || fromIndex < 0 || fromIndex > toIndex || toIndex >= shape.points.length) return [];
    return [{step, index, start: shape.cumulative[fromIndex], end: shape.cumulative[toIndex]}];
  }).sort((a, b) => a.start - b.start || a.index - b.index);
  // Turn text applies at fromIndex, not at the end of its following road. Keep
  // a turn for 10m after its location, then show the next provider maneuver.
  const upcoming = indexed.find(item => item.start >= distanceAlong - 10);
  const current = indexed.filter(item => item.start <= distanceAlong + 1 && item.end >= distanceAlong - 10).at(-1);
  return {
    instruction: upcoming?.step || null,
    instructionIndex: upcoming?.index ?? -1,
    distanceToInstruction: upcoming ? Math.max(0, upcoming.start - distanceAlong) : null,
    currentInstruction: current?.step || null,
    currentInstructionIndex: current?.index ?? -1,
  };
}

/**
 * Project a GPS fix onto the selected route and estimate its remaining journey.
 * Returns null for invalid coordinates/geometry. Missing or malformed GPS
 * accuracy is unreliable and cannot establish departure from route or arrival.
 * Provider seconds are scaled by the remaining geometry ratio, not live traffic.
 */
export function routeProgress(route, position, previousProgress) {
  if (!validPoint(position)) return null;
  const shape = geometry(route);
  if (!shape) return null;
  const previous = previousProgress?.routeKey === shape.routeKey
    && Number.isFinite(previousProgress.distanceAlong) ? previousProgress : null;
  const projection = nearestProjection(shape, position, previous);
  if (!projection) return null;
  const suppliedAccuracy = position.accuracy;
  const positionAccuracy = Number.isFinite(suppliedAccuracy) && suppliedAccuracy >= 0 ? suppliedAccuracy : null;
  const accuratePosition = positionAccuracy !== null && positionAccuracy <= 75;
  const offRoute = accuratePosition && projection.distanceFromRoute > Math.max(50, positionAccuracy * 2);
  let distanceAlong = projection.distanceAlong;
  // Hold only small backwards GPS jitter. Larger retreats are real backtracking
  // and must update the remaining distance and upcoming maneuver.
  if (previous && accuratePosition && !offRoute && distanceAlong < previous.distanceAlong
    && previous.distanceAlong - distanceAlong <= 20) distanceAlong = previous.distanceAlong;
  distanceAlong = clamp(distanceAlong, 0, shape.totalDistance);
  const remainingDistance = shape.totalDistance - distanceAlong;
  const distanceToDestination = angle(position, shape.points.at(-1)) * EARTH_RADIUS;
  const arrived = accuratePosition && positionAccuracy <= 25 && distanceToDestination <= 25
    && remainingDistance <= 30;
  return {
    routeKey: shape.routeKey,
    totalDistance: shape.totalDistance,
    distanceAlong,
    remainingDistance,
    remainingSeconds: Number.isFinite(route.seconds) && route.seconds >= 0
      ? route.seconds * remainingDistance / shape.totalDistance : null,
    distanceFromRoute: projection.distanceFromRoute,
    offRoute,
    arrived,
    positionAccuracy,
    accuratePosition,
    projectedPosition: projection.projectedPosition,
    segmentIndex: projection.segmentIndex,
    ...instructionsAt(route, shape, distanceAlong),
  };
}
