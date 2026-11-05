import {test, expect} from '@playwright/test';

// The actual Firebase 13 client sends the credentials and handles responses.
// These fixtures exercise UI/transport after a simulated password reset; they
// do not change a real account or prove production-side password invalidation.
const fixtureUid = 'password-browser-fixture';
const fixtureEmail = 'password-fixture@example.invalid';
const previousPassword = 'test-only-previous-password';
const replacementPassword = 'test-only-replacement-password';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const fixtureToken = `${encode({alg:'none', typ:'JWT'})}.${encode({
  aud:'saferoute-f87c1', iss:'https://securetoken.google.com/saferoute-f87c1',
  sub:fixtureUid, user_id:fixtureUid, email:fixtureEmail, email_verified:true,
  auth_time:now, iat:now, exp:now + 3600,
  firebase:{identities:{email:[fixtureEmail]}, sign_in_provider:'password'},
})}.test-only-signature`;

test('un rechazo de la contraseña anterior permite reintentar y envía la nueva al SDK sin reutilizarla', async ({page, context}) => {
  const attempts = [];
  const firestoreWrites = [];
  page.on('request', request => {
    if (/firestore\.googleapis\.com.*(?:\/Write\/|documents:commit)/.test(request.url())) {
      firestoreWrites.push(request.url());
    }
  });
  // Intercept every external HTTPS request: no fixture credentials, tokens,
  // account lookup or Firestore operation can reach a production service.
  await context.route(/https:\/\/.*/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:signInWithPassword')) {
      const body = request.postDataJSON();
      attempts.push(body);
      expect(body.email).toBe(fixtureEmail);
      expect(body.returnSecureToken).toBe(true);
      if (body.password === previousPassword) {
        return route.fulfill({status:400, json:{error:{code:400, message:'INVALID_LOGIN_CREDENTIALS'}}});
      }
      expect(body.password).toBe(replacementPassword);
      return route.fulfill({json:{
        kind:'identitytoolkit#VerifyPasswordResponse', localId:fixtureUid,
        email:fixtureEmail, registered:true, displayName:'Password fixture',
        idToken:fixtureToken, refreshToken:'test-only-refresh-token', expiresIn:'3600',
      }});
    }
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:lookup')) {
      return route.fulfill({json:{users:[{
        localId:fixtureUid, email:fixtureEmail, emailVerified:true,
        createdAt:String(now * 1000), lastLoginAt:String(now * 1000),
        providerUserInfo:[{providerId:'password', email:fixtureEmail, federatedId:fixtureEmail}],
      }]}});
    }
    return route.abort();
  });

  await page.goto('/');
  await expect(page.locator('.mode')).toContainText('Reportes de la comunidad');
  await page.getByRole('button', {name:'Idioma y país', exact:true}).click();
  await page.getByRole('dialog', {name:'Idioma y país', exact:true})
    .getByRole('button', {name:'Entrar / Crear cuenta', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Qué bueno verte', exact:true});
  await dialog.locator('summary').filter({hasText:'Acceso con correo y contraseña'}).click();
  await dialog.getByLabel('Correo electrónico', {exact:true}).fill(fixtureEmail);
  const password = dialog.getByLabel('Contraseña', {exact:true});
  await password.fill(previousPassword);
  const signIn = dialog.getByRole('button', {name:'Iniciar sesión', exact:true});
  await signIn.click();

  await expect(dialog.getByRole('alert')).toHaveText('El correo o la contraseña no son correctos. Revisa tus datos.');
  await expect(dialog).toBeVisible();
  await expect(signIn).toBeEnabled();
  await expect(page.locator('.toast').filter({hasText:'Sesión iniciada.'})).toHaveCount(0);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].password).toBe(previousPassword);

  await password.fill(replacementPassword);
  await signIn.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.head-actions .account-button')).toContainText(fixtureEmail);
  await expect(page.locator('.toast')).toContainText('Sesión iniciada.');
  expect(attempts).toHaveLength(2);
  expect(attempts.map(attempt => attempt.password)).toEqual([previousPassword, replacementPassword]);
  expect(firestoreWrites).toEqual([]);
  const browserStorage = await page.evaluate(() => ({
    local:Object.entries(localStorage), session:Object.entries(sessionStorage),
  }));
  for (const value of [previousPassword, replacementPassword]) {
    expect(JSON.stringify(browserStorage)).not.toContain(value);
  }
});
