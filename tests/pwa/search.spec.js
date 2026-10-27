import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

const result = (id, name) => ({place_id: id, name, formatted: `${name}, Santo Domingo`, result_type: 'amenity', country_code: 'do', lat: 18.474, lon: -69.966});

test('una búsqueda anterior no sustituye las sugerencias de lo que se está escribiendo', async ({page, context}) => {
  await mockGeoapify(context);
  let releaseOld;
  let oldStarted;
  let oldFinished;
  const released = new Promise(resolve => {releaseOld = resolve;});
  const started = new Promise(resolve => {oldStarted = resolve;});
  const finished = new Promise(resolve => {oldFinished = resolve;});
  await page.route('**/v1/geocode/autocomplete?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('text');
    if (query === 'Colegio') {
      oldStarted();
      await released;
      try { await route.fulfill({json: {results: [result('school', 'Colegio Jaime Molina Mota')]}}); }
      catch { /* The aborted request may already have closed. */ }
      oldFinished();
    } else await route.fulfill({json: {results: [result('club', 'Club San Gerónimo')]}});
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  const input = page.getByRole('combobox', {name: 'Origen', exact: true});
  await input.fill('Colegio');
  await started;
  await input.fill('Club San');
  await expect(page.getByRole('option')).toContainText('Club San Gerónimo');
  releaseOld();
  await finished;
  await expect(page.getByRole('option')).not.toContainText('Colegio');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'origin-options-0');
  await input.press('Enter');
  await expect(input).toHaveValue('Club San Gerónimo');
  await expect(page.locator('.start-pin')).toHaveCount(1);
});

test('los fallos de búsqueda son visibles y se puede volver a buscar por nombre', async ({page, context}) => {
  await mockGeoapify(context);
  let denied = true;
  await page.route('**/v1/geocode/autocomplete?**', route => denied
    ? route.fulfill({status: 403, json: {message: 'Denied'}})
    : route.fulfill({json: {results: [result('school', 'Colegio Jaime Molina Mota')]}}));
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  const input = page.getByRole('combobox', {name: 'Origen', exact: true});
  await input.fill('Colegio Jaime');
  await expect(page.locator('#origin-status')).toContainText('Geoapify no autorizó');
  await expect(page.getByRole('option')).toHaveCount(0);
  denied = false;
  await input.press('Enter');
  await expect(page.getByRole('option').filter({hasText: 'Colegio Jaime Molina Mota'})).toBeVisible();
  await page.getByRole('option').filter({hasText: 'Colegio Jaime Molina Mota'}).click();
  await expect(input).toHaveValue('Colegio Jaime Molina Mota');
});
