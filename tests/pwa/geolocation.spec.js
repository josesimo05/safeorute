import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

async function captureLocationRequests(page, context) {
  await mockGeoapify(context);
  await page.addInitScript(() => {
    window.locationRequests = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {getCurrentPosition(success, error) {window.locationRequests.push({success, error});}},
    });
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
}

async function settleLocation(page, index, outcome = 'success') {
  await page.evaluate(({index, outcome}) => {
    const request = window.locationRequests[index];
    if (outcome === 'error') request.error({code: 1, message: 'Denied'});
    else request.success({coords: {latitude: 40.785091, longitude: -73.968285}});
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, {index, outcome});
}

test('una ubicación retrasada no reemplaza un lugar elegido ni borra sus rutas', async ({page, context}) => {
  await captureLocationRequests(page, context);
  await page.getByRole('button', {name: 'Usar mi ubicación como Origen', exact: true}).click();
  const origin = page.getByRole('combobox', {name: 'Origen', exact: true});
  await origin.fill('Parque Independencia');
  await page.getByRole('option').filter({hasText: 'Parque Independencia'}).click();
  await page.getByRole('combobox', {name: 'Destino', exact: true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText: 'Ágora Mall'}).click();
  await page.getByRole('button', {name: 'Buscar rutas', exact: true}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  await settleLocation(page, 0);
  await expect(origin).toHaveValue('Parque Independencia, Santo Domingo');
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.getByRole('link', {name: 'Waze', exact: true})).toHaveAttribute('href', /ll=18\.49%2C-69\.94/);
});

test('las solicitudes de ubicación se reemplazan por campo y descartan errores antiguos', async ({page, context}) => {
  await captureLocationRequests(page, context);
  const useOrigin = page.getByRole('button', {name: 'Usar mi ubicación como Origen', exact: true});
  await useOrigin.click();
  await useOrigin.click();
  await page.getByRole('button', {name: 'Usar mi ubicación como Destino', exact: true}).click();
  await settleLocation(page, 1);
  await settleLocation(page, 0, 'error');
  await settleLocation(page, 2);
  await expect(page.getByRole('combobox', {name: 'Origen', exact: true})).toHaveValue('Mi ubicación');
  await expect(page.getByRole('combobox', {name: 'Destino', exact: true})).toHaveValue('Mi ubicación');
  await expect(page.locator('.start-pin')).toHaveCount(1);
  await expect(page.locator('.end-pin')).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('cambiar de país cancela las ubicaciones pendientes de ambos campos', async ({page, context}) => {
  await captureLocationRequests(page, context);
  await page.getByRole('button', {name: 'Usar mi ubicación como Origen', exact: true}).click();
  await page.getByRole('button', {name: 'Usar mi ubicación como Destino', exact: true}).click();
  await page.locator('.preferences-button').click();
  await page.locator('#search-country').selectOption('us');
  await page.getByRole('button', {name: 'Guardar preferencias', exact: true}).click();
  await settleLocation(page, 0);
  await settleLocation(page, 1, 'error');
  await expect(page.getByRole('combobox', {name: 'Origen', exact: true})).toBeEmpty();
  await expect(page.getByRole('combobox', {name: 'Destino', exact: true})).toBeEmpty();
  await expect(page.locator('.start-pin, .end-pin')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});
