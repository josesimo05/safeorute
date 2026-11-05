import {test, expect} from '@playwright/test';

// These tests exercise the real component and browser interactions. Callback
// effects are synthetic; they do not certify Firebase permissions or transport.
const browserErrors = new WeakMap();
test.beforeEach(async ({page, context}) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/https:\/\/.*/, route => route.abort());
});
test.afterEach(async ({page}) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function openFixture(page) {
  await page.goto('/tests/moderation/fixture.html');
  await expect(page.getByRole('button', {name:'Retirar reporte', exact:true})).toHaveCount(2);
}

function publishedCard(page, number = 'uno') {
  return page.getByRole('article').filter({hasText:`Reporte publicado de prueba número ${number}.`});
}

test('publicados excluye pendientes/retirados y cancelar no retira ni rompe la aprobación', async ({page}) => {
  await openFixture(page);
  await expect(page.getByText('Este pendiente no debe aparecer entre los publicados.', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Este retirado tampoco debe aparecer entre los publicados.', {exact:true})).toHaveCount(0);
  const card = publishedCard(page);
  await card.getByRole('button', {name:'Retirar reporte', exact:true}).click();
  await expect(card.getByRole('button', {name:'Confirmar retirada', exact:true})).toBeVisible();
  await card.getByRole('button', {name:'Cancelar', exact:true}).click();
  await expect(card.getByRole('button', {name:'Confirmar retirada', exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => window.__moderationFixture.calls)).toEqual([]);
  await expect(card).toBeVisible();
  await page.getByRole('button', {name:'Aprobar publicación', exact:true}).click();
  await expect(page.getByRole('button', {name:'Aprobar publicación', exact:true})).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Retirar reporte', exact:true})).toHaveCount(3);
  expect(await page.evaluate(() => window.__moderationFixture.calls)).toEqual([
    {action:'review', id:'pending-one', status:'approved'},
  ]);
});

test('confirmar retira una vez y bloquea decisiones simultáneas mientras espera', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {window.__moderationFixture.hold = true;});
  const card = publishedCard(page);
  await card.getByRole('button', {name:'Retirar reporte', exact:true}).click();
  await card.getByRole('button', {name:'Confirmar retirada', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__moderationFixture.calls.length)).toBe(1);
  await expect(page.getByRole('button', {name:'Aprobar publicación', exact:true})).toBeDisabled();
  await expect(page.getByRole('button', {name:'Rechazar reporte', exact:true})).toBeDisabled();
  await expect(publishedCard(page, 'dos').getByRole('button', {name:'Retirar reporte', exact:true})).toBeDisabled();
  await expect(card.getByRole('button', {name:'Procesando…', exact:true})).toBeDisabled();
  await expect(card.getByRole('button', {name:'Cancelar', exact:true})).toBeDisabled();
  expect(await page.evaluate(() => window.__moderationFixture.calls)).toEqual([
    {action:'withdraw', id:'published-one'},
  ]);
  await page.evaluate(() => window.__moderationFixture.release());
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Retirar reporte', exact:true})).toHaveCount(1);
  await expect(page.getByRole('button', {name:'Aprobar publicación', exact:true})).toBeEnabled();
});

test('un fallo conserva el reporte y la confirmación para reintentar sin filtrar detalles privados', async ({page}) => {
  await openFixture(page);
  await page.evaluate(() => {window.__moderationFixture.fail = true;});
  const card = publishedCard(page);
  await card.getByRole('button', {name:'Retirar reporte', exact:true}).click();
  await card.getByRole('button', {name:'Confirmar retirada', exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo retirar el reporte. Inténtalo de nuevo.');
  await expect(page.locator('body')).not.toContainText('private-test-token-must-not-be-displayed');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', {name:'Confirmar retirada', exact:true})).toBeEnabled();
  await page.evaluate(() => {window.__moderationFixture.fail = false;});
  await card.getByRole('button', {name:'Confirmar retirada', exact:true}).click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.__moderationFixture.calls)).toEqual([
    {action:'withdraw', id:'published-one'},
    {action:'withdraw', id:'published-one'},
  ]);
});

test('en móvil y árabe mantiene lectura RTL, controles táctiles y ancho visible', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => localStorage.setItem('saferoute-language', 'ar'));
  await page.goto('/tests/moderation/fixture.html');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  const card = publishedCard(page);
  const withdrawButton = card.getByRole('button');
  await expect(withdrawButton).toHaveCount(1);
  await expect(withdrawButton).not.toHaveText('Retirar reporte');
  await withdrawButton.click();
  const buttons = card.getByRole('group').getByRole('button');
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
