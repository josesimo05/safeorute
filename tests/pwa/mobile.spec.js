import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';

for (const width of [320, 390, 768]) {
  test(`en móvil ${width}px el mapa queda visible y el planificador se puede plegar`, async ({page, context}) => {
    await page.setViewportSize({width, height: 844});
    await mockGeoapify(context);
    await page.goto('/');
    await expect(page.locator('.pwa-panel')).not.toHaveAttribute('open', '');
    const map = await page.locator('.map').boundingBox();
    expect(map.y).toBeLessThan(200);
    expect(map.height).toBeGreaterThanOrEqual(235);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', {name: 'Navegar', exact: true}).click();
    await page.getByRole('combobox', {name: 'Origen', exact: true}).fill('Parque Independencia');
    const option = page.getByRole('option').filter({hasText: 'Parque Independencia'});
    await expect(option).toBeVisible();
    const choice = await option.boundingBox();
    const panel = await page.locator('.panel-content').boundingBox();
    expect(choice.y).toBeGreaterThanOrEqual(panel.y);
    expect(choice.y + choice.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    expect(choice.y + choice.height).toBeLessThan(844 - 55);
    await option.click();
    await page.getByRole('combobox', {name: 'Destino', exact: true}).fill('Ágora Mall');
    await page.getByRole('option').filter({hasText: 'Ágora Mall'}).click();
    const previous = await page.locator('.map').boundingBox();
    await page.getByRole('button', {name: 'Ver mapa completo', exact: true}).click();
    await expect(page.locator('.panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    const expanded = await page.locator('.map').boundingBox();
    expect(expanded.height).toBeGreaterThan(previous.height + 80);
    expect(expanded.y).toBeLessThan(100);
    await expect(page.getByRole('combobox', {name: 'Origen', exact: true})).toBeHidden();
    await page.getByRole('button', {name: 'Mostrar planificador', exact: true}).click();
    await expect(page.getByRole('combobox', {name: 'Origen', exact: true})).toHaveValue('Parque Independencia, Santo Domingo');
    await expect(page.getByRole('combobox', {name: 'Destino', exact: true})).toHaveValue('Ágora Mall, Santo Domingo');
    await page.getByRole('button', {name: 'Buscar rutas', exact: true}).click();
    await expect(page.locator('.route-card')).toHaveCount(2);
    await page.getByRole('link', {name: 'Waze', exact: true}).scrollIntoViewIfNeeded();
    const link = await page.getByRole('link', {name: 'Waze', exact: true}).boundingBox();
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.y + link.height).toBeLessThan(844 - 55);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
