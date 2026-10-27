import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

async function prepareNavigation(page,context) {
  await page.setViewportSize({width:390,height:844});
  const calls=await mockGeoapify(context);
  const requests=[];
  await page.route('**/v1/routing?**', route => {
    const url=new URL(route.request().url());
    requests.push(url.searchParams.get('waypoints'));
    const short=url.searchParams.get('type')==='short';
    const [from,to]=url.searchParams.get('waypoints').split('|').map(point=>point.split(',').map(Number).reverse());
    const middle=from[1]===18.476 ? short?[-69.942,18.482]:[-69.95,18.482] : [(from[0]+to[0])/2+(short?0:0.002),(from[1]+to[1])/2];
    return route.fulfill({json:{type:'FeatureCollection',features:[{
      type:'Feature',geometry:{type:'MultiLineString',coordinates:[[from,middle,to]]},
      properties:{distance:1500,time:600,legs:[{steps:[
        {from_index:0,to_index:1,distance:700,time:280,instruction:{text:'Sal del parque.'}},
        {from_index:1,to_index:2,distance:800,time:320,instruction:{text:short?'Gira por la calle corta.':'Sigue por la avenida.'}},
        {from_index:2,to_index:2,distance:0,time:0,instruction:{text:'Llegaste al centro comercial.'}},
      ]}]},
    }]}});
  });
  await page.addInitScript(() => {
    window.navigationWatches=[];
    window.clearedNavigationWatches=[];
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(success,error,options) {const id=window.navigationWatches.length+1;window.navigationWatches.push({id,success,error,options});return id;},
      clearWatch(id) {window.clearedNavigationWatches.push(id);},
      getCurrentPosition() {throw new Error('This flow must request GPS only after starting navigation.');},
    }});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Navegar',exact:true}).click();
  await page.locator('#origin').fill('Parque Independencia');
  await page.getByRole('option').filter({hasText:'Parque Independencia'}).click();
  await page.locator('#destination').fill('Ágora Mall');
  await page.getByRole('option').filter({hasText:'Ágora Mall'}).click();
  await page.getByRole('button',{name:'Buscar rutas',exact:true}).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  return {calls,requests};
}

async function sendFix(page,lat,lon,accuracy=8) {
  await page.waitForFunction(()=>window.navigationWatches.length > 0);
  await page.evaluate(({lat,lon,accuracy}) => {
    window.navigationWatches.at(-1).success({coords:{latitude:lat,longitude:lon,accuracy,heading:0,speed:4}});
    return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  },{lat,lon,accuracy});
}

test('la navegación GPS sigue la alternativa elegida dentro de SafeRoute y se detiene al salir',async({page,context})=>{
  const {requests}=await prepareNavigation(page,context);
  expect(await page.evaluate(()=>window.navigationWatches.length)).toBe(0);
  await page.locator('.route-card').nth(1).click();
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await expect(page.locator('.guidance-panel')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.navigationWatches.length)).toBe(1);
  await expect(page.locator('header')).toBeHidden();
  const map=await page.locator('.map').boundingBox();
  expect(map.y).toBeLessThan(2);
  expect(map.height).toBeGreaterThan(800);
  const stop=await page.getByRole('button',{name:'Detener navegación',exact:true}).boundingBox();
  expect(stop.y).toBeGreaterThanOrEqual(0);
  expect(stop.y+stop.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(()=>window.navigationWatches[0].options.enableHighAccuracy)).toBe(true);
  await sendFix(page,18.479,-69.9425);
  await expect(page.locator('.guidance-maneuver')).toContainText('Gira por la calle corta.');
  await expect(page.locator('.guidance-status')).toContainText('GPS activo');
  await expect(page.locator('.guidance-panel a[href*="maps"], .guidance-panel a[href*="waze"]')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await page.getByRole('button',{name:'Detener navegación',exact:true}).click();
  await expect(page.locator('.guidance-panel')).toHaveCount(0);
  await expect(page.locator('.route-card.selected')).toContainText('Más corta');
  expect(await page.evaluate(()=>window.clearedNavigationWatches)).toContain(1);
  await sendFix(page,18.49,-69.94);
  await expect(page.locator('.guidance-panel')).toHaveCount(0);
  await expect(page.locator('.route-card.selected')).toContainText('Más corta');
});

