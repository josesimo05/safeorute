import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

test('busca por nombre, cambia el tema y prepara la navegación dentro de SafeRoute', async ({page, context}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-map-provider', 'geoapify');
  await page.getByRole('button', {name: 'Cambiar a tema oscuro', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => calls.styles.includes('dark-matter-yellow-roads')).toBe(true);
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  const origin = page.getByRole('combobox', {name: 'Origen', exact: true});
  await origin.fill('Parque Independencia');
  await expect(page.getByRole('option').filter({hasText: 'Parque Independencia'})).toBeVisible();
  await origin.press('ArrowDown');
  await origin.press('Enter');
  await expect(origin).toHaveValue('Parque Independencia, Santo Domingo');
  await expect(page.locator('.start-pin')).toHaveCount(1);
  await page.getByRole('combobox', {name: 'Destino', exact: true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText: 'Ágora Mall'}).click();
  await page.getByRole('button', {name: 'Buscar rutas', exact: true}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.getByRole('button', {name: 'Iniciar navegación', exact: true})).toBeVisible();
  await expect(page.locator('a[href*="waze.com"], a[href*="maps.apple.com"], a[href*="google.com/maps"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('el planificador móvil se pliega y conserva la selección sin desbordar', async ({page, context}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 390, height: 844});
  await mockGeoapify(context);
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  const origin = page.getByRole('combobox', {name: 'Origen', exact: true});
  await origin.fill('Parque Independencia');
  await page.getByRole('option').filter({hasText: 'Parque Independencia'}).click();
  const before = await page.locator('.map').boundingBox();
  await page.getByRole('button', {name: 'Ver mapa completo', exact: true}).click();
  await expect(page.locator('.panel-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(origin).toBeHidden();
  const after = await page.locator('.map').boundingBox();
  expect(after.height).toBeGreaterThan(before.height + 80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Mostrar planificador', exact: true}).click();
  await expect(origin).toHaveValue('Parque Independencia, Santo Domingo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('recarga la interfaz y conserva reportes locales sin conexión', async ({page, context}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockGeoapify(context);
  await page.goto('/');
  // Service workers are supported by all three tested engines on localhost.
  // A missing registration is a failure: each engine must prove offline reload.
  expect(await page.evaluate(() => 'serviceWorker' in navigator)).toBe(true);
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  await page.getByLabel('Detalle opcional').fill('Reporte local para verificar la interfaz sin conexión.');
  await page.getByRole('button', {name: 'Elegir en el mapa', exact: true}).click();
  await page.locator('.map').click({position: {x: 170, y: 150}});
  await page.getByRole('button', {name: 'Enviar a revisión', exact: true}).click();
  await expect(page.locator('.toast')).toContainText('Reporte enviado a revisión.');
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.getByText('Instalar y actualizar', {exact: true}).click();
  await expect(page.getByText('Sin conexión. Tus reportes locales', {exact: false})).toBeVisible();
  await page.getByRole('button', {name: 'Moderación', exact: true}).click();
  await expect(page.getByText('Reporte local para verificar la interfaz sin conexión.', {exact: true})).toBeVisible();
  expect(errors).toEqual([]);
});
