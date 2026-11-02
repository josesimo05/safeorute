import test from 'node:test';
import assert from 'node:assert/strict';
import {getSupportArticles, safeSupportContactUrl} from '../src/support-content.js';

const ids = ['install','gps','routes','reports','account','map','its','privacy'];
const languages = ['es','en','fr','pt','de','it','ar','zh'];

test('offline support has eight stable topics fully localized in every supported language', () => {
  const spanish = getSupportArticles('es');
  for (const language of languages) {
    const articles = getSupportArticles(language);
    assert.deepEqual(articles.map(article=>article.id),ids);
    assert.equal(new Set(articles.map(article=>article.id)).size,8);
    for (const [index,article] of articles.entries()) {
      assert.equal(typeof article.question,'string');assert.ok(article.question.trim().length > 0);
      assert.equal(typeof article.answer,'string');assert.ok(article.answer.trim().length > 20);
      assert.ok(article.question.length < 220 && article.answer.length < 1000);
      if (language !== 'es') {
        assert.notEqual(article.question,spanish[index].question);
        assert.notEqual(article.answer,spanish[index].answer);
      }
      assert.doesNotMatch(article.question+' '+article.answer,/<\/?script|javascript:|-----BEGIN.*PRIVATE KEY|AIza/iu);
    }
  }
});

test('support locale variants normalize without depending on browser state', () => {
  assert.deepEqual(getSupportArticles('EN_us'),getSupportArticles('en'));
  assert.deepEqual(getSupportArticles(' pt-BR '),getSupportArticles('pt'));
  assert.deepEqual(getSupportArticles('zh-Hans'),getSupportArticles('zh'));
  for (const unsupported of [null,undefined,{},'xx','__proto__','constructor','']) {
    assert.deepEqual(getSupportArticles(unsupported),getSupportArticles('es'));
  }
});

test('support callers cannot modify the catalog used by other clients or the API', () => {
  const articles=getSupportArticles('en');
  const original=articles[0].answer;
  articles[0].answer='Modified by caller';articles[0].id='bad';articles.pop();
  assert.equal(getSupportArticles('en')[0].answer,original);
  assert.deepEqual(getSupportArticles('en').map(article=>article.id),ids);
});

test('included help distinguishes synthetic ITS and estimated routing from real traffic and emergencies', () => {
  const spanish=Object.fromEntries(getSupportArticles('es').map(article=>[article.id,article.answer]));
  assert.match(spanish.its,/8 km\/h/u);assert.match(spanish.its,/40 km\/h/u);assert.match(spanish.its,/30 segundos/u);
  assert.match(spanish.its,/no confirma accidentes/u);
  assert.match(spanish.routes,/no incluyen tráfico en tiempo real/u);
  assert.match(spanish.gps,/suspender el GPS/u);
  assert.match(spanish.reports,/pendiente de revisión/u);
  assert.match(spanish.privacy,/no atiende emergencias/u);
});

test('support contact accepts only explicit plain email and official WhatsApp destinations', () => {
  for (const url of ['mailto:help@example.com','mailto:team+help@example.co.do',
    'https://wa.me/18095551234','https://wa.me:443/18095551234',
    'https://api.whatsapp.com/send?phone=18095551234','https://web.whatsapp.com/send?phone=18095551234']) {
    assert.ok(safeSupportContactUrl(url),url);
  }
  assert.equal(safeSupportContactUrl(''),'');assert.equal(safeSupportContactUrl(null),'');
});

test('support contact rejects script URLs, spoofed hosts, credentials and hidden message recipients', () => {
  for (const url of ['javascript:alert(1)','data:text/html,hello','http://wa.me/18095551234',
    'https://wa.me.evil.test/18095551234','https://wa.me@evil.test/18095551234',
    'https://user:secret@wa.me/18095551234','https://example.com/help',
    'https://wa.me:444/18095551234','https://wa.me/18095551234#','https://wa.me/18095551234?',
    'https://wa.me/18095551234?text=private','https://api.whatsapp.com/send?phone=18095551234&text=private',
    'https://api.whatsapp.com/send?phone=18095551234&phone=19999999999',
    'mailto:help@example.com?bcc=other@example.com','mailto:help@example.com%0d%0aBcc:other@example.com',
    'mailto:help@example.com\nBcc:other@example.com','mailto:first@example.com,second@example.com',
    'mailto:help@example.com#fragment',' mailto:help@example.com','https://wa.me\\@evil.test/18095551234']) {
    assert.equal(safeSupportContactUrl(url),'',url);
  }
});