test('salirse de la ruta avisa sin sustituirla automáticamente y una mala precisión no declara llegada',async({page,context})=>{
  const {requests}=await prepareNavigation(page,context);
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await sendFix(page,18.50,-69.96);
  await expect(page.locator('.guidance-off-route')).toContainText('Te alejaste de la ruta seleccionada.');
  await expect(page.getByRole('button',{name:'Recalcular desde mi ubicación',exact:true})).toBeEnabled();
  expect(requests).toHaveLength(2);
  await sendFix(page,18.49,-69.94,300);
  await expect(page.locator('.guidance-accuracy')).toBeVisible();
  await expect(page.locator('.guidance-arrived')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await sendFix(page,18.49,-69.94,8);
  await expect(page.locator('.guidance-arrived')).toContainText('Has llegado al destino.');
  expect(await page.evaluate(()=>window.clearedNavigationWatches)).toContain(1);
});

test('denegar GPS conserva las indicaciones y permite volver al planificador',async({page,context})=>{
  await prepareNavigation(page,context);
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await page.waitForFunction(()=>window.navigationWatches.length > 0);
  await page.evaluate(()=>window.navigationWatches[0].error({code:1}));
  await expect(page.locator('.guidance-status')).toContainText('Ubicación no disponible');
  await expect(page.locator('.guidance-error')).toContainText('Permite el acceso a tu ubicación');
  await page.getByText('Revisar indicaciones',{exact:true}).click();
  await expect(page.locator('.guidance-instructions li')).toHaveCount(3);
  await expect(page.locator('.guidance-instructions')).toContainText('Sigue por la avenida.');
  expect(await page.evaluate(()=>window.clearedNavigationWatches)).toContain(1);
  await page.getByRole('button',{name:'Detener navegación',exact:true}).click();
  await expect(page.getByRole('button',{name:'Iniciar navegación',exact:true})).toBeVisible();
});

test('recalcular requiere una acción y conserva la preferencia de ruta sin reiniciar GPS',async({page,context})=>{
  const {requests}=await prepareNavigation(page,context);
  await page.locator('.route-card').nth(1).click();
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await sendFix(page,18.50,-69.96);
  await expect(page.locator('.guidance-off-route')).toBeVisible();
  expect(requests).toHaveLength(2);
  await page.getByRole('button',{name:'Recalcular desde mi ubicación',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(4);
  expect(requests.slice(2)).toEqual(['18.5,-69.96|18.49,-69.94','18.5,-69.96|18.49,-69.94']);
  await expect(page.locator('.guidance-off-route')).toHaveCount(0);
  await expect(page.locator('.guidance-panel')).toBeVisible();
  expect(await page.evaluate(()=>window.navigationWatches.length)).toBe(1);
  await page.getByRole('button',{name:'Detener navegación',exact:true}).click();
  await expect(page.locator('.route-card.selected')).toContainText('Más corta');
  await expect(page.locator('#origin')).toHaveValue('Mi ubicación');
});

test('la voz anuncia la distancia y el giro una vez por proximidad y se cancela al detener',async({page,context})=>{
  await page.addInitScript(()=>{
    window.voiceSpoken=[];
    window.voiceCancelled=0;
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class {constructor(text){this.text=text;this.lang='';}}});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
      speak(utterance){window.voiceSpoken.push({text:utterance.text,language:utterance.lang});},
      cancel(){window.voiceCancelled++;},
    }});
  });
  await prepareNavigation(page,context);
  await page.locator('.route-card').nth(1).click();
  await page.getByRole('button',{name:'Iniciar navegación',exact:true}).click();
  await sendFix(page,18.479,-69.9425);
  expect(await page.evaluate(()=>window.voiceSpoken)).toEqual([]);
  await page.getByRole('button',{name:'Activar voz',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.voiceSpoken.length)).toBe(2);
  const first=await page.evaluate(()=>window.voiceSpoken);
  expect(first[0].text).toContain('hasta la próxima indicación');
  expect(first[1]).toEqual({text:'Gira por la calle corta.',language:'es'});
  await sendFix(page,18.47902,-69.942497);
  expect(await page.evaluate(()=>window.voiceSpoken.length)).toBe(2);
  await sendFix(page,18.4818,-69.942033);
  await expect.poll(()=>page.evaluate(()=>window.voiceSpoken.length)).toBe(4);
  const near=await page.evaluate(()=>window.voiceSpoken.slice(2));
  expect(near[0].text).toContain('hasta la próxima indicación');
  expect(near[1].text).toBe('Gira por la calle corta.');
  await sendFix(page,18.48179,-69.942035);
  expect(await page.evaluate(()=>window.voiceSpoken.length)).toBe(4);
  await sendFix(page,18.482,-69.942,300);
  expect(await page.evaluate(()=>window.voiceSpoken.length)).toBe(4);
  const cancellations=await page.evaluate(()=>window.voiceCancelled);
  await page.getByRole('button',{name:'Detener navegación',exact:true}).click();
  expect(await page.evaluate(()=>window.voiceCancelled)).toBeGreaterThan(cancellations);
});

