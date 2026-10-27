import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

test('los ocho idiomas cambian sin conexión y conservan la preferencia', async ({page, context}) => {
  await page.setViewportSize({width:390,height:844});
  await mockGeoapify(context);
  await page.goto('/');
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.locator('.preferences-button').click();
  await expect(page.locator('#app-language option')).toHaveCount(8);
  for (const code of ['en', 'fr', 'pt', 'de', 'it', 'ar', 'zh', 'es']) {
    await page.locator('#app-language').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (code === 'en') await expect(page.getByRole('button', {name:'Navigate',exact:true})).toBeVisible();
    if (code === 'fr') await expect(page.getByRole('button', {name:'Itinéraires',exact:true})).toBeVisible();
    if (code === 'ar') {
      expect(await page.locator('.map').evaluate(node => getComputedStyle(node).direction)).toBe('ltr');
      expect(await page.locator('nav').innerText()).toMatch(/[\u0600-\u06ff]/);
    }
  }
  await page.locator('#app-language').selectOption('en');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('button',{name:'Navigate',exact:true})).toBeVisible();
});

test('país e idioma llegan al proveedor y se conservan al recargar', async ({page, context}) => {
  await mockGeoapify(context);
  let query;
  await page.route('**/v1/geocode/autocomplete?**', async route => {
    const url=new URL(route.request().url());
    query={country:url.searchParams.get('filter'),language:url.searchParams.get('lang')};
    await route.fulfill({json:{results:[{place_id:'central-park',name:'Central Park',formatted:'Central Park, New York, United States',result_type:'amenity',country_code:'us',lat:40.785091,lon:-73.968285}]}});
  });
  await page.goto('/');
  await page.locator('.preferences-button').click();
  await page.locator('#app-language').selectOption('en');
  await page.locator('#search-country').selectOption('us');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  await page.getByRole('combobox',{name:'Origin',exact:true}).fill('Central Park');
  await page.getByRole('option').filter({hasText:'Central Park'}).click();
  expect(query).toEqual({country:'countrycode:us',language:'en'});
  await expect(page.getByRole('combobox',{name:'Origin',exact:true})).toHaveValue('Central Park');
  await expect(page.locator('.start-pin')).toHaveCount(1);
  await page.reload();
  await page.locator('.preferences-button').click();
  await expect(page.locator('#app-language')).toHaveValue('en');
  await expect(page.locator('#search-country')).toHaveValue('us');
});

test('la búsqueda mundial permite elegir un lugar fuera de República Dominicana', async ({page, context}) => {
  await mockGeoapify(context);
  let filter;
  await page.route('**/v1/geocode/autocomplete?**', async route => {
    filter=new URL(route.request().url()).searchParams.get('filter');
    await route.fulfill({json:{results:[{place_id:'eiffel',name:'Tour Eiffel',formatted:'Tour Eiffel, Paris, France',result_type:'amenity',country_code:'fr',lat:48.8582599,lon:2.2945006}]}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Navegar',exact:true}).click();
  await page.getByRole('combobox',{name:'Origen',exact:true}).fill('Tour Eiffel');
  await page.getByRole('option').filter({hasText:'Tour Eiffel'}).click();
  expect(filter).toBeNull();
  await expect(page.getByRole('combobox',{name:'Origen',exact:true})).toHaveValue('Tour Eiffel');
  await expect(page.locator('.start-pin')).toHaveCount(1);
});
