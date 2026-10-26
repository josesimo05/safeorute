import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const tile = await readFile(new URL('../../public/icon-192.png', import.meta.url));

async function mockGeoapify(context) {
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
      if (url.pathname === '/v1/geocode/search') {
        const origin = url.searchParams.get('text').includes('Independencia');
        body = {results: [{
          place_id: origin ? 'origin' : 'destination',
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
          geometry: {type: 'MultiLineString', coordinates: [[[-69.943, 18.476], short ? [-69.942, 18.48] : [-69.95, 18.48], [-69.94, 18.49]]]},
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

test('Geoapify busca direcciones, calcula dos rutas y carga lugares cercanos', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  await expect(page.locator('.nav-note')).toContainText('Sin tráfico en tiempo real');
  await expect(page.getByLabel('Hora de salida')).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Origen', exact: true}).fill('Parque Independencia');
  await page.getByRole('button', {name: 'Buscar origen', exact: true}).click();
  await page.getByRole('option', {name: 'Parque Independencia, Santo Domingo', exact: true}).click();
  await page.getByRole('textbox', {name: 'Destino', exact: true}).fill('Ágora Mall');
  await page.getByRole('button', {name: 'Buscar destino', exact: true}).click();
  await page.getByRole('option', {name: 'Ágora Mall, Santo Domingo', exact: true}).click();
  await page.getByRole('button', {name: 'Buscar rutas', exact: true}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('.route-card').first()).toContainText('Recomendada');
  await expect(page.locator('.route-card').nth(1)).toContainText('Más corta');
  await expect(page.locator('.poi-pin')).toHaveCount(4);
  expect(calls.preferences.sort()).toEqual(['balanced', 'short']);
  expect(calls.categories.sort()).toEqual(['commercial.supermarket', 'healthcare.hospital', 'healthcare.pharmacy', 'service.vehicle.fuel']);
  expect(calls.otherMaps).toEqual([]);
  await page.locator('.route-card').nth(1).click();
  await expect(page.locator('.route-card.selected')).toContainText('Más corta');
});

test('el mapa usa Geoapify en claro y oscuro con la atribución del proveedor', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-map-provider', 'geoapify');
  await expect.poll(() => calls.styles.includes('osm-carto')).toBe(true);
  await expect(page.locator('.leaflet-control-attribution').getByRole('link', {name: '© Geoapify', exact: true})).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution').getByRole('link', {name: '© OpenMapTiles', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Cambiar a tema oscuro', exact: true}).click();
  await expect.poll(() => calls.styles.includes('dark-matter')).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.leaflet-tile-pane').evaluate(node => getComputedStyle(node).filter)).toBe('none');
  expect(calls.otherMaps).toEqual([]);
});
