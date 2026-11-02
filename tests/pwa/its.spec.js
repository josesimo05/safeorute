import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

// Deliberate synthetic fixtures for UI lifecycle/freshness regression. The live
// Python→Node→React integration is checked separately without mocking /api/its.
function snapshot(at = Date.now()) {
  const received = new Date(at).toISOString();
  return {
    demo:true, cursor:'1', server_time:received, capabilities:{operator_review:false},
    cameras:[{camera_id:'cam-ui-test',source:{kind:'synthetic',mode:'demo',synthetic_speed_kmh:8,demonstration_label:'Escena sintética a 8 km/h'},location:{country:'DO',city:'Ubicación ilustrativa',latitude:18.4861,longitude:-69.9312}}],
    states:[{camera_id:'cam-ui-test',source_mode:'demo',stream_epoch:'fixture',received_at:received,capture_at:null,health:{status:'healthy',usable_for_analytics:true,usable_for_speed:true},speed_valid:true,mean_speed_kmh:8,count_valid:true,total_count:0,congestion:'denso',lanes:[{id:'lane-1',count:0,count_valid:true}]}],
    alerts:[{alert_id:'fixture-alert',camera_id:'cam-ui-test',source_mode:'demo',kind:'congestion_observed',status:'open',opened_at:received,observed:[{description:'Velocidad reducida persistente.',mean_speed_kmh:8,duration_seconds:30}],probable_causes:[{code:'undetermined',description:'Causa no determinada.',confidence_level:'bajo'}],recommended_action:'Revisar el contexto.'}],
  };
}

async function openIts(page) {
  await page.getByRole('button',{name:'Tráfico ITS',exact:true}).click();
  await expect(page.locator('.its-panel')).toBeVisible();
}

test('ITS se consulta solo al abrir su pestaña, conserva cero válido y separa las hipótesis', async ({page, context}) => {
  await page.setViewportSize({width:320,height:800});
  await mockGeoapify(context);
  const calls=[];
  await page.route('**/api/its', async route => {
    calls.push(route.request());
    await route.fulfill({json:snapshot(),headers:{'cache-control':'no-store'}});
  });
  await page.goto('/');
  await expect(page.locator('.its-panel')).toHaveCount(0);
  expect(calls).toHaveLength(0);
  await openIts(page);
  await expect(page.locator('.its-metrics dd').first()).toHaveText('8 km/h');
  await expect(page.locator('.its-metrics dd').nth(1)).toHaveText('0');
  await expect(page.locator('.its-demo-badge')).toHaveText('Demostración · datos sintéticos');
  await expect(page.locator('.its-alert')).toContainText('Observado');
  await expect(page.locator('.its-alert')).toContainText('Causa probable');
  await expect(page.locator('.its-alert')).toContainText('Causa no determinada.');
  await expect(page.locator('.its-alert')).toContainText('Baja');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(request=>new URL(request.url()).pathname==='/api/its'&&!request.headers().authorization&&!request.headers().cookie)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Explorar',exact:true}).click();
  await expect(page.locator('.its-panel')).toHaveCount(0);
});

test('repetir el mismo snapshot no rejuvenece métricas o alertas después de quince segundos', async ({page, context}) => {
  await mockGeoapify(context);
  const at=Date.now();
  await page.clock.install({time:new Date(at)});
  const data=snapshot(at);
  let calls=0;
  await page.route('**/api/its', async route => {
    calls++;
    await route.fulfill({json:data,headers:{date:new Date(at).toUTCString(),'cache-control':'no-store'}});
  });
  await page.goto('/');
  await openIts(page);
  await expect(page.locator('.its-metrics dd').first()).toHaveText('8 km/h');
  await page.clock.runFor(17000);
  await expect(page.locator('.its-metrics dd').first()).toHaveText('—');
  await expect(page.locator('.its-metrics dd').nth(1)).toHaveText('—');
  await expect(page.locator('.its-congestion')).toHaveText('No disponible');
  await expect(page.locator('.its-camera .its-warning')).toContainText('La falta de datos no significa tráfico detenido.');
  await expect(page.locator('.its-alert .its-warning')).toContainText('Observación vencida; estado actual desconocido.');
  expect(calls).toBeGreaterThanOrEqual(2);
});

test('un servicio no disponible y la desconexión se muestran sin métricas inventadas', async ({page, context}) => {
  await mockGeoapify(context);
  let calls=0;
  await page.route('**/api/its',route=>{calls++;return route.fulfill({status:503,json:{error:'its_unavailable'}});});
  await page.goto('/');
  await openIts(page);
  await expect(page.locator('.its-connection [role=status]')).toHaveText('Servicio ITS no disponible');
  await expect(page.locator('.its-camera')).toHaveCount(0);
  await expect(page.locator('.its-help').filter({hasText:'El alojamiento puede tardar'})).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator('.its-connection [role=status]')).toHaveText('Sin conexión a Internet');
  const before=calls;
  await page.waitForTimeout(9000);
  expect(calls).toBe(before);
  await context.setOffline(false);
  await expect.poll(()=>calls).toBeGreaterThan(before);
  await expect(page.locator('.its-camera')).toHaveCount(0);
});
