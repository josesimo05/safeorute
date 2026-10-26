import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Reuse a local image for tile responses; never fetch or bulk-download real maps.
const tile = await readFile(new URL('../../public/icon-192.png', import.meta.url));

test('mantiene el aviso con tiles fallidos y recupera el mapa al reintentar', async ({page, context}) => {
  let fail = true;
  let requests = 0;
  await context.route(/https:\/\/.*/, async route => {
    if (/https:\/\/maps\.geoapify\.com\/v1\/tile\//.test(route.request().url())) {
      requests++;
      if (fail && requests % 2) await route.abort('failed');
      else await route.fulfill({contentType: 'image/png', body: tile});
    } else await route.abort();
  });
  await page.goto('/');
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('img.leaflet-tile')];
    return images.some(image => image.complete && image.naturalWidth > 0)
      && images.some(image => image.complete && image.naturalWidth === 0)
      && images.every(image => image.complete);
  });
  await expect(page.locator('.map-offline')).toBeVisible();
  const previous = requests;
  fail = false;
  await page.getByRole('button', {name: 'Reintentar mapa', exact: true}).click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('img.leaflet-tile')];
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  await expect(page.locator('.map-offline')).toHaveCount(0);
  expect(requests).toBeGreaterThan(previous);
});

test('recarga tiles al volver la conexión y conserva el reporte abierto', async ({page, context}) => {
  let fail = true;
  let requests = 0;
  await context.route(/https:\/\/.*/, async route => {
    if (/https:\/\/maps\.geoapify\.com\/v1\/tile\//.test(route.request().url())) {
      requests++;
      if (fail) await route.abort('internetdisconnected');
      else await route.fulfill({contentType: 'image/png', body: tile});
    } else await route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.map-offline')).toBeVisible();
  await page.locator('.map').click({position: {x: 170, y: 150}});
  const detail = page.getByLabel('Detalle opcional');
  await detail.fill('El reporte debe conservarse después de recuperar la conexión.');
  await context.setOffline(true);
  await expect(page.locator('.mode')).toContainText('Sin conexión');
  await expect(page.getByRole('button', {name: 'Reintentar mapa', exact: true})).toBeDisabled();
  const previous = requests;
  fail = false;
  await context.setOffline(false);
  await expect(page.locator('.mode')).toContainText('Con conexión');
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('img.leaflet-tile')];
    return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  await expect(page.locator('.map-offline')).toHaveCount(0);
  await expect(detail).toHaveValue('El reporte debe conservarse después de recuperar la conexión.');
  expect(requests).toBeGreaterThan(previous);
});
