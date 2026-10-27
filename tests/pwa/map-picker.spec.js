import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

for (const width of [320,390]) {
  test(`la selección por mapa en ${width}px usa toda la pantalla y requiere confirmar el punto`, async ({page, context}) => {
    await page.setViewportSize({width,height:844});
    await mockGeoapify(context);
    await page.goto('/');
    await page.getByRole('button', {name:'Navegar',exact:true}).click();
    await page.locator('#planner-country').selectOption('do');
    const origin = page.locator('#origin');
    await page.getByRole('button', {name:'Elegir Origen en mapa',exact:true}).click();
    await expect(page.locator('.route-picking')).toBeVisible();
    await expect(page.locator('.picker-crosshair')).toBeVisible();
    await expect(page.locator('header')).toBeHidden();
    const map = await page.locator('.map').boundingBox();
    expect(map.y).toBeLessThan(2);
    expect(map.height).toBeGreaterThan(800);
    const confirm = page.getByRole('button', {name:'Confirmar origen',exact:true});
    const control = await confirm.boundingBox();
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.y + control.height).toBeLessThanOrEqual(844);
    await page.locator('.map').click({position:{x:width / 2 - 35,y:320}});
    await expect(page.locator('.map-picker')).toBeVisible();
    await expect(page.locator('.start-pin')).toHaveCount(0);
    await confirm.click();
    await expect(page.locator('.map-picker')).toHaveCount(0);
    await expect(origin).toHaveValue('Punto seleccionado en el mapa');
    await expect(page.locator('.start-pin')).toHaveCount(1);
    await page.getByRole('button', {name:'Elegir Destino en mapa',exact:true}).click();
    await page.locator('.map').click({position:{x:width / 2 + 25,y:350}});
    await page.getByRole('button', {name:'Cancelar selección',exact:true}).click();
    await expect(page.locator('.end-pin')).toHaveCount(0);
    await expect(page.locator('#destination')).toHaveValue('');
    await expect(origin).toHaveValue('Punto seleccionado en el mapa');
    await page.getByRole('button', {name:'Elegir Destino en mapa',exact:true}).click();
    await page.getByRole('button', {name:'Confirmar destino',exact:true}).click();
    await expect(page.locator('.end-pin')).toHaveCount(1);
    await expect(page.locator('#destination')).toHaveValue('Punto seleccionado en el mapa');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

