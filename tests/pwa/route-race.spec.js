import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

test('cambiar el destino durante el cálculo descarta las rutas de la selección anterior', async ({page, context}) => {
  await mockGeoapify(context);
  let release;
  let requestsStarted;
  let count=0;
  const held=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{requestsStarted=resolve;});
  await page.route('**/v1/routing?**', async route=>{
    if(++count===2)requestsStarted();
    await held;
    await route.fulfill({json:{features:[{properties:{distance:1500,time:600},geometry:{type:'LineString',coordinates:[[-69.943,18.476],[-69.94,18.49]]}}]}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Navegar',exact:true}).click();
  await page.getByRole('combobox',{name:'Origen',exact:true}).fill('Parque Independencia');
  await page.getByRole('option').filter({hasText:'Parque Independencia'}).click();
  await page.getByRole('combobox',{name:'Destino',exact:true}).fill('Ágora Mall');
  await page.getByRole('option').filter({hasText:'Ágora Mall'}).click();
  await page.getByRole('button',{name:'Buscar rutas',exact:true}).click();
  await started;
  await page.getByRole('combobox',{name:'Destino',exact:true}).fill('Otro destino');
  const responses=['balanced','short'].map(preference=>page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==='/v1/routing'&&url.searchParams.get('type')===preference;
  }));
  release();
  await Promise.all((await Promise.all(responses)).map(response=>response.finished()));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('.route-card')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Waze',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Buscar rutas',exact:true})).toBeEnabled();
});
