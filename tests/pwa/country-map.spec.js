import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

// Recover the visible map centre from rendered raster tiles, without exposing
// Leaflet internals or adding application-only test hooks.
async function visibleMapCentre(page) {
  return page.locator('.map').evaluate(map => {
    const bounds = map.getBoundingClientRect();
    const centre = {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
    for (const tile of map.querySelectorAll('img.leaflet-tile')) {
      const box = tile.getBoundingClientRect();
      if (centre.x < box.left || centre.x >= box.right || centre.y < box.top || centre.y >= box.bottom) continue;
      const match = new URL(tile.src).pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (!match) continue;
      const [, z, x, y] = match.map(Number);
      const longitude = (x + (centre.x - box.left) / box.width) / 2 ** z * 360 - 180;
      const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (centre.y - box.top) / box.height) / 2 ** z))) * 180 / Math.PI;
      return {latitude, longitude, zoom: z};
    }
    return null;
  });
}

async function expectCountryView(page, latitude, longitude) {
  await expect.poll(async () => {
    const centre = await visibleMapCentre(page);
    return centre && Math.abs(centre.latitude - latitude) < 0.15 && Math.abs(centre.longitude - longitude) < 0.15;
  }).toBe(true);
}

test('cambiar de país mueve el mapa móvil y cambia también el centro de las búsquedas', async ({page, context}) => {
  await page.setViewportSize({width:390, height:844});
  await mockGeoapify(context);
  let query;
  await page.route('**/v1/geocode/autocomplete?**', route => {
    const url = new URL(route.request().url());
    query = {filter:url.searchParams.get('filter'), bias:url.searchParams.get('bias')};
    return route.fulfill({json:{results:[]}});
  });
  await page.goto('/');
  await page.getByRole('button', {name:'Navegar',exact:true}).click();
  await page.locator('#planner-country').selectOption('us');
  await expectCountryView(page,38,-97);
  await page.locator('#origin').fill('Central Park');
  await expect.poll(() => query?.filter).toBe('countrycode:us');
  const [longitude,latitude] = query.bias.slice('proximity:'.length).split(',').map(Number);
  // Leaflet can round the projected centre by one pixel while resizing the
  // mobile search panel; the bias must stay in the chosen country's overview.
  expect(Math.abs(latitude-38)).toBeLessThan(0.25);
  expect(Math.abs(longitude+97)).toBeLessThan(0.25);
  await page.locator('#planner-country').selectOption('fr');
  await expectCountryView(page,46,2);
  await expect(page.locator('#origin')).toHaveValue('');
  await expect(page.locator('#destination')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('el país guardado restaura su vista de mapa al volver a abrir la app', async ({page, context}) => {
  await page.setViewportSize({width:390,height:844});
  await mockGeoapify(context);
  await page.goto('/');
  await page.locator('.preferences-button').click();
  await page.locator('#search-country').selectOption('bo');
  await page.locator('.preferences-dialog .primary').click();
  await expectCountryView(page,-17,-65);
  await page.reload();
  await expectCountryView(page,-17,-65);
  await page.locator('.preferences-button').click();
  await expect(page.locator('#search-country')).toHaveValue('bo');
});

