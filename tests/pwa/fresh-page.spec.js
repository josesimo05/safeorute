import {test, expect} from '@playwright/test';
import {readFile, writeFile} from 'node:fs/promises';

test.beforeEach(async ({context}) => {
  await context.route(/https:\/\/.*/, route => route.abort());
});

async function firstInstall(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test('una recarga normal obtiene el HTML nuevo aun antes de cambiar el worker y lo conserva offline', async ({page, context}) => {
  await firstInstall(page);
  const htmlPath = new URL('../../.pwa-test-dist/index.html', import.meta.url);
  const swPath = new URL('../../.pwa-test-dist/sw.js', import.meta.url);
  const original = await readFile(htmlPath, 'utf8');
  const originalWorker = await readFile(swPath, 'utf8');
  const marker = `fresh-html-${Date.now()}`;
  try {
    await writeFile(htmlPath, original.replace('</head>', `<meta name="pwa-freshness-test" content="${marker}" /></head>`));
    // No update button, cache deletion, worker mutation or registration.update.
    await page.reload({waitUntil:'networkidle'});
    await expect(page.locator('meta[name="pwa-freshness-test"]')).toHaveAttribute('content', marker);
    expect(await readFile(swPath, 'utf8')).toBe(originalWorker);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
    await expect(page.locator('meta[name="pwa-freshness-test"]')).toHaveAttribute('content', marker);
    await expect(page.getByRole('button', {name:'Actualizar ahora', exact:true})).toHaveCount(0);
  } finally {
    await writeFile(htmlPath, original);
    await context.setOffline(false);
  }
});

test('la primera instalación permite recargar offline sin calentar una caché de navegación', async ({page, context}) => {
  await firstInstall(page);
  // This document came from the network before the worker controlled it. The
  // very first controlled navigation must still recover the precached shell.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
  await page.getByText('Instalar y actualizar', {exact:true}).click();
  await expect(page.getByText('Sin conexión.', {exact:false}).first()).toBeVisible();
});

test('un HTML con assets aún no precargados no reemplaza la última interfaz offline completa', async ({page, context}) => {
  await firstInstall(page);
  await page.reload({waitUntil:'networkidle'});
  const htmlPath = new URL('../../.pwa-test-dist/index.html', import.meta.url);
  const original = await readFile(htmlPath, 'utf8');
  try {
    await writeFile(htmlPath, original.replace('</head>', '<meta name="incomplete-release-test" content="next" /><script type="module" src="/assets/not-in-this-release.js"></script></head>'));
    await page.reload({waitUntil:'networkidle'});
    await expect(page.locator('meta[name="incomplete-release-test"]')).toHaveAttribute('content', 'next');
    await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', {name:'Tu ciudad, con más contexto.'})).toBeVisible();
    await expect(page.locator('meta[name="incomplete-release-test"]')).toHaveCount(0);
  } finally {
    await writeFile(htmlPath, original);
    await context.setOffline(false);
  }
});

test('la versión publicada se consulta por red y nunca se presenta como actual desde caché offline', async ({page, context}) => {
  await firstInstall(page);
  const version = await page.evaluate(async () => {
    const response = await fetch('/version.json', {cache:'no-store'});
    if (!response.ok) throw new Error('version response missing');
    return response.json();
  });
  expect(version).toBeTruthy();
  await context.setOffline(true);
  const unavailable = await page.evaluate(async () => {
    try {await fetch('/version.json', {cache:'no-store'}); return false;} catch {return true;}
  });
  expect(unavailable).toBe(true);
});
