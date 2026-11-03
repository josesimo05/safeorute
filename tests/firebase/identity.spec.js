import {test, expect} from '@playwright/test';

// Exercise the real Firebase client SDK with simulated HTTP responses only.
// The all-zero value is a synthetic fixture, not a citizen identity.
const syntheticIdentity = '00000000000';
const draft = 'Un obstáculo de prueba ocupa parte del carril derecho.';
const fixtureUid = 'guest-identity-browser-fixture';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const fixtureToken = `${encode({alg:'none', typ:'JWT'})}.${encode({
  aud:'saferoute-f87c1', iss:'https://securetoken.google.com/saferoute-f87c1',
  sub:fixtureUid, user_id:fixtureUid, auth_time:now, iat:now, exp:now + 3600,
  firebase:{identities:{}, sign_in_provider:'anonymous'},
})}.test-only-signature`;

async function mockedServices(page, context) {
  const calls = {gets:[], posts:[], signUps:0, firestoreWrites:[]};
  const replies = {
    configuration: async () => ({status:200, json:{guestIdentityEnabled:true}}),
    submission: async () => ({status:201, json:{id:'synthetic-private-report', status:'pending'}}),
  };
  page.on('request', request => {
    if (/firestore\.googleapis\.com.*(?:\/Write\/|documents:commit)/.test(request.url())) {
      calls.firestoreWrites.push(request.url());
    }
  });
  await context.route(/https:\/\/.*/, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:signUp')) {
      calls.signUps++;
      expect(route.request().postDataJSON()).toEqual({returnSecureToken:true});
      return route.fulfill({json:{
        kind:'identitytoolkit#SignupNewUserResponse', localId:fixtureUid,
        idToken:fixtureToken, refreshToken:'test-only-refresh-token', expiresIn:'3600',
      }});
    }
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:lookup')) {
      return route.fulfill({json:{users:[{
        localId:fixtureUid, createdAt:String(now * 1000), lastLoginAt:String(now * 1000),
      }]}});
    }
    return route.abort();
  });
  await context.route('http://127.0.0.1:4176/api/reports', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      calls.gets.push({url:request.url(), headers:request.headers(), body:request.postData()});
      const response = await replies.configuration();
      return route.fulfill(response).catch(() => {}); // Closing the form aborts this request.
    }
    calls.posts.push({url:request.url(), headers:request.headers(), body:request.postDataJSON()});
    return route.fulfill(await replies.submission());
  });
  await page.goto('/');
  await expect(page.locator('.mode')).toContainText('Comunidad · Firebase');
  return {calls, replies};
}

async function openReport(page) {
  await page.locator('.map').click({position:{x:170, y:150}});
  await expect(page.getByRole('dialog', {name:'Registra un incidente'})).toBeVisible();
  await page.getByLabel('Detalle opcional').fill(draft);
}

test('el invitado envía la cédula solo a la API privada y la borra al terminar', async ({page, context}) => {
  const {calls} = await mockedServices(page, context);
  await openReport(page);
  const identity = page.getByLabel('Cédula (solo para este envío)', {exact:true});
  await expect(identity).toBeVisible();
  await expect(identity).toHaveAttribute('autocomplete', 'off');
  await expect(page.getByText('Solo se guarda una huella protegida', {exact:false})).toBeVisible();
  await identity.fill(syntheticIdentity);
  await page.getByRole('button', {name:'Enviar a revisión', exact:true}).click();
  await expect(page.locator('.toast')).toContainText('Reporte enviado a revisión.');
  await expect(page.getByRole('dialog', {name:'Registra un incidente'})).toHaveCount(0);
  expect(calls.signUps).toBe(1);
  expect(calls.posts).toHaveLength(1);
  const sent = calls.posts[0];
  expect(sent.headers.authorization).toBe(`Bearer ${fixtureToken}`);
  expect(Object.keys(sent.body).sort()).toEqual(['cedula', 'report']);
  expect(sent.body.cedula).toBe(syntheticIdentity);
  expect(Object.keys(sent.body.report).sort()).toEqual(['category', 'description', 'lat', 'lng', 'occurredAt']);
  expect(sent.body.report.description).toBe(draft);
  expect(calls.firestoreWrites).toEqual([]);
  for (const request of calls.gets) {
    expect(request.url).toBe('http://127.0.0.1:4176/api/reports');
    expect(request.body).toBeNull();
    expect(request.headers.authorization).toBeUndefined();
  }
  const browserStorage = await page.evaluate(() => ({
    local:Object.entries(localStorage), session:Object.entries(sessionStorage),
  }));
  expect(JSON.stringify(browserStorage)).not.toContain(syntheticIdentity);
  await openReport(page);
  await expect(identity).toHaveValue('');
});

