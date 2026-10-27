import {test, expect} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

// External maps/fonts are optional; offline tests must exercise the real service worker.
test.beforeEach(async ({context}) => {
  await context.route(/https:\/\/.*/, route => route.abort());
});

async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByText('Instalar y actualizar', {exact: true}).click();
  await expect(page.getByText('Interfaz lista para abrir sin conexión.', {exact: false})).toBeVisible();
}

test('manifest e iconos cumplen los requisitos de instalación de Chromium', async ({playwright}, testInfo) => {
  // Chromium intentionally blocks installation in the default incognito contexts.
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('install-profile'), {
    headless: true,
    locale: 'es-DO',
    baseURL: 'http://127.0.0.1:4173',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  await context.route(/https:\/\/.*/, route => route.abort());
  const page = await context.newPage();
  try {
  await ready(page);
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    return (await fetch(link.href)).json();
  });
  expect(manifest).toMatchObject({id: '/', name: 'SafeRoute', display: 'standalone', scope: '/', start_url: '/'});
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(src => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`);
      image.onerror = reject;
      image.src = src;
    }), icon.src);
    expect(dimensions).toBe(icon.sizes);
  }
  expect(manifest.icons.some(icon => icon.purpose === 'maskable')).toBe(true);
  const cdp = await context.newCDPSession(page);
  const {installabilityErrors} = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('recarga sin conexión, conserva reportes locales y permite filtrar', async ({page, context}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.locator('.map').click({position: {x: 170, y: 150}});
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Detalle opcional').fill('Un incidente de prueba junto al parque comunitario.');
  await dialog.getByRole('button', {name: 'Enviar a revisión', exact: true}).click();
  await expect(page.locator('.toast')).toContainText('Reporte enviado a revisión.');
  await context.setOffline(true);
  await page.reload();
  await page.getByText('Instalar y actualizar', {exact: true}).click();
  await expect(page.getByText('Sin conexión. Tus reportes locales', {exact: false})).toBeVisible();
  await expect(page.locator('.report').first()).toBeVisible();
  await page.getByPlaceholder('Ej. luminaria, avenida…').fill('no existe este reporte');
  await expect(page.locator('.report')).toHaveCount(0);
  await page.getByRole('button', {name: 'Limpiar filtros', exact: true}).click();
  await page.getByRole('button', {name: 'Moderación', exact: true}).click();
  await expect(page.getByText('Un incidente de prueba junto al parque comunitario.', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Aprobar', exact: true}).click();
  await page.getByRole('button', {name: 'Explorar', exact: true}).click();
  await expect(page.getByText('Un incidente de prueba junto al parque comunitario.', {exact: true})).toBeVisible();
  expect(errors).toEqual([]);
  // API navigation must fail offline instead of silently returning the SPA HTML.
  const apiPage = await context.newPage();
  await expect(apiPage.goto('/api/analyze')).rejects.toThrow();
  await apiPage.close();
});

test('ofrece instrucciones de instalación en iPhone y respeta el ancho móvil', async ({browser}) => {
  const context = await browser.newContext({
    viewport: {width: 390, height: 844},
    locale: 'es-DO',
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await context.route(/https:\/\/.*/, route => route.abort());
  await context.addInitScript(() => window.addEventListener('beforeinstallprompt', event => event.stopImmediatePropagation()));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.getByText('Instalar y actualizar', {exact: true}).click();
  await page.getByRole('button', {name: 'Instalar app', exact: true}).click();
  await expect(page.getByText('En iPhone o iPad, abre esta página en Safari,', {exact: false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Cerrar instrucciones', exact: true}).click();
  await expect(page.locator('#pwa-install-help')).toHaveCount(0);
  await context.close();
});

test('controla la instalación aceptada y descarta el evento usado', async ({page}) => {
  await page.goto('/');
  await page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'}).waitFor();
  await page.getByText('Instalar y actualizar', {exact: true}).click();
  // Simulate the OS dialog only; manifest installability is checked separately above.
  await page.evaluate(() => {
    window.installPrompts = 0;
    const event = new Event('beforeinstallprompt', {cancelable: true});
    event.prompt = async () => { window.installPrompts++; };
    event.userChoice = Promise.resolve({outcome: 'accepted'});
    window.dispatchEvent(event);
  });
  await page.getByRole('button', {name: 'Instalar app', exact: true}).click();
  expect(await page.evaluate(() => window.installPrompts)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', {name: 'Instalar app', exact: true})).toHaveCount(0);
  await expect(page.getByText('SafeRoute en tu dispositivo', {exact: true})).toBeVisible();
});

test('una nueva versión espera hasta cerrar el formulario y confirmar', async ({page}) => {
  await ready(page);
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  await page.getByLabel('Detalle opcional').fill('Este texto debe permanecer mientras llega una actualización.');
  const swPath = new URL('../../.pwa-test-dist/sw.js', import.meta.url);
  const original = await readFile(swPath, 'utf8');
  try {
    await writeFile(swPath, `${original}\n// Update test ${Date.now()}\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    const update = page.getByRole('button', {name: 'Actualizar ahora', exact: true});
    await expect(update).toBeDisabled();
    await expect(page.getByLabel('Detalle opcional')).toHaveValue('Este texto debe permanecer mientras llega una actualización.');
    await page.getByRole('button', {name: 'Elegir en el mapa', exact: true}).click();
    await expect(page.locator('main')).toHaveClass(/map-focused/);
    await expect(update).toBeDisabled();
    await page.locator('.map').click({position: {x: 170, y: 150}});
    await expect(page.getByLabel('Detalle opcional')).toHaveValue('Este texto debe permanecer mientras llega una actualización.');
    await page.getByRole('button', {name: 'Cerrar formulario', exact: true}).click();
    await expect(update).toBeEnabled();
    await update.click();
    await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
    await expect(page.getByText('Hay una nueva versión de SafeRoute', {exact: true})).toHaveCount(0);
  } finally {
    await writeFile(swPath, original);
  }
});
