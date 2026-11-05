import {test, expect} from '@playwright/test';

// The real Firebase 13 browser SDK handles the provider, origin validation,
// popup lifecycle and errors. Only the external gapi iframe transport, window
// handle and HTTP project configuration are simulated. No Google credentials,
// authentication tokens, real accounts or production writes are involved.
async function mockOAuthTransport(page, context, {blocked = false, authorized = true} = {}) {
  const writes = [];
  page.on('request', request => {
    if (/firestore\.googleapis\.com.*(?:\/Write\/|documents:commit)/.test(request.url())) writes.push(request.url());
  });
  await context.route(/https:\/\/.*/, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname === '/v1/projects') {
      return route.fulfill({json:{authorizedDomains:authorized ? ['127.0.0.1'] : []}});
    }
    return route.abort();
  });
  await page.addInitScript(({blocked}) => {
    let authEvent;
    const popup = {closed:false, focus() {}, close() {this.closed = true;}};
    window.__oauthFixture = {
      opened:[], popup,
      emitError(code) {
        const url = new URL(this.opened.at(-1));
        return authEvent({authEvent:{
          type:'signInViaPopup', eventId:url.searchParams.get('eventId'),
          error:{code, message:'private-test-detail-must-not-be-displayed'},
        }});
      },
    };
    const iframe = {
      async restyle() {},
      ping(callback) {callback(); return Promise.resolve();},
      register(name, handler) {if (name === 'authEvent') authEvent = handler;},
      // Leaving this callback pending avoids emulating storage capabilities
      // beyond what these failed/cancelled authentication cases require.
      send() {},
    };
    window.gapi = {iframes:{
      Iframe:function () {}, CROSS_ORIGIN_IFRAMES_FILTER:() => true,
      getContext:() => ({open:(_options, callback) => callback(iframe)}),
    }};
    window.open = url => {
      window.__oauthFixture.opened.push(url);
      return blocked ? null : popup;
    };
  }, {blocked});
  await page.goto('/');
  await expect(page.locator('.mode')).toContainText('Reportes de la comunidad');
  // Account entry in preferences remains available when the narrow header
  // hides the longer account label to preserve room for map controls.
  await page.getByRole('button', {name:'Idioma y país', exact:true}).click();
  await page.getByRole('dialog', {name:'Idioma y país', exact:true})
    .getByRole('button', {name:'Entrar / Crear cuenta', exact:true}).click();
  return {writes, dialog:page.getByRole('dialog', {name:'Qué bueno verte', exact:true})};
}

test('el acceso móvil presenta Gmail y conserva correo/contraseña plegado, sin Apple', async ({page, context}) => {
  await page.setViewportSize({width:390, height:844});
  const {dialog, writes} = await mockOAuthTransport(page, context);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Continuar con Gmail', exact:true})).toHaveCount(1);
  await expect(dialog.getByRole('button', {name:/Apple|Continuar con Google/})).toHaveCount(0);
  await expect(dialog.getByLabel('Correo electrónico', {exact:true})).not.toBeVisible();
  await expect(dialog.getByLabel('Contraseña', {exact:true})).not.toBeVisible();
  await dialog.locator('summary').filter({hasText:'Acceso con correo y contraseña'}).click();
  await expect(dialog.getByLabel('Correo electrónico', {exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Contraseña', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('el SDK detecta una ventana bloqueada y permite reintentar Gmail', async ({page, context}) => {
  const {dialog, writes} = await mockOAuthTransport(page, context, {blocked:true});
  await dialog.getByRole('button', {name:'Continuar con Gmail', exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('El navegador bloqueó el acceso.');
  await expect(dialog.getByRole('button', {name:'Continuar con Gmail', exact:true})).toBeEnabled();
  const opened = await page.evaluate(() => window.__oauthFixture.opened);
  expect(opened).toHaveLength(1);
  const url = new URL(opened[0]);
  expect(url.hostname).toBe('saferoute-f87c1.firebaseapp.com');
  expect(url.pathname).toBe('/__/auth/handler');
  expect(url.searchParams.get('providerId')).toBe('google.com');
  expect(url.searchParams.get('authType')).toBe('signInViaPopup');
  expect(JSON.parse(url.searchParams.get('customParameters'))).toEqual({prompt:'select_account'});
  expect(writes).toEqual([]);
});

test('cerrar la ventana cancela el acceso sin cerrar el diálogo ni mostrar éxito', async ({page, context}) => {
  const {dialog, writes} = await mockOAuthTransport(page, context);
  await dialog.getByRole('button', {name:'Continuar con Gmail', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__oauthFixture.opened.length)).toBe(1);
  await page.evaluate(() => {window.__oauthFixture.popup.closed = true;});
  await expect(dialog.getByRole('alert')).toContainText('Se canceló el inicio de sesión.', {timeout:16_000});
  await expect(dialog.getByRole('button', {name:'Continuar con Gmail', exact:true})).toBeEnabled();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.toast').filter({hasText:'Sesión iniciada.'})).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('el error del proveedor deshabilitado se muestra sin detalles privados del iframe', async ({page, context}) => {
  const {dialog, writes} = await mockOAuthTransport(page, context);
  await dialog.getByRole('button', {name:'Continuar con Gmail', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__oauthFixture.opened.length)).toBe(1);
  await page.evaluate(() => window.__oauthFixture.emitError('auth/operation-not-allowed'));
  await expect(dialog.getByRole('alert')).toHaveText('El acceso con Gmail no está habilitado. Avisa al administrador.');
  await expect(dialog).not.toContainText('private-test-detail-must-not-be-displayed');
  await expect(dialog.getByRole('button', {name:'Continuar con Gmail', exact:true})).toBeEnabled();
  expect(writes).toEqual([]);
});

test('la validación real del SDK informa si el dominio no está autorizado', async ({page, context}) => {
  const {dialog, writes} = await mockOAuthTransport(page, context, {authorized:false});
  await dialog.getByRole('button', {name:'Continuar con Gmail', exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Este dominio no está autorizado para iniciar sesión. Avisa al administrador para habilitarlo.');
  await expect(dialog.getByRole('button', {name:'Continuar con Gmail', exact:true})).toBeEnabled();
  expect(writes).toEqual([]);
});
