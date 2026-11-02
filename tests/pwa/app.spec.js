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

async function observeReloads(page) {
  const marker = `page-${Date.now()}-${Math.random()}`;
  const observed = {navigations: 0, marker};
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) observed.navigations++;
  });
  await page.evaluate(value => {
    window.__pwaPageSentinel = value;
    localStorage.setItem(`pwa-regression-${value}`, value);
  }, marker);
  return observed;
}

async function expectSameDocument(page, observed) {
  expect(await page.evaluate(() => window.__pwaPageSentinel)).toBe(observed.marker);
  expect(observed.navigations).toBe(0);
}

async function expectOneAutomaticReload(page, observed) {
  await expect.poll(() => observed.navigations).toBe(1);
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
  expect(await page.evaluate(() => window.__pwaPageSentinel)).toBeUndefined();
  expect(await page.evaluate(marker => localStorage.getItem(`pwa-regression-${marker}`), observed.marker)).toBe(observed.marker);
  await expect(page.getByRole('button', {name: 'Actualizar ahora', exact: true})).toHaveCount(0);
  // Both Workbox and controllerchange signal the same update. Give the idle
  // reload guard another cycle to catch a duplicate reload, rather than merely
  // asserting that the unchanged heading is still visible.
  await page.waitForTimeout(1500);
  expect(observed.navigations).toBe(1);
}

async function activeRelease(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const worker = registration?.active;
    if (!worker || worker.state !== 'activated') return null;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = value => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 300);
      channel.port1.onmessage = event => finish(event.data.release);
      worker.postMessage({type: 'PWA_TEST_RELEASE'}, [channel.port2]);
    });
  }).catch(() => null); // An automatic reload can replace this execution context.
}

async function withWorkerUpdate(page, verify) {
  const swPath = new URL('../../.pwa-test-dist/sw.js', import.meta.url);
  const original = await readFile(swPath, 'utf8');
  const release = `release-${Date.now()}-${Math.random()}`;
  try {
    // A real worker update, with a test-only message response so the test can
    // distinguish this activated version from the previous active worker.
    await writeFile(swPath, `${original}\nself.addEventListener('message', event => {
      if (event.data?.type === 'PWA_TEST_RELEASE') event.ports[0]?.postMessage({release: ${JSON.stringify(release)}});
    });\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => activeRelease(page), {timeout: 10_000}).toBe(release);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).waiting === null)).toBe(true);
    await verify(release);
  } finally {
    await writeFile(swPath, original);
  }
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

test('la primera instalación activa el worker sin una recarga adicional', async ({page}) => {
  let navigations = 0;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const marker = await page.evaluate(() => window.__firstInstallSentinel = 'first installation');
  await page.waitForTimeout(1500);
  expect(navigations).toBe(1);
  expect(await page.evaluate(() => window.__firstInstallSentinel)).toBe(marker);
});

test('una nueva versión se activa y recarga una sola vez cuando la app está libre', async ({page}) => {
  await ready(page);
  const observed = await observeReloads(page);
  await withWorkerUpdate(page, async release => {
    await expectOneAutomaticReload(page, observed);
    expect(await activeRelease(page)).toBe(release);
  });
});

test('la actualización conserva el borrador y la selección en mapa hasta cerrar el formulario', async ({page}) => {
  await ready(page);
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  const draft = 'Este texto debe permanecer mientras llega una actualización.';
  await page.getByLabel('Detalle opcional').fill(draft);
  const observed = await observeReloads(page);
  await withWorkerUpdate(page, async () => {
    await page.waitForTimeout(1500);
    await expectSameDocument(page, observed);
    await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
    await page.getByRole('button', {name: 'Elegir en el mapa', exact: true}).click();
    await expect(page.locator('main')).toHaveClass(/map-focused/);
    await page.waitForTimeout(1500);
    await expectSameDocument(page, observed);
    await page.locator('.map').click({position: {x: 170, y: 150}});
    await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
    await page.getByRole('button', {name: 'Cerrar formulario', exact: true}).click();
    await expectOneAutomaticReload(page, observed);
  });
});

test('una pestaña libre se actualiza sin borrar el borrador de otra pestaña', async ({page, context}) => {
  await ready(page);
  const editingPage = await context.newPage();
  try {
    await editingPage.goto('/');
    await expect(editingPage.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
    await editingPage.bringToFront();
    await editingPage.getByRole('button', {name: '＋ Reportar', exact: true}).click();
    const draft = 'Borrador en otra pestaña durante una actualización automática.';
    await editingPage.getByLabel('Detalle opcional').fill(draft);
    const editingObserved = await observeReloads(editingPage);
    const idleObserved = await observeReloads(page);
    await page.bringToFront();
    await withWorkerUpdate(page, async release => {
      await expectOneAutomaticReload(page, idleObserved);
      await expectSameDocument(editingPage, editingObserved);
      await expect(editingPage.getByLabel('Detalle opcional')).toHaveValue(draft);
      expect(await activeRelease(editingPage)).toBe(release);
      await editingPage.bringToFront();
      await expect(editingPage.getByLabel('Detalle opcional')).toHaveValue(draft);
      await editingPage.getByRole('button', {name: 'Cerrar formulario', exact: true}).click();
      await expectOneAutomaticReload(editingPage, editingObserved);
      expect(idleObserved.navigations).toBe(1);
    });
  } finally {
    await editingPage.close();
  }
});

test('recargar normalmente aplica la versión activa sin exigir confirmar una actualización', async ({page}) => {
  await ready(page);
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  await page.getByLabel('Detalle opcional').fill('Una tarea abierta aplaza la recarga automática.');
  const observed = await observeReloads(page);
  await withWorkerUpdate(page, async release => {
    await page.waitForTimeout(1500);
    await expectSameDocument(page, observed);
    // An ordinary user-initiated reload intentionally closes the in-memory task.
    await page.reload();
    await expectOneAutomaticReload(page, observed);
    expect(await activeRelease(page)).toBe(release);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('una dirección aún sin calcular protege el planificador hasta vaciarla', async ({page}) => {
  await ready(page);
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  const origin = page.getByRole('combobox', {name: 'Origen', exact: true});
  const draft = 'Una dirección todavía sin seleccionar';
  await origin.fill(draft);
  const observed = await observeReloads(page);
  await withWorkerUpdate(page, async () => {
    await page.waitForTimeout(1500);
    await expectSameDocument(page, observed);
    await expect(origin).toHaveValue(draft);
    await origin.fill('');
    await expectOneAutomaticReload(page, observed);
  });
});
