const API_ORIGIN = 'https://api.geoapify.com';
const REQUEST_TIMEOUT_MS = 15000;
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_SEARCH_BIAS = {lat: 18.48, lon: -69.94};
const DOMINICAN_REPUBLIC_BOUNDS = 'rect:-72.1,17.4,-68.2,20.1';
const NAMED_PLACE_CATEGORIES = [
  'accommodation', 'activity', 'airport', 'amenity', 'beach', 'building', 'camping',
  'catering', 'commercial', 'education', 'childcare', 'entertainment', 'healthcare',
  'heritage', 'leisure', 'maritime', 'memorial', 'national_park', 'office', 'parking',
  'pet', 'production', 'public_transport', 'religion', 'rental', 'service', 'sport', 'tourism',
].join(',');

const PLACE_TYPES = [
  {category: 'service.vehicle.fuel', icon: '⛽', type: 'Gasolineras'},
  {category: 'healthcare.pharmacy', icon: '✚', type: 'Farmacias'},
  {category: 'commercial.supermarket', icon: '🛒', type: 'Supermercados'},
  {category: 'healthcare.hospital', icon: '🏥', type: 'Hospitales'},
];

function validPoint(point) {
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}

function coordinatePoint(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const point = {lat: coordinate[1], lon: coordinate[0]};
  return validPoint(point) ? point : null;
}

function samePoint(a, b) {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

function routePoints(geometry) {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates]
    : geometry?.type === 'MultiLineString' ? geometry.coordinates : null;
  if (!Array.isArray(lines) || !lines.length) return null;
  const points = [];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) return null;
    const segment = line.map(coordinatePoint);
    // Reject malformed segments instead of drawing a shortcut across missing data.
    if (segment.some(point => !point)) return null;
    const normalized = segment.map(point => ({latitude: point.lat, longitude: point.lon}));
    if (points.length && !samePoint(points.at(-1), normalized[0])) return null;
    for (const point of normalized) {
      if (!points.length || !samePoint(points.at(-1), point)) points.push(point);
    }
  }
  return points.length > 1 ? points : null;
}

function addressText(properties) {
  return typeof properties.formatted === 'string' ? properties.formatted
    : [properties.address_line1, properties.address_line2].filter(value => typeof value === 'string' && value).join(', ');
}

function normalizedQuery(query) {
  return typeof query === 'string' ? query.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 1024) : '';
}

