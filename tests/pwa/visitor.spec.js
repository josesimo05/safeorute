import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';
import {translateText} from '../../src/i18n.js';

test.beforeEach(async ({context}) => {
  await mockGeoapify(context);
});

test('un visitante móvil ve el propósito, el acceso al piloto y una parte útil del mapa', async ({page}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height:844});
    await page.goto('/');
    const purpose = page.locator('.project-mobile-purpose');
    await expect(purpose).toHaveText('Consulta reportes comunitarios y compara rutas con más contexto.');
    await expect(purpose).toBeInViewport();
    for (const control of [page.getByRole('button', {name:'Cómo funciona', exact:true}),
      page.getByRole('link', {name:'Piloto de autoridades · Demo', exact:true})]) {
      await expect(control).toBeInViewport();
      const bounds = await control.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.project-overview-guide')).toHaveCount(0);
    const map = await page.locator('.map').boundingBox();
    expect(map.height).toBeGreaterThanOrEqual(235);
    expect(map.y + 235).toBeLessThanOrEqual(844 - 55);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('la guía explica funcionamiento y simulación con teclado y sin iniciar reportes ni servicios', async ({page}) => {
  const requests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') || !['GET','HEAD'].includes(request.method())) {
      requests.push(request.url());
    }
  });
  await page.goto('/');
  const stored = await page.evaluate(() => localStorage.getItem('saferoute-demo-v1'));
  const opener = page.getByRole('button', {name:'Cómo funciona', exact:true});
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  const guide = page.getByRole('region', {name:'Cómo funciona SafeRoute', exact:true});
  await expect(guide.getByRole('heading', {name:'Funcionando', exact:true})).toBeVisible();
  await expect(guide.getByRole('heading', {name:'Simulado', exact:true})).toBeVisible();
  await expect(guide.getByRole('heading', {name:'Por validar', exact:true})).toBeVisible();
  await expect(guide).toContainText('Los tiempos no incluyen tráfico en vivo.');
  await expect(guide).toContainText('datos ficticios; no envían avisos reales.');
  await expect(guide).toContainText('Cámaras autorizadas, mediciones de campo y cuentas institucionales.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await guide.getByRole('button', {name:'Cerrar guía', exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(guide).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => localStorage.getItem('saferoute-demo-v1'))).toBe(stored);
  expect(requests).toEqual([]);
});

test('el enlace visible abre el piloto y volver conserva la entrada ciudadana', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/');
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const link = page.getByRole('link', {name:'Piloto de autoridades · Demo', exact:true});
  await expect(link).toHaveAttribute('href', '/piloto/');
  await link.click();
  await expect(page).toHaveURL(/\/piloto\/$/);
  await expect(page.getByRole('heading', {name:'Panorama del piloto', exact:true})).toBeVisible();
  await expect(page.locator('.pilot-demo-banner')).toContainText('Datos ficticios. No envía alertas reales.');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('button', {name:'Cómo funciona', exact:true})).toBeVisible();
  await expect(page.locator('.project-mobile-purpose')).toBeVisible();
});

test('el propósito y los límites se traducen al árabe y permanecen disponibles sin conexión', async ({page, context}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/');
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.locator('.preferences-button').click();
  await page.locator('#app-language').selectOption('ar');
  await page.locator('.preferences-dialog .primary').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('.project-mobile-purpose')).toHaveText(translateText('Consulta reportes comunitarios y compara rutas con más contexto.', 'ar'));
  await page.getByRole('button', {name:translateText('Cómo funciona', 'ar'), exact:true}).click();
  const guide = page.getByRole('region', {name:translateText('Cómo funciona SafeRoute', 'ar'), exact:true});
  await expect(guide).toContainText(translateText('El tráfico por cámaras (ITS) y el panel de autoridades usan datos ficticios; no envían avisos reales.', 'ar'));
  await expect(guide.getByRole('heading', {name:translateText('Por validar', 'ar'), exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('la guía deja libre el planificador y el mapa completo conserva los puntos elegidos', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/');
  await page.getByRole('button', {name:'Cómo funciona', exact:true}).click();
  await page.getByRole('button', {name:'Navegar', exact:true}).click();
  await expect(page.locator('.project-overview')).toHaveCount(0);
  await page.getByRole('combobox', {name:'Origen', exact:true}).fill('Parque Independencia');
  await page.getByRole('option').filter({hasText:'Parque Independencia'}).click();
  await page.getByRole('combobox', {name:'Destino', exact:true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText:'Ágora Mall'}).click();
  await page.getByRole('button', {name:'Ver mapa completo', exact:true}).click();
  await expect(page.locator('.project-overview')).toHaveCount(0);
  const map = await page.locator('.map').boundingBox();
  expect(map.height).toBeGreaterThanOrEqual(235);
  expect(map.y).toBeLessThan(150);
  await page.getByRole('button', {name:'Mostrar planificador', exact:true}).click();
  await expect(page.getByRole('combobox', {name:'Origen', exact:true})).toHaveValue('Parque Independencia, Santo Domingo');
  await expect(page.getByRole('combobox', {name:'Destino', exact:true})).toHaveValue('Ágora Mall, Santo Domingo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
