import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firebaseErrorMessage} from '../src/firebase-errors.js';

test('el acceso deshabilitado distingue el envío invitado del acceso por correo', () => {
  for (const code of ['auth/admin-restricted-operation', 'auth/operation-not-allowed']) {
    assert.equal(firebaseErrorMessage({code}, {guest: true}), 'No está habilitado el envío como invitado. Inicia sesión o avisa al administrador.');
    assert.equal(firebaseErrorMessage({code}), 'El acceso por correo no está habilitado en esta app. Avisa al administrador.');
  }
});

test('los errores de configuración, datos y conexión indican una acción adecuada', () => {
  const cases = [
    ['auth/configuration-not-found', /Authentication.*administrador/],
    ['auth/invalid-api-key', /configuración.*administrador.*clave API/],
    ['auth/unauthorized-domain', /dominio.*administrador/],
    ['auth/email-already-in-use', /ya tiene una cuenta.*Inicia sesión/],
    ['auth/weak-password', /contraseña.*6 caracteres/],
    ['auth/invalid-email', /correo electrónico válido/],
    ['auth/too-many-requests', /Espera unos minutos/],
    ['auth/network-request-failed', /Revisa tu conexión/],
    ['unavailable', /Revisa tu conexión/],
    ['firestore/unavailable', /Revisa tu conexión/],
    ['permission-denied', /permiso.*reporte.*administrador/],
    ['firestore/permission-denied', /permiso.*reporte.*administrador/],
  ];
  for (const [code, expected] of cases) {
    assert.match(firebaseErrorMessage({code}), expected, code);
  }
});

test('los fallos de credenciales comparten el mismo mensaje', () => {
  const codes = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'];
  for (const code of codes) {
    assert.equal(firebaseErrorMessage({code}), 'El correo o la contraseña no son correctos. Revisa tus datos.');
  }
});

test('un error desconocido usa el texto seguro y no expone mensajes del servidor', () => {
  const sensitive = 'token=private-token; internal backend response';
  for (const error of [undefined, null, sensitive, new Error(sensitive), {code: 'auth/internal-error', message: sensitive, response: {body: sensitive}}]) {
    assert.equal(firebaseErrorMessage(error), 'No se pudo completar la operación. Inténtalo de nuevo.');
    assert.equal(firebaseErrorMessage(error, {fallback: 'No se pudo guardar el reporte.'}), 'No se pudo guardar el reporte.');
  }
  assert.equal(firebaseErrorMessage({code: 'auth/invalid-email', message: sensitive}), 'Introduce un correo electrónico válido.');
});
