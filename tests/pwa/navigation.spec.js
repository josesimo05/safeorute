import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

test('Geoapify busca direcciones, calcula dos rutas y carga lugares cercanos', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  await expect(page.locator('.nav-note')).toContainText('Sin tráfico en tiempo real');
  await expect(page.getByLabel('Hora de salida')).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Origen', exact: true}).fill('Parque Independencia');
  await expect(page.getByRole('option').filter({hasText: 'Parque Independencia'})).toBeVisible();
  await page.getByRole('combobox', {name: 'Origen', exact: true}).press('ArrowDown');
  await page.getByRole('combobox', {name: 'Origen', exact: true}).press('Enter');
  await expect(page.locator('.start-pin')).toHaveCount(1);
  await page.getByRole('combobox', {name: 'Destino', exact: true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText: 'Ágora Mall'}).click();
  await expect(page.locator('.end-pin')).toHaveCount(1);
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
  await expect(page.getByRole('button', {name: 'Iniciar navegación', exact: true})).toBeVisible();
  await expect(page.locator('a[href*="waze.com"], a[href*="maps.apple.com"], a[href*="google.com/maps"]')).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Destino', exact: true}).fill('Otro lugar');
  await expect(page.getByRole('button', {name: 'Iniciar navegación', exact: true})).toHaveCount(0);
});

test('el mapa usa Geoapify en claro y oscuro con la atribución del proveedor', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-map-provider', 'geoapify');
  await expect.poll(() => calls.styles.includes('osm-carto')).toBe(true);
  await expect(page.locator('.leaflet-control-attribution').getByRole('link', {name: '© Geoapify', exact: true})).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution').getByRole('link', {name: '© OpenMapTiles', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Cambiar a tema oscuro', exact: true}).click();
  await expect.poll(() => calls.styles.includes('dark-matter-yellow-roads')).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.leaflet-tile-pane').evaluate(node => getComputedStyle(node).filter)).toBe('none');
  expect(calls.otherMaps).toEqual([]);
});
