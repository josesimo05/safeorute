import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

const base = {status:'approved', source:'simulated', occurredAt:'2026-11-01T10:00:00.000Z', createdAt:'2026-11-01T10:00:00.000Z'};
const reports = [
  {...base, id:'shared-common', category:'Bache', description:'Bache publicado junto al origen del recorrido.', lat:18.476, lng:-69.943},
  {...base, id:'shared-balanced', category:'Poca iluminación', description:'Luminaria publicada en la alternativa recomendada.', lat:18.48, lng:-69.95},
  {...base, id:'shared-short', category:'Otro', description:'Obstáculo publicado en la alternativa más corta.', lat:18.48, lng:-69.942},
  {...base, id:'shared-pending', status:'pending', category:'Otro', description:'Este reporte pendiente todavía no debe publicarse.', lat:18.476, lng:-69.943},
  {...base, id:'shared-far', category:'Bache', description:'Incidente publicado lejos de ambas alternativas.', lat:18.55, lng:-69.99},
];

test.beforeEach(async ({page}) => {
  // Local fixtures exercise route display, not cross-device publication. The
  // Firebase integration suite tests that separate shared-data boundary.
  await page.addInitScript(rows => localStorage.setItem('saferoute-demo-v1', JSON.stringify(rows)), reports);
});

async function calculateRoutes(page) {
  await page.getByRole('button', {name:'Navegar', exact:true}).click();
  await page.getByRole('combobox', {name:'Origen', exact:true}).fill('Parque Independencia');
  await page.getByRole('option').filter({hasText:'Parque Independencia'}).click();
  await page.getByRole('combobox', {name:'Destino', exact:true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText:'Ágora Mall'}).click();
  await page.getByRole('button', {name:'Buscar rutas', exact:true}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.getByRole('region', {name:'Reportes cerca de esta ruta', exact:true})).toBeVisible();
}

test('los filtros de Explorar no ocultan reportes publicados del corredor de una ruta', async ({page, context}) => {
  await mockGeoapify(context);
  await page.goto('/');
  await page.getByRole('combobox', {name:'Categoría', exact:true}).selectOption('Robo');
  await page.getByRole('textbox', {name:'Buscar en los reportes', exact:true}).fill('un filtro sin coincidencias');
  await expect(page.locator('.report')).toHaveCount(0);
  await calculateRoutes(page);

  const nearby = page.getByRole('region', {name:'Reportes cerca de esta ruta', exact:true});
  await expect(nearby.locator('.route-reports-item')).toHaveCount(2);
  await expect(nearby).toContainText(reports[0].description);
  await expect(nearby).toContainText(reports[1].description);
  await expect(nearby).not.toContainText(reports[2].description);
  await expect(nearby).not.toContainText(reports[3].description);
  await expect(nearby).not.toContainText(reports[4].description);
  await expect(page.locator('.route-card').first().locator('.route-risk')).toContainText('2 reportes a 150 m');
  await expect(page.locator('.report-pin')).toHaveCount(2);
});

test('elegir otra alternativa cambia su lista y marcadores sin mezclar incidentes ajenos', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await calculateRoutes(page);
  const nearby = page.getByRole('region', {name:'Reportes cerca de esta ruta', exact:true});
  await expect(nearby).toContainText(reports[1].description);
  await expect(page.locator('.report-pin').filter({hasText:'☼'})).toHaveCount(1);

  await page.locator('.route-card').nth(1).click();
  await expect(page.locator('.route-card.selected')).toContainText('Más corta');
  await expect(nearby.locator('.route-reports-item')).toHaveCount(2);
  await expect(nearby).toContainText(reports[0].description);
  await expect(nearby).toContainText(reports[2].description);
  await expect(nearby).not.toContainText(reports[1].description);
  await expect(nearby).not.toContainText(reports[3].description);
  await expect(nearby).not.toContainText(reports[4].description);
  await expect(page.locator('.report-pin')).toHaveCount(2);
  await expect(page.locator('.report-pin').filter({hasText:'☼'})).toHaveCount(0);
  expect(calls.preferences).toHaveLength(2);
});

for (const viewport of [
  {name:'escritorio', width:1280, height:720},
  {name:'móvil', width:390, height:844},
]) test(`centrar un incidente conserva la ruta sin recalcularla en ${viewport.name}`, async ({page, context}) => {
  await page.setViewportSize({width:viewport.width, height:viewport.height});
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await calculateRoutes(page);
  const nearby = page.getByRole('region', {name:'Reportes cerca de esta ruta', exact:true});
  await nearby.locator('.route-reports-item').filter({hasText:reports[1].description}).click();
  if (viewport.name === 'móvil') {
    await expect(page.locator('.panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(nearby).toBeHidden();
  }

  await expect.poll(async () => {
    const map = await page.locator('.map').boundingBox();
    const marker = await page.locator('.report-pin').filter({hasText:'☼'}).boundingBox();
    if (!map || !marker) return Infinity;
    return Math.hypot(marker.x + marker.width / 2 - map.x - map.width / 2,
      marker.y + marker.height / 2 - map.y - map.height / 2);
  }).toBeLessThan(4);
  await expect(page.locator('.route-card.selected')).toContainText('Recomendada');
  await expect(page.locator('.route-card')).toHaveCount(2);
  expect(calls.preferences).toHaveLength(2);
  if (viewport.name === 'móvil') await page.screenshot({path:test.info().outputPath('incident-focused-mobile.png')});
});

test('una actualización de datos añade contexto a la ruta activa sin recargar ni recalcular', async ({page, context}) => {
  const calls = await mockGeoapify(context);
  await page.goto('/');
  await page.getByRole('combobox', {name:'Categoría', exact:true}).selectOption('Robo');
  await page.getByRole('textbox', {name:'Buscar en los reportes', exact:true}).fill('filtro sin coincidencias');
  await calculateRoutes(page);
  const nearby = page.getByRole('region', {name:'Reportes cerca de esta ruta', exact:true});
  await expect(nearby.locator('.route-reports-item')).toHaveCount(2);
  let navigations = 0;
  page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations++;});

  // This verifies React's live route view using a genuine same-browser storage
  // event in explicit demo mode. The separate real-emulator suite verifies
  // Firestore publication between independent clients after authorized review.
  const otherTab = await context.newPage();
  try {
    await otherTab.goto('/');
    const published = {...base, id:'newly-approved', category:'Otro', description:'Incidente recién publicado en la ruta que ya estaba seleccionada.', lat:18.477, lng:-69.94475};
    await otherTab.evaluate(report => {
      const key = 'saferoute-demo-v1';
      const current = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify([report, ...current]));
    }, published);

    await expect(nearby.locator('.route-reports-item')).toHaveCount(3);
    await expect(nearby).toContainText(published.description);
    await expect(nearby.getByRole('status')).toHaveText('3 reportes a 150 m');
    await expect(page.locator('.report-pin')).toHaveCount(3);
    await expect(page.locator('.route-card.selected')).toContainText('Recomendada');
    await expect(page.locator('.route-card.selected .route-risk')).toContainText('3 reportes a 150 m');
    await expect(nearby).not.toContainText(reports[3].description);
    expect(calls.preferences).toHaveLength(2);
    expect(navigations).toBe(0);
  } finally {
    await otherTab.close();
  }
});
