import {test, expect} from '@playwright/test';

test.beforeEach(async ({page, context}) => {
  // Exercise the real demo store; neither maps nor Firebase need network access.
  await context.route(/https:\/\/.*/, route => route.abort());
  await page.addInitScript(() => {
    window.reportingLocationRequests = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success, error) {
          window.reportingLocationRequests.push({success, error});
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Tu ciudad, con más contexto.'})).toBeVisible();
});

async function resolvePosition(page, index, {lat = 40.785091, lng = -73.968285, denied = false} = {}) {
  await expect.poll(() => page.evaluate(() => window.reportingLocationRequests.length)).toBeGreaterThan(index);
  await page.evaluate(({index, lat, lng, denied}) => {
    const request = window.reportingLocationRequests[index];
    if (denied) request.error({code: 1, message: 'Denied'});
    else request.success({coords: {latitude: lat, longitude: lng, accuracy: 8}});
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, {index, lat, lng, denied});
}

async function reportAtMapPoint(page, x = 170, y = 150) {
  await page.locator('.map').click({position: {x, y}});
  const dialog = page.getByRole('dialog', {name: 'Registra un incidente', exact: true});
  await expect(dialog).toBeVisible();
  return dialog;
}

async function savedReports(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('saferoute-demo-v1') || '[]'));
}

test('Mi ubicación centra y marca sin abrir un reporte; tocar el mapa sí inicia uno', async ({page}) => {
  await page.getByRole('button', {name: '◎ Mi ubicación', exact: true}).click();
  await resolvePosition(page, 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const marker = page.locator('.current-location-marker');
  await expect(marker).toHaveCount(1);
  await expect.poll(async () => {
    const mapBox = await page.locator('.map').boundingBox();
    const markerBox = await marker.boundingBox();
    if (!mapBox || !markerBox) return Infinity;
    return Math.hypot(
      markerBox.x + markerBox.width / 2 - mapBox.x - mapBox.width / 2,
      markerBox.y + markerBox.height / 2 - mapBox.y - mapBox.height / 2,
    );
  }).toBeLessThan(3);
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  await expect(page.locator('.location-value')).toHaveText('No seleccionada');
  await page.getByRole('button', {name: 'Cerrar formulario', exact: true}).click();
  const dialog = await reportAtMapPoint(page);
  await expect(dialog.locator('.location-value')).not.toHaveText('No seleccionada');
});

test('Usar mi ubicación en el reporte asigna coordenadas aproximadas y conserva el detalle', async ({page}) => {
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  const detail = page.getByLabel('Detalle opcional');
  const draft = 'Un semáforo permanece apagado en esta intersección.';
  await detail.fill(draft);
  await page.getByRole('button', {name: 'Usar mi ubicación', exact: true}).click();
  await resolvePosition(page, 0);
  await expect(page.locator('.location-value')).toHaveText('40.785, -73.968');
  await expect(detail).toHaveValue(draft);
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('una respuesta GPS tardía no reabre el formulario ni reemplaza un punto elegido después', async ({page}) => {
  await page.getByRole('button', {name: '＋ Reportar', exact: true}).click();
  const draft = 'El incidente debe conservar la ubicación que yo elija.';
  await page.getByLabel('Detalle opcional').fill(draft);
  await page.getByRole('button', {name: 'Usar mi ubicación', exact: true}).click();
  await page.getByRole('button', {name: 'Cerrar formulario', exact: true}).click();
  await resolvePosition(page, 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await reportAtMapPoint(page);
  await page.getByLabel('Detalle opcional').fill(draft);
  await page.getByRole('button', {name: 'Usar mi ubicación', exact: true}).click();
  await page.getByRole('button', {name: 'Elegir en el mapa', exact: true}).click();
  await reportAtMapPoint(page, 220, 190);
  const chosenPoint = await page.locator('.location-value').textContent();
  await resolvePosition(page, 1);
  await expect(page.locator('.location-value')).toHaveText(chosenPoint);
  await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
});

test('prevalece la última solicitud GPS y un permiso denegado no altera el reporte', async ({page}) => {
  await reportAtMapPoint(page);
  const draft = 'Detalle ciudadano que no se debe perder por un error de GPS.';
  await page.getByLabel('Detalle opcional').fill(draft);
  const useLocation = page.getByRole('button', {name: 'Usar mi ubicación', exact: true});
  await useLocation.click();
  await useLocation.click();
  await resolvePosition(page, 1, {lat: 18.476321, lng: -69.943876});
  await resolvePosition(page, 0);
  await expect(page.locator('.location-value')).toHaveText('18.476, -69.944');
  await useLocation.click();
  await resolvePosition(page, 2, {denied: true});
  await expect(page.locator('.toast')).toContainText('No se pudo obtener tu ubicación.');
  await expect(page.locator('.location-value')).toHaveText('18.476, -69.944');
  await expect(page.getByLabel('Detalle opcional')).toHaveValue(draft);
});

test('cambiar de país o sección descarta las ubicaciones GPS anteriores', async ({page}) => {
  const locate = page.getByRole('button', {name: '◎ Mi ubicación', exact: true});
  await locate.click();
  await page.getByRole('button', {name: 'Navegar', exact: true}).click();
  await resolvePosition(page, 0);
  await expect(page.locator('.current-location-marker')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: 'Explorar', exact: true}).click();
  await locate.click();
  await page.getByRole('button', {name: 'Idioma y país', exact: true}).click();
  await page.locator('#search-country').selectOption('us');
  await page.getByRole('button', {name: 'Guardar preferencias', exact: true}).click();
  await resolvePosition(page, 1, {denied: true});
  await expect(page.locator('.current-location-marker')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast').filter({hasText:'No se pudo obtener tu ubicación.'})).toHaveCount(0);
});

test('el reporte presenta una sola selección de categorías y cambiarla conserva lo escrito', async ({page}) => {
  const dialog = await reportAtMapPoint(page);
  const choices = dialog.locator('.quick-choices');
  await expect(choices.getByRole('button')).toHaveCount(6);
  await expect(dialog.getByRole('combobox', {name: 'Categoría', exact: true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'Sugerir categoría', exact: true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'Analizar con IA', exact: true})).toHaveCount(0);
  const draft = 'Un objeto bloquea parcialmente el acceso a esta calle.';
  await dialog.getByLabel('Detalle opcional').fill(draft);
  await choices.getByRole('button', {name: 'Bache', exact: true}).click();
  await expect(choices.getByRole('button', {name: 'Bache', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Detalle opcional')).toHaveValue(draft);
  await choices.getByRole('button', {name: 'Otro', exact: true}).click();
  await expect(choices.getByRole('button', {name: 'Otro', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(dialog.getByLabel('Tipo de incidente (opcional)', {exact: true})).toHaveAttribute('maxlength', '60');
  await expect(dialog.getByLabel('Detalle opcional')).toHaveValue(draft);
});

test('Otro acepta un tipo libre sin detalle y permite otro incidente distinto en el mismo lugar', async ({page}) => {
  const submitOther = async label => {
    const dialog = await reportAtMapPoint(page);
    await dialog.locator('.quick-choices').getByRole('button', {name: 'Otro', exact: true}).click();
    await dialog.getByLabel('Tipo de incidente (opcional)', {exact: true}).fill(label);
    await dialog.getByRole('button', {name: 'Enviar a revisión', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Reporte enviado a revisión.');
  };
  await submitOther('Semáforo averiado');
  await submitOther('Árbol caído');
  const pending = (await savedReports(page)).filter(report => report.status === 'pending');
  expect(pending).toHaveLength(2);
  expect(pending.map(report => report.category)).toEqual(['Otro', 'Otro']);
  expect(pending.map(report => report.description)).toEqual([
    'Árbol caído: Reporte comunitario.',
    'Semáforo averiado: Reporte comunitario.',
  ]);
  await page.getByRole('button', {name: 'Moderación', exact: true}).click();
  const report = page.locator('.moderation article').filter({hasText: 'Semáforo averiado: Reporte comunitario.'});
  await report.getByRole('button', {name: 'Aprobar', exact: true}).click();
  await page.getByRole('button', {name: 'Explorar', exact: true}).click();
  await expect(page.locator('.report').filter({hasText: 'Semáforo averiado: Reporte comunitario.'})).toHaveCount(1);
});

test('Otro permite describir un incidente libre sin inventar una categoría ni usar palabras clave', async ({page}) => {
  const dialog = await reportAtMapPoint(page);
  await dialog.locator('.quick-choices').getByRole('button', {name: 'Otro', exact: true}).click();
  const description = 'Una tubería rota está derramando agua sobre la acera.';
  await dialog.getByLabel('Detalle opcional').fill(description);
  await dialog.getByRole('button', {name: 'Enviar a revisión', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Reporte enviado a revisión.');
  const pending = (await savedReports(page)).find(report => report.status === 'pending');
  expect(pending.category).toBe('Otro');
  expect(pending.description).toBe(description);
});
