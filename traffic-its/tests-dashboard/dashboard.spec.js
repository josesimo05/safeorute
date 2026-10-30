import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const staticRoot=fileURLToPath(new URL('../src/traffic_its/static/',import.meta.url));
function fixture() {
  const state={camera_id:'cam-demo',road_segment_id:'segment-demo',revision:1,source_mode:'demo',stream_epoch:'demo-epoch',media_time_s:12,capture_at:null,received_at:new Date().toISOString(),health:{status:'healthy'},calibration_status:'synthetic',speed_valid:false,mean_speed_kmh:null,congestion:'desconocido',lanes:[{id:'lane-1',count:3,count_valid:true,speed_valid:false,mean_speed_kmh:null,coverage_seconds:12,counts_by_class:{carro:2,moto:1}},{id:'lane-2',count:2,count_valid:true,speed_valid:false,mean_speed_kmh:null,coverage_seconds:12,counts_by_class:{guagua_bus:1,camion:1}}]};
  return {snapshot:{cameras:[{camera_id:'cam-demo',source:{kind:'synthetic',mode:'demo'},location:{latitude:18.48,longitude:-69.94}}],states:[state],alerts:[],cursor:'1',demo:true,server_time:new Date().toISOString()},state,history:[{camera_id:'cam-demo',lane_id:'lane-1',source_mode:'demo',window_start_media_s:0,duration_seconds:60,count:3,count_valid:true,mean_speed_kmh:null,speed_valid:false,coverage_seconds:12}]};
}
async function prepare(page,{requiresToken=false,alerts=[],initialEmpty=false}={}) {
  const data=fixture();data.snapshot.alerts=alerts;const registeredCameras=[...data.snapshot.cameras];if(initialEmpty){data.snapshot.cameras=[];data.snapshot.states=[];}
  const requests=[];
  await page.addInitScript(()=>{
    window.wsHandshakes=[];window.mockSockets=[];
    class MockWebSocket {
      constructor(){this.closed=false;window.mockSockets.push(this);setTimeout(()=>this.onopen?.(),0);}
      send(raw){window.wsHandshakes.push(JSON.parse(raw));this.onmessage?.({data:JSON.stringify({event_type:'stream.ready',cursor:'1'})});}
      close(){this.closed=true;this.onclose?.({code:1000});}
    }
    window.WebSocket=MockWebSocket;
    window.pushEvent=message=>window.mockSockets.at(-1).onmessage?.({data:JSON.stringify(message)});
  });
  await page.route('https://its.test/**',async route=>{
    const url=new URL(route.request().url());requests.push({path:url.pathname,authorization:route.request().headers().authorization});
    if(url.pathname.startsWith('/v1/')){
      if(requiresToken&&route.request().headers().authorization!=='Bearer test-operator-secret')return route.fulfill({status:401,json:{detail:'Unauthorized'}});
      if(url.pathname==='/v1/snapshot')return route.fulfill({json:data.snapshot});
      if(url.pathname==='/v1/cameras')return route.fulfill({json:{items:registeredCameras}});
      if(url.pathname==='/v1/metrics/history')return route.fulfill({json:{items:data.history}});
      return route.fulfill({status:404,json:{detail:'Not found'}});
    }
    const file=url.pathname==='/'?path.join(staticRoot,'index.html'):path.join(staticRoot,url.pathname.replace(/^\/static\//,''));
    const extension=path.extname(file);const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
    try{return route.fulfill({contentType:types[extension]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Not found'});}
  });
  await page.route(/https:\/\/(?!its\.test).*/,route=>route.abort());
  await page.goto('https://its.test/');
  return {...data,requests};
}

test('el dashboard móvil distingue datos sintéticos y velocidad no medible sin cargar imágenes de cámaras',async({page})=>{
  await page.setViewportSize({width:320,height:844});
  await prepare(page);
  await expect(page.locator('#source-banner')).toContainText('DEMOSTRACIÓN SINTÉTICA');
  await expect(page.locator('#speed-value')).toHaveText('—');
  await expect(page.locator('#count-value')).toHaveText('5');
  await expect(page.locator('#freshness-value')).toContainText('captura desconocida');
  await expect(page.locator('#lanes-body tr')).toHaveCount(2);
  await expect(page.locator('video,img')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
});

test('las revisiones de WebSocket no retroceden y los datos vencidos se muestran desconocidos',async({page})=>{
  const {state}=await prepare(page);
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
  const fresh={...state,revision:2,speed_valid:true,mean_speed_kmh:30,congestion:'fluido'};
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',event_id:'e2',entity_id:'cam-demo',revision:2,cursor:'2',payload}),fresh);
  await expect(page.locator('#speed-value')).toHaveText('30 km/h');
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',event_id:'e1',entity_id:'cam-demo',revision:1,cursor:'3',payload}),{...fresh,revision:1,mean_speed_kmh:80});
  await expect(page.locator('#speed-value')).toHaveText('30 km/h');
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',event_id:'e4',entity_id:'cam-demo',revision:4,cursor:'4',payload}),{...fresh,revision:4,received_at:new Date(Date.now()-60000).toISOString()});
  await expect(page.locator('#speed-value')).toHaveText('—');
  await expect(page.locator('#congestion-value')).toHaveText('Desconocida');
  await expect(page.locator('#source-banner')).toContainText('Datos vencidos');
});

test('la clave solo viaja por cabecera o primer mensaje WS y se elimina al cerrar el acceso',async({page})=>{
  const {requests,state}=await prepare(page,{requiresToken:true});
  await expect(page.locator('#access-panel')).toBeVisible();
  await page.locator('#api-token').fill('test-operator-secret');
  await page.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
  expect(requests.some(request=>request.path==='/v1/snapshot'&&request.authorization==='Bearer test-operator-secret')).toBe(true);
  expect(await page.evaluate(()=>window.wsHandshakes.at(-1).token)).toBe('test-operator-secret');
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  await expect(page.locator('#api-token')).toHaveValue('');
  expect(page.url()).not.toContain('secret');
  await page.getByRole('button',{name:'Acceso',exact:true}).click();
  await page.getByRole('button',{name:'Cerrar acceso',exact:true}).click();
  await expect(page.locator('#connection-label')).toHaveText('Acceso requerido');
  await expect(page.locator('#count-value')).toHaveText('—');
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',entity_id:'cam-demo',revision:9,cursor:'9',payload}),{...state,revision:9,mean_speed_kmh:100,speed_valid:true});
  await expect(page.locator('#speed-value')).toHaveText('—');
});

test('las alertas separan hechos e hipótesis y no interpretan HTML ni muestran URI privadas',async({page})=>{
  const alert={alert_id:'alert-1',camera_id:'cam-demo',status:'open',revision:1,title:'Calidad de cámara',created_at:new Date().toISOString(),observed:[{description:'<img src=x onerror=alert(1)> Sin imágenes desde rtsp://usuario:clave@privado/cam'}],probable_causes:[{description:'Motivo no determinado.',confidence_level:'bajo',criteria_met:['sin_nuevas_observaciones'],missing_evidence:['revisión_del_operador']}],recommended_action:'Revisar conectividad y cámara.'};
  await prepare(page,{alerts:[alert]});
  await expect(page.locator('.alert-card')).toContainText('Observado');
  await expect(page.locator('.alert-card')).toContainText('Causa probable');
  await expect(page.locator('.alert-card')).toContainText('Confianza: bajo');
  await expect(page.locator('.alert-card')).toContainText('[fuente privada]');
  await expect(page.locator('.alert-card img')).toHaveCount(0);
  await expect(page.locator('.alert-card')).not.toContainText('usuario:clave');
});

test('el histórico conserva ventanas relativas y una velocidad cero válida no se convierte en dato ausente',async({page})=>{
  const {state}=await prepare(page);
  await expect(page.locator('#history-body')).toContainText('Video: 0–60 s');
  await expect(page.locator('#history-body')).toContainText('12 / 60 s');
  await expect(page.locator('#history-body')).toContainText('Simulado');
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',entity_id:'cam-demo',revision:2,cursor:'2',payload}),{...state,revision:2,speed_valid:true,mean_speed_kmh:0,congestion:'detenido'});
  await expect(page.locator('#speed-value')).toHaveText('0 km/h');
  await expect(page.locator('#congestion-value')).toHaveText('Detenido');
});


test('una cámara que aparece después del arranque recupera su configuración y ubicación sin recargar',async({page})=>{
  const {state}=await prepare(page,{initialEmpty:true});
  await expect(page.locator('#camera-count')).toHaveText('0 cámaras');
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',entity_id:'cam-demo',revision:1,cursor:'1',payload}),state);
  await expect(page.locator('#camera-count')).toHaveText('1 cámara');
  await expect(page.locator('#map-caption')).toHaveText('1 ubicación configurada.');
  await expect(page.locator('#camera-select')).toHaveValue('cam-demo');
});

test('una fuente no disponible invalida las mediciones y un carril sin aforo válido no muestra cero',async({page})=>{
  const {state}=await prepare(page);
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
  const unavailable={...state,revision:2,speed_valid:true,mean_speed_kmh:30,congestion:'fluido',health:{status:'source_unavailable',usable_for_analytics:false}};
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',entity_id:'cam-demo',revision:2,cursor:'2',payload}),unavailable);
  await expect(page.locator('#health-value')).toHaveText('Fuente no disponible');
  await expect(page.locator('#speed-value')).toHaveText('—');
  await expect(page.locator('#count-value')).toHaveText('—');
  await expect(page.locator('#congestion-value')).toHaveText('Desconocida');
  const unconfigured={...state,revision:3,count_valid:false,lanes:state.lanes.map(lane=>({...lane,count_valid:false,count:0}))};
  await page.evaluate(payload=>window.pushEvent({event_type:'camera.state.updated',entity_id:'cam-demo',revision:3,cursor:'3',payload}),unconfigured);
  await expect(page.locator('#count-value')).toHaveText('—');
  await expect(page.locator('#lanes-body tr').first()).toContainText('No medible');
});

test('una alerta reconocida conserva la acción del operador y una alerta suprimida deja de mostrarse',async({page})=>{
  const alert={alert_id:'operator-alert',camera_id:'cam-demo',status:'open',revision:1,title:'Congestión observada',kind:'congestion_observed',observed:['Velocidad reducida persistente.']};
  await prepare(page,{requiresToken:true,alerts:[alert]});
  await page.locator('#api-token').fill('test-operator-secret');
  await page.getByRole('button',{name:'Conectar',exact:true}).click();
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
  await expect(page.getByRole('button',{name:'Reconocer',exact:true})).toBeVisible();
  await page.evaluate(payload=>window.pushEvent({event_type:'alert.updated',entity_id:payload.alert_id,revision:2,cursor:'2',payload}),{...alert,revision:2,acknowledged:true,review:{action:'acknowledge',at:new Date().toISOString()}});
  await expect(page.locator('.alert-card')).toContainText('Reconocida por un operador');
  await expect(page.getByRole('button',{name:'Reconocer',exact:true})).toHaveCount(0);
  await page.evaluate(payload=>window.pushEvent({event_type:'alert.updated',entity_id:payload.alert_id,revision:3,cursor:'3',payload}),{...alert,revision:3,suppressed:true,review:{action:'suppress'}});
  await expect(page.locator('.alert-card')).toHaveCount(0);
  await expect(page.locator('#alert-count')).toHaveText('0 activas');
});

test('la congestión abierta advierte observación vencida al pasar el tiempo sin resolver el episodio',async({page})=>{
  await page.clock.install();
  const alert={alert_id:'stale-alert',camera_id:'cam-demo',status:'open',revision:1,title:'Congestión observada',kind:'congestion_observed',observed:['Velocidad reducida persistente.']};
  await prepare(page,{alerts:[alert]});
  await expect(page.locator('#connection-label')).toHaveText('Conectado');
  await expect(page.locator('.alert-observation-stale')).toHaveCount(0);
  await page.clock.fastForward(21_000);
  await expect(page.locator('.alert-card')).toContainText('Observación vencida; estado actual desconocido.');
  await expect(page.locator('#alert-count')).toHaveText('1 activa');
  await expect(page.locator('#congestion-value')).toHaveText('Desconocida');
});
