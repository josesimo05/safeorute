import {test, expect} from '@playwright/test';

test.beforeEach(async ({context}) => {
  // This design prototype uses local fixtures and must never contact live
  // cameras, institutions, Firebase, or messaging services.
  await context.route(/https:\/\/.*/, route => route.abort());
});

const navigation = page => page.getByRole('navigation', {name:'Secciones del piloto'});
const openTab = (page, name) => navigation(page).getByRole('button', {name:new RegExp(`^${name}`)}).click();
const noticeButton = (page, title) => page.locator('.pilot-notice-list').getByRole('button').filter({hasText:title});

async function openPilot(page) {
  await page.goto('/piloto/');
  await expect(page.getByRole('heading', {name:'Panorama del piloto', exact:true})).toBeVisible();
  await expect(page.locator('.pilot-demo-banner')).toContainText('Datos ficticios. No envía alertas reales.');
}

test('el piloto abre como diseño separado, sin instalar la PWA ciudadana ni enviar datos', async ({page}) => {
  const apiCalls = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
  });
  await openPilot(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await expect(page.getByLabel('Perfil de demostración')).toHaveValue('op-pn');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await expect(page.getByRole('region', {name:'Mapa ilustrativo'})).toContainText('Ubicaciones simuladas');
  expect(apiCalls).toEqual([]);
});

