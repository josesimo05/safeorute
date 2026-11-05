import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firebaseSettings} from '../src/firebase-config.js';

test('la app usa el proyecto Firebase de SafeRoute sin variables adicionales', () => {
  const {cloud, config, mode} = firebaseSettings();
  assert.equal(cloud, true);
  assert.equal(mode, 'cloud');
  assert.equal(config.projectId, 'saferoute-f87c1');
  assert.equal(config.appId, '1:648220987452:web:0512d9c04e89f5488bf339');
  assert.equal(config.authDomain, 'saferoute-f87c1.firebaseapp.com');
  assert.equal('private_key' in config, false);
});

test('el modo demo no activa Firebase aunque existan variables del proyecto', () => {
  assert.deepEqual(firebaseSettings({VITE_DEMO_MODE: 'true', VITE_FIREBASE_PROJECT_ID: 'saferoute-f87c1'}), {mode:'demo', cloud:false, config:null, configurationError:''});
});

test('un proyecto alternativo usa su configuración completa y no mezcla credenciales', () => {
  const {cloud, config} = firebaseSettings({
    VITE_FIREBASE_API_KEY: ' another-public-web-key ',
    VITE_FIREBASE_AUTH_DOMAIN: 'other.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'other',
    VITE_FIREBASE_APP_ID: '1:123:web:other',
  });
  assert.equal(cloud, true);
  assert.equal(config.apiKey, 'another-public-web-key');
  assert.equal(config.projectId, 'other');
  const partial = firebaseSettings({VITE_FIREBASE_PROJECT_ID: 'other'});
  assert.equal(partial.cloud, false);
  assert.equal(partial.mode, 'invalid');
  assert.equal(partial.config, null);
  assert.equal(partial.configurationError, 'firebase/configuration-incomplete');
});

test('an incomplete or malformed override never silently selects local demonstration', () => {
  for(const env of [
    {VITE_FIREBASE_API_KEY:'public-key-only'},
    {VITE_FIREBASE_PROJECT_ID:'some-other-project'},
    {VITE_FIREBASE_APP_ID:123},
    {VITE_FIREBASE_AUTH_DOMAIN:true},
  ]) {
    const settings=firebaseSettings(env);
    assert.equal(settings.mode,'invalid');
    assert.equal(settings.cloud,false);
    assert.equal(settings.config,null);
  }
  assert.equal(firebaseSettings({VITE_DEMO_MODE:'false'}).mode,'cloud');
  assert.equal(firebaseSettings({VITE_FIREBASE_API_KEY:' ',VITE_FIREBASE_PROJECT_ID:''}).mode,'cloud');
});

test('normal production ignores a stale demo flag while explicit demo builds remain local', () => {
  const stale=firebaseSettings({MODE:'production',VITE_DEMO_MODE:'true'});
  assert.equal(stale.mode,'cloud');
  assert.equal(stale.cloud,true);
  assert.equal(stale.config.projectId,'saferoute-f87c1');
  assert.equal(firebaseSettings({MODE:'demo',VITE_DEMO_MODE:'false'}).mode,'demo');
  assert.equal(firebaseSettings({MODE:'development',VITE_DEMO_MODE:'true'}).mode,'demo');
  assert.equal(firebaseSettings({VITE_DEMO_MODE:'true'}).mode,'demo');
});

test('matching partial settings complete the built-in project but a mixed project remains invalid', () => {
  const known=firebaseSettings({MODE:'production',VITE_DEMO_MODE:'true',VITE_FIREBASE_PROJECT_ID:'saferoute-f87c1'});
  assert.equal(known.mode,'cloud');
  assert.equal(known.cloud,true);
  assert.equal(known.config.apiKey,'AIzaSyCiZ59lsOP-dPj_WEPa-v6h3CZQ74W0vf0');
  assert.equal(known.config.authDomain,'saferoute-f87c1.firebaseapp.com');
  const mixed=firebaseSettings({MODE:'production',VITE_FIREBASE_PROJECT_ID:'saferoute-f87c1',VITE_FIREBASE_API_KEY:'a-different-key'});
  assert.equal(mixed.mode,'invalid');
  assert.equal(mixed.cloud,false);
  assert.equal(mixed.config,null);
});
