import {test, expect} from '@playwright/test';
import {mockGeoapify} from './fixtures';
import {translateText} from '../../src/i18n.js';
import {getSupportArticles} from '../../src/support-content.js';

async function openHelp(page, language='es') {
  await page.getByRole('button',{name:translateText('Ayuda y soporte',language),exact:true}).click();
  await expect(page.locator('.support-dialog')).toBeVisible();
}

test('la ayuda funciona sin conexión, no consulta IA al leer FAQ y devuelve el foco al cerrar',async({page,context})=>{
  await page.setViewportSize({width:320,height:800});
  await mockGeoapify(context);
  const paidRequests=[];
  page.on('request',request=>{if(request.url().includes('/api/support'))paidRequests.push(request);});
  await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await openHelp(page);
  await expect(page.locator('.support-articles details')).toHaveCount(8);
  await context.setOffline(true);
  await page.locator('#support-search').fill('GPS');
  await page.locator('#support-article-gps summary').click();
  await expect(page.locator('#support-article-gps')).toContainText('HTTPS');
  await expect(page.locator('.support-warning').first()).toContainText('La IA necesita conexión');
  expect(paidRequests).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.support-dialog')).toHaveCount(0);
  await expect(page.locator('.support-launcher')).toBeFocused();
});

test('el modo demo no finge IA ni un contacto humano y permite copiar una consulta',async({page,context})=>{
  await mockGeoapify(context);
  await page.goto('/');
  await openHelp(page);
  await page.locator('#support-question').fill('¿Por qué el mapa no carga?');
  await page.getByRole('button',{name:'Preguntar a la IA',exact:true}).click();
  await expect(page.locator('.support-dialog [role=alert]')).toHaveText('La IA de ayuda no está disponible. Puedes consultar las preguntas frecuentes sin conexión.');
  await expect(page.locator('.support-answer')).toHaveCount(0);
  await expect(page.locator('.support-share a')).toHaveCount(0);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('clipboard not available'))}}));
  await page.getByRole('button',{name:'Copiar consulta',exact:true}).click();
  await expect(page.locator('.support-copy')).toHaveValue(/¿Por qué el mapa no carga\?/);
  await expect(page.locator('.support-copy')).toHaveValue(/Sin respuesta de IA/);
  await page.getByRole('button',{name:'Cerrar ayuda',exact:true}).click();
  await openHelp(page);
  await expect(page.locator('.support-turn')).toHaveCount(0);
  await expect(page.locator('#support-question')).toHaveValue('');
});

test('las FAQ cambian de idioma con la app sin perder el ancho móvil y el árabe usa RTL',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await mockGeoapify(context);
  await page.goto('/');
  for(const language of ['en','ar','zh']) {
    await page.locator('.preferences-button').click();
    await page.locator('#app-language').selectOption(language);
    await page.locator('.preferences-dialog .primary').click();
    await openHelp(page,language);
    await expect(page.locator('#support-article-install summary')).toHaveText(getSupportArticles(language)[0].question);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('dir',language==='ar'?'rtl':'ltr');
    await page.locator('.support-close').click();
  }
});
