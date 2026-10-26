import {test, expect} from '@playwright/test';

// Exercise the actual Firebase client SDK against simulated HTTP errors.
// No accounts or reports are created in the real project.
for (const backendMessage of ['ADMIN_ONLY_OPERATION', 'OPERATION_NOT_ALLOWED', 'CONFIGURATION_NOT_FOUND']) {
  test(`muestra la causa del fallo de invitado: ${backendMessage}`, async ({page, context}) => {
    let signUps = 0;
    const writes = [];
    page.on('request', request => {
      if (/firestore\.googleapis\.com.*(?:\/Write\/|documents:commit)/.test(request.url())) writes.push(request.url());
    });
    await context.route(/https:\/\/.*/, async route => {
      if (route.request().url().startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signUp')) {
        signUps++;
        expect(route.request().postDataJSON()).not.toHaveProperty('email');
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({error: {code: 400, message: backendMessage}}),
        });
      } else {
        await route.abort();
      }
    });
    await page.goto('/');
    await expect(page.locator('.mode')).toContainText('Comunidad · Firebase');
    await page.locator('.map').click({position: {x: 170, y: 150}});
    const detail = page.getByLabel('Detalle opcional');
    await detail.fill('La luminaria de la esquina no funciona desde ayer.');
    await page.getByRole('button', {name: 'Enviar a revisión', exact: true}).click();
    await expect(page.locator('.toast')).toContainText(backendMessage === 'CONFIGURATION_NOT_FOUND'
      ? 'Firebase Authentication no está configurado'
      : 'No está habilitado el envío como invitado.');
    await expect(detail).toHaveValue('La luminaria de la esquina no funciona desde ayer.');
    await expect(page.getByRole('button', {name: 'Enviar a revisión', exact: true})).toBeEnabled();
    expect(signUps).toBe(1);
    expect(writes).toEqual([]);
    await expect(page.locator('.toast')).not.toContainText('Reporte enviado a revisión.');
  });
}
