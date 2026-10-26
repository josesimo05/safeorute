import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firebaseSettings} from '../src/firebase-config.js';

test('la app usa el proyecto Firebase de SafeRoute sin variables adicionales', () => {
  const {cloud, config} = firebaseSettings();
  assert.equal(cloud, true);
  assert.equal(config.projectId, 'saferoute-f87c1');
  assert.equal(config.appId, '1:648220987452:web:0512d9c04e89f5488bf339');
  assert.equal(config.authDomain, 'saferoute-f87c1.firebaseapp.com');
  assert.equal('private_key' in config, false);
});

test('el modo demo no activa Firebase aunque existan variables del proyecto', () => {
  assert.deepEqual(firebaseSettings({VITE_DEMO_MODE: 'true', VITE_FIREBASE_PROJECT_ID: 'saferoute-f87c1'}), {cloud: false, config: null});
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
  assert.equal(partial.config.apiKey, '');
  assert.equal(partial.config.appId, '');
});