test('el diseño funciona sin desbordar en escritorio y móviles de 320 y 390 px', async ({page}) => {
  await openPilot(page);
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({width, height:844});
    await expect(page.getByLabel('Perfil de demostración')).toBeVisible();
    await expect(page.locator('.pilot-demo-banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await openTab(page, 'Reportes');
    await expect(page.getByLabel('Buscar reportes', {exact:true})).toBeVisible();
    await page.getByLabel('Buscar reportes', {exact:true}).fill('sin coincidencias en el escenario');
    await expect(page.getByRole('heading', {name:'Sin reportes para estos filtros'})).toBeVisible();
    await page.getByRole('button', {name:'Limpiar búsqueda', exact:true}).click();
    await expect(page.getByRole('region', {name:'Lista de reportes'}).getByRole('button').first()).toBeVisible();
    await openTab(page, 'Avisos');
    await page.getByLabel('Título del aviso', {exact:true}).fill('Ejemplo de prueba móvil');
    await page.getByLabel('Mensaje para ciudadanos', {exact:true}).fill('Este mensaje ficticio permite revisar el formulario desde el celular.');
    const create = page.getByRole('button', {name:'Crear borrador', exact:true});
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await openTab(page, 'Resumen');
  }
});

test('la PWA ciudadana no sustituye ni guarda el HTML del piloto', async ({page, context}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await openPilot(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  const cachedPilotPages = await page.evaluate(async () => {
    const requests = (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat();
    return requests.map(request => new URL(request.url).pathname).filter(path => path.startsWith('/piloto/'));
  });
  expect(cachedPilotPages).toEqual([]);
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  // A unique URL avoids a browser HTTP-cache entry masking a SW fallback bug.
  await expect(offlinePage.goto(`/piloto/?offline-probe=${Date.now()}`)).rejects.toThrow();
  await offlinePage.close();
});

test('la gestión y el historial son simulados y no modifican reportes ciudadanos guardados', async ({page}) => {
  const citizenMarker = '[{"id":"citizen-storage-must-remain"}]';
  await page.goto('/piloto/');
  await page.evaluate(value => localStorage.setItem('saferoute-demo-v1', value), citizenMarker);
  const writes = [];
  page.on('request', request => {
    if (!['GET','HEAD'].includes(request.method())) writes.push(request.url());
  });
  await page.getByRole('button', {name:/^Ver caso SR-1026:/}).click();
  const detail = page.getByRole('region', {name:'Detalle del caso SR-1026', exact:true});
  await expect(detail.getByRole('heading', {name:'Observado', exact:true})).toBeVisible();
  await expect(detail.getByRole('heading', {name:'Causa probable', exact:true})).toBeVisible();
  await detail.getByRole('combobox', {name:'Estado del caso', exact:true}).selectOption('resolved');
  await detail.getByLabel('Responsable de prueba', {exact:true}).fill('Equipo de prueba Alfa');
  await detail.getByRole('button', {name:'Guardar gestión simulada', exact:true}).click();
  await expect(detail.locator('.pilot-detail-meta')).toContainText('Resuelto');
  await detail.getByLabel('Nota interna de prueba', {exact:true}).fill('Inspección ficticia registrada únicamente para revisar el diseño.');
  await detail.getByRole('button', {name:'Añadir nota de prueba', exact:true}).click();
  await expect(detail.locator('.pilot-notes')).toContainText('Inspección ficticia registrada');
  await openTab(page, 'Historial');
  await expect(page.locator('.pilot-audit-list')).toContainText('Nota de prueba añadida');
  await expect(page.locator('.pilot-audit-list')).toContainText('Equipo de prueba Alfa');
  await page.getByRole('button', {name:'Restablecer demostración', exact:true}).click();
  await expect(page.locator('.pilot-audit-list article')).toHaveCount(1);
  await openTab(page, 'Reportes');
  await page.getByRole('button', {name:/^SR-1026:/}).click();
  await expect(detail.getByRole('combobox', {name:'Estado del caso', exact:true})).toHaveValue('verified');
  await expect(detail.locator('.pilot-notes')).not.toContainText('Inspección ficticia registrada');
  expect(await page.evaluate(() => localStorage.getItem('saferoute-demo-v1'))).toBe(citizenMarker);
  expect(writes).toEqual([]);
});

test('un aviso requiere revisión de otra persona y solo se publica en la vista simulada', async ({page}) => {
  await openPilot(page);
  await openTab(page, 'Avisos');
  const title = 'Desvío de prueba junto a la intersección';
  const text = 'Precaución en el ejemplo. <img src=x onerror="window.__pilotAttack=1">';
  await page.getByLabel('Título del aviso', {exact:true}).fill(title);
  await page.getByLabel('Mensaje para ciudadanos', {exact:true}).fill(text);
  await page.getByRole('button', {name:'Crear borrador', exact:true}).click();
  const detail = page.locator('.pilot-notice-detail');
  const preview = page.getByRole('region', {name:'Vista ciudadana simulada', exact:true});
  await expect(detail.getByRole('heading', {name:title, exact:true})).toBeVisible();
  await detail.getByRole('button', {name:'Enviar a revisión', exact:true}).click();
  await expect(detail.getByRole('button', {name:'Aprobar versión', exact:true})).toHaveCount(0);
  await expect(preview).not.toContainText(title);
  await page.getByLabel('Perfil de demostración').selectOption('sup-pn');
  await noticeButton(page, title).click();
  await detail.getByRole('button', {name:'Aprobar versión', exact:true}).click();

  // Editing an already reviewed version invalidates its approval in the UI.
  await page.getByLabel('Perfil de demostración').selectOption('op-pn');
  await noticeButton(page, title).click();
  await detail.getByRole('button', {name:'Editar borrador', exact:true}).click();
  await detail.getByRole('textbox', {name:'Editar mensaje', exact:true}).fill(`${text} Versión revisada.`);
  await detail.getByRole('button', {name:'Guardar nueva versión', exact:true}).click();
  await expect(detail.locator('.pilot-status')).toHaveText('Borrador');
  await detail.getByRole('button', {name:'Enviar a revisión', exact:true}).click();
  await page.getByLabel('Perfil de demostración').selectOption('sup-pn');
  await noticeButton(page, title).click();
  await detail.getByRole('button', {name:'Aprobar versión', exact:true}).click();
  await expect(preview).not.toContainText(title);
  await detail.getByRole('button', {name:'Publicar simulación', exact:true}).click();
  await expect(preview.getByRole('heading', {name:title, exact:true})).toBeVisible();
  await expect(preview).toContainText('No se envió a usuarios');
  await expect(preview).toContainText('<img src=x');
  await expect(preview.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pilotAttack)).toBeUndefined();
  await detail.getByLabel('Motivo del retiro', {exact:true}).fill('El escenario ficticio ya terminó.');
  await detail.getByRole('button', {name:'Retirar aviso', exact:true}).click();
  await expect(preview).not.toContainText(title);
  await expect(detail.locator('.pilot-status')).toHaveText('Retirado');
});

test('los perfiles cambian la bandeja y una cámara sin señal no muestra velocidad cero', async ({page}) => {
  await openPilot(page);
  await openTab(page, 'Reportes');
  const list = page.getByRole('region', {name:'Lista de reportes', exact:true});
  await expect(list.getByRole('button', {name:/^SR-1026:/})).toHaveCount(1);
  await expect(list.getByRole('button', {name:/^SR-1025:/})).toHaveCount(0);
  await page.getByLabel('Perfil de demostración').selectOption('op-digesett');
  await expect(list.getByRole('button', {name:/^SR-1026:/})).toHaveCount(0);
  await expect(list.getByRole('button', {name:/^SR-1025:/})).toHaveCount(1);
  await page.getByLabel('Perfil de demostración').selectOption('reader-pn');
  await expect(page.getByLabel('Responsable de prueba', {exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Nota interna de prueba', {exact:true})).toHaveCount(0);
  await openTab(page, 'Cámaras');
  const camera = page.locator('.pilot-camera-card').filter({hasText:'CAM-DEMO-03'});
  await expect(camera).toContainText('Sin señal');
  await expect(camera.locator('.pilot-camera-values')).toContainText('Sin medición');
  await expect(camera.locator('.pilot-camera-values')).toContainText('Sin determinar');
  await expect(camera.locator('.pilot-camera-values')).not.toContainText(/\b0\s*km\/h|detenido/i);
  await expect(page.locator('video,canvas')).toHaveCount(0);
});