test('una configuración fallida o malformada bloquea el envío hasta comprobarla de nuevo', async ({page, context}) => {
  const {calls, replies} = await mockedServices(page, context);
  replies.configuration = async () => ({status:503, json:{error:'REPORTS_UNAVAILABLE'}});
  await openReport(page);
  const send = page.getByRole('button', {name:'Enviar a revisión', exact:true});
  const retry = page.getByRole('button', {name:'Reintentar comprobación', exact:true});
  await expect(retry).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(page.getByLabel('Cédula (solo para este envío)', {exact:true})).toHaveCount(0);
  replies.configuration = async () => ({status:200, json:{guestIdentityEnabled:'false'}});
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(send).toBeDisabled();
  expect(calls.signUps).toBe(0);
  expect(calls.posts).toEqual([]);
  expect(calls.firestoreWrites).toEqual([]);
  replies.configuration = async () => ({status:200, json:{guestIdentityEnabled:true}});
  await retry.click();
  await expect(page.getByLabel('Cédula (solo para este envío)', {exact:true})).toBeVisible();
  await expect(send).toBeEnabled();
  await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
});

test('un límite de la API conserva el borrador sin escribir directamente en Firestore', async ({page, context}) => {
  const {calls, replies} = await mockedServices(page, context);
  replies.submission = async () => ({status:429, json:{error:'REPORTS_RATE_LIMIT'}});
  await openReport(page);
  const identity = page.getByLabel('Cédula (solo para este envío)', {exact:true});
  await identity.fill(syntheticIdentity);
  await page.getByRole('button', {name:'Enviar a revisión', exact:true}).click();
  await expect(page.locator('.toast')).toContainText('Has alcanzado el límite temporal de reportes. Inténtalo más tarde.');
  await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
  await expect(identity).toHaveValue(syntheticIdentity);
  expect(calls.posts).toHaveLength(1);
  expect(calls.firestoreWrites).toEqual([]);
  await page.getByRole('button', {name:'Cerrar formulario', exact:true}).click();
  await openReport(page);
  await expect(identity).toHaveValue('');
});

test('al reabrir el formulario no reutiliza una configuración anterior ni una respuesta cancelada', async ({page, context}) => {
  const {calls, replies} = await mockedServices(page, context);
  replies.configuration = async () => ({status:200, json:{guestIdentityEnabled:false}});
  await openReport(page);
  const send = page.getByRole('button', {name:'Enviar a revisión', exact:true});
  await expect(send).toBeEnabled();
  await expect(page.getByLabel('Cédula (solo para este envío)', {exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Cerrar formulario', exact:true}).click();

  let releaseOldConfiguration;
  replies.configuration = () => new Promise(resolve => {
    releaseOldConfiguration = () => resolve({status:200, json:{guestIdentityEnabled:false}});
  });
  await openReport(page);
  await expect(send).toBeDisabled();
  await expect.poll(() => Boolean(releaseOldConfiguration)).toBe(true);
  await page.getByRole('button', {name:'Cerrar formulario', exact:true}).click();

  replies.configuration = async () => ({status:200, json:{guestIdentityEnabled:true}});
  await openReport(page);
  const identity = page.getByLabel('Cédula (solo para este envío)', {exact:true});
  await expect(identity).toBeVisible();
  releaseOldConfiguration();
  await expect(identity).toBeVisible();
  await expect(send).toBeEnabled();
  expect(calls.signUps).toBe(0);
  expect(calls.posts).toEqual([]);
  expect(calls.firestoreWrites).toEqual([]);
});
