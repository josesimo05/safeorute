import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const tile = await readFile(new URL('../../public/icon-192.png', import.meta.url));

export async function mockGeoapify(context) {
  const calls = {styles: [], preferences: [], categories: [], otherMaps: []};
  await context.route(/https:\/\/.*/, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'maps.geoapify.com') {
      calls.styles.push(url.pathname.split('/')[3]);
      expect(url.searchParams.get('apiKey')).toBe('pwa-test-key');
      return route.fulfill({contentType: 'image/png', body: tile});
    }
    if (url.hostname === 'api.geoapify.com') {
      expect(url.searchParams.get('apiKey')).toBe('pwa-test-key');
      let body;
      if (['/v1/geocode/search', '/v1/geocode/autocomplete'].includes(url.pathname)) {
        const origin = url.searchParams.get('text').includes('Independencia');
        body = {results: [{
          place_id: origin ? 'origin' : 'destination', result_type: 'amenity', country_code: 'do',
          lat: origin ? 18.476 : 18.49, lon: origin ? -69.943 : -69.94,
          formatted: origin ? 'Parque Independencia, Santo Domingo' : 'Ágora Mall, Santo Domingo',
        }]};
      } else if (url.pathname === '/v1/routing') {
        const preference = url.searchParams.get('type');
        calls.preferences.push(preference);
        const short = preference === 'short';
        body = {type: 'FeatureCollection', features: [{
          type: 'Feature',
          properties: {time: short ? 700 : 600, distance: short ? 1400 : 1500, legs: []},
          geometry: {type: 'MultiLineString', coordinates: [[[-69.943, 18.476], short ? [-69.942, 18.48] : [-69.95, 18.48], [-69.9403, 18.4903]]]},
        }]};
      } else if (url.pathname === '/v2/places') {
        const category = url.searchParams.get('categories');
        calls.categories.push(category);
        body = {type: 'FeatureCollection', features: [{
          type: 'Feature', properties: {place_id: category, name: category, formatted: 'Santo Domingo'},
          geometry: {type: 'Point', coordinates: [-69.945, 18.48]},
        }]};
      } else throw new Error(`Unexpected Geoapify path: ${url.pathname}`);
      return route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
    }
    if (/tomtom|tile\.openstreetmap/.test(url.hostname)) calls.otherMaps.push(url.hostname);
    return route.abort();
  });
  return calls;
}