function searchKey(value) {
  return normalizedQuery(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
}

function normalizedCountry(country = 'do') {
  const code = typeof country === 'string' ? country.trim().toLowerCase() : '';
  return /^[a-z]{2}$/.test(code) ? code : '';
}

function normalizedLanguage(language) {
  const code = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : '';
  return /^[a-z]{2}$/.test(code) ? code : 'es';
}

// Routing supports fewer languages than Geocoding/Places. Keep unsupported UI
// languages usable by requesting English directions rather than triggering 400.
const ROUTING_LANGUAGES = new Set(['bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hi', 'hu', 'it', 'ja', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk']);
function routingLanguage(language) {
  const code = normalizedLanguage(language);
  return ROUTING_LANGUAGES.has(code) ? code : 'en';
}

function normalizeAddress(properties, source = 'address', geometry, country = 'do') {
  if (!properties || (country && typeof properties.country_code === 'string'
    && properties.country_code.toLowerCase() !== country)) return null;
  const position = validPoint(properties) ? {lat: properties.lat, lon: properties.lon}
    : geometry?.type === 'Point' ? coordinatePoint(geometry.coordinates) : null;
  if (!position) return null;
  const name = normalizedQuery(properties.name);
  const address = normalizedQuery(addressText(properties));
  const label = name && !searchKey(address).includes(searchKey(name)) ? [name, address].filter(Boolean).join(', ') : address || name;
  if (!label) return null;
  return {
    id: properties.place_id || `address-${position.lat}-${position.lon}-${searchKey(name || label)}`,
    position,
    address: {freeformAddress: label},
    type: source === 'poi' || properties.result_type === 'amenity' ? 'poi' : 'address',
    ...(name ? {name} : {}),
  };
}

function uniqueAddresses(addresses) {
  const ids = new Set();
  const positions = new Set();
  return addresses.filter(place => {
    const signature = `${place.position.lat.toFixed(5)},${place.position.lon.toFixed(5)}:${searchKey(place.name || place.address.freeformAddress)}`;
    if (ids.has(place.id) || positions.has(signature)) return false;
    ids.add(place.id);
    positions.add(signature);
    return true;
  }).slice(0, 5);
}

function cancelledSearch() {
  return new DOMException('La búsqueda fue cancelada.', 'AbortError');
}

function normalizeRoute(feature, preference, index) {
  const points = routePoints(feature?.geometry);
  const properties = feature?.properties;
  if (!points || !properties || !Number.isFinite(properties.time) || properties.time < 0
    || !Number.isFinite(properties.distance) || properties.distance < 0) return null;
  const instructions = (Array.isArray(properties.legs) ? properties.legs : []).flatMap(leg =>
    (Array.isArray(leg?.steps) ? leg.steps : []).flatMap(step => {
      const text = step?.instruction?.text;
      return typeof text === 'string' && text.trim() ? [{text, distance: step.distance, seconds: step.time}] : [];
    }));
  return {
    id: index ? `${preference}-${index}` : preference,
    name: preference === 'short' ? 'Más corta' : 'Recomendada',
    points,
    seconds: properties.time,
    distance: properties.distance,
    instructions,
  };
}

function serviceError(status, action) {
  if (status === 401 || status === 403) {
    return new Error('Geoapify no autorizó la solicitud. Revisa la clave y los dominios permitidos del proyecto.');
  }
  if (status === 429) return new Error('Se alcanzó el límite de Geoapify. Espera un momento y vuelve a intentar.');
  if (status >= 500) return new Error('Geoapify no está disponible en este momento. Vuelve a intentar.');
  return new Error(`No se pudo ${action}. Revisa los datos y vuelve a intentar.`);
}

export function createGeoapifyClient({apiKey, fetchImpl = globalThis.fetch} = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const hasRouting = Boolean(key);

  async function request(path, parameters, action, signal) {
    if (signal?.aborted) throw cancelledSearch();
    if (!key) throw new Error('Configura VITE_GEOAPIFY_API_KEY en .env.local para activar los mapas y las rutas.');
    const url = new URL(path, API_ORIGIN);
    url.search = new URLSearchParams({...parameters, apiKey: key});
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    const timeout = setTimeout(cancel, REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetchImpl(url, {signal: controller.signal});
      } catch {
        if (signal?.aborted) throw cancelledSearch();
        throw new Error(controller.signal.aborted
          ? 'Geoapify tardó demasiado en responder. Vuelve a intentar.'
          : 'No se pudo conectar con Geoapify. Revisa tu conexión y vuelve a intentar.');
      }
      if (signal?.aborted) throw cancelledSearch();
      if (!response.ok) throw serviceError(response.status, action);
      try {
        const body = await response.json();
        if (signal?.aborted) throw cancelledSearch();
        return body;
      } catch {
        if (signal?.aborted) throw cancelledSearch();
        throw new Error('Geoapify devolvió una respuesta que no se pudo leer. Vuelve a intentar.');
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function requirePoint(point) {
    if (!validPoint(point)) throw new Error('Selecciona un punto válido en el mapa.');
  }

  function searchParameters(query, {bias, country, language}) {
    const point = validPoint(bias) ? bias : DEFAULT_SEARCH_BIAS;
    const code = normalizedCountry(country);
    return {
      text: query, format: 'json', limit: '5', ...(code ? {filter: `countrycode:${code}`} : {}),
      lang: normalizedLanguage(language),
      bias: `proximity:${point.lon},${point.lat}`,
    };
  }

  async function addressSearch(path, query, options = {}) {
    const body = await request(path, searchParameters(query, options), 'buscar la dirección', options.signal);
    if (!Array.isArray(body?.results)) throw new Error('Geoapify devolvió una búsqueda no válida. Vuelve a intentar.');
    return uniqueAddresses(body.results.map(result => normalizeAddress(result, 'address', null, normalizedCountry(options.country))).filter(Boolean));
  }

  async function namedPlaceSearch(name, {signal, bias, country, language} = {}, candidate) {
    const code = normalizedCountry(country);
    const point = validPoint(candidate?.position) ? candidate.position
      : validPoint(bias) ? bias : DEFAULT_SEARCH_BIAS;
    // Places requires a spatial filter, and its live API does not support countrycode filters.
    // Search around the canonical result so a foreign POI is never clipped to Dominican bounds.
    const filter = !candidate && code === 'do' ? DOMINICAN_REPUBLIC_BOUNDS
      : `circle:${point.lon},${point.lat},100000`;
    const body = await request('/v2/places', {
      name, categories: NAMED_PLACE_CATEGORIES, filter,
      bias: `proximity:${point.lon},${point.lat}`, limit: '5', lang: normalizedLanguage(language),
    }, 'buscar el lugar', signal);
    if (!Array.isArray(body?.features)) throw new Error('Geoapify devolvió lugares no válidos. Vuelve a intentar.');
    return body.features.map(feature => normalizeAddress(feature?.properties, 'poi', feature?.geometry, code)).filter(Boolean);
  }

  async function suggestPlaces(query, options = {}) {
    const text = normalizedQuery(query);
    if (text.length < 3) return [];
    const addresses = await addressSearch('/v1/geocode/autocomplete', text, options);
    // Autocomplete also returns named streets/postcodes. Resolve a canonical name to a real POI
    // when possible; the Places name filter requires accents and the complete name.
    const candidate = addresses.find(place => place.name);
    if (candidate?.type === 'poi' || (addresses.length && !candidate)) return addresses;
    const places = await namedPlaceSearch(candidate?.name || text, options, candidate);
    return uniqueAddresses([...places, ...addresses]);
  }

  async function geocode(query, options = {}) {
    const text = normalizedQuery(query);
    if (!text) return [];
    const results = await Promise.allSettled([
      suggestPlaces(text, options),
      addressSearch('/v1/geocode/search', text, options),
    ]);
    if (options.signal?.aborted) throw cancelledSearch();
    const addresses = uniqueAddresses(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
    if (!addresses.length) {
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    return addresses;
  }

  async function getRoutes(from, to, {language} = {}) {
    requirePoint(from);
    requirePoint(to);
    const preferences = ['balanced', 'short'];
    // Geoapify offers routing preferences, without an alternatives/departure API.
    const results = await Promise.allSettled(preferences.map(async preference => {
      const body = await request('/v1/routing', {
        waypoints: `${from.lat},${from.lon}|${to.lat},${to.lon}`,
        mode: 'drive', type: preference, units: 'metric', lang: routingLanguage(language),
        format: 'geojson', traffic: 'free_flow', details: 'instruction_details',
      }, 'calcular la ruta');
      if (!Array.isArray(body?.features)) throw new Error('Geoapify devolvió una ruta no válida. Vuelve a intentar.');
      return body.features.map((feature, index) => normalizeRoute(feature, preference, index)).filter(Boolean);
    }));
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    const seen = new Set();
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(route => {
      const signature = JSON.stringify(route.points);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  async function nearbyPlaces(point, {language} = {}) {
    requirePoint(point);
    const results = await Promise.allSettled(PLACE_TYPES.map(async ({category, type, icon}) => {
      const body = await request('/v2/places', {
        categories: category, filter: `circle:${point.lon},${point.lat},5000`,
        bias: `proximity:${point.lon},${point.lat}`, limit: '8', lang: normalizedLanguage(language),
      }, 'buscar los lugares cercanos');
      if (!Array.isArray(body?.features)) throw new Error('Geoapify devolvió lugares no válidos. Vuelve a intentar.');
      return body.features.flatMap((feature, index) => {
        const properties = feature?.properties || {};
        const position = validPoint(properties) ? properties
          : feature?.geometry?.type === 'Point' ? coordinatePoint(feature.geometry.coordinates) : null;
        if (!position) return [];
        return [{
          id: properties.place_id || `${category}-${position.lat}-${position.lon}-${index}`,
          name: properties.name || type,
          type, icon, lat: position.lat, lon: position.lon, address: addressText(properties),
        }];
      });
    }));
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    const seen = new Set();
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(place => {
      if (seen.has(place.id)) return false;
      seen.add(place.id);
      return true;
    });
  }

  function tileUrl(theme) {
    if (!key) return OSM_TILES;
    const style = theme === 'dark' ? 'dark-matter-yellow-roads' : 'osm-carto';
    return `https://maps.geoapify.com/v1/tile/${style}/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(key)}`;
  }

  return {hasRouting, geocode, suggestPlaces, getRoutes, nearbyPlaces, tileUrl};
}
