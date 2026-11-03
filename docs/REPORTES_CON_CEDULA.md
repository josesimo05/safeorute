# Reportes invitados con cédula: activación gradual

Esta función está implementada pero **apagada por defecto**. No cambia el envío actual sin cuenta hasta que el operador complete la configuración del servidor y active la política de Firestore. No hay conexión con la Junta Central Electoral ni con sistemas institucionales.

La cédula se comprueba únicamente como una secuencia de once dígitos; se admiten espacios y guiones al escribirla. **No verifica titularidad, vigencia, existencia ni identidad del ciudadano.** Una persona podría introducir el número de otra. No sustituye una cuenta, una verificación de identidad ni la autenticación de autoridades.

## Qué se conserva

- `reports/{id}` conserva exactamente los ocho campos actuales: `category`, `description`, `lat`, `lng`, `occurredAt`, `status`, `source`, `createdAt`. El servidor fuerza `pending`, `community` y coordenadas con tres decimales. No añade cédula, huella ni referencia de identidad.
- `submissionLimits/{uid}` conserva el control por sesión anónima existente: `at`, `lastReport`. Hay un intervalo mínimo de sesenta segundos.
- `guestIdentityLimits/{huella}` conserva únicamente `day`, `at`, `count`, `expiresAt`. La huella es HMAC-SHA-256 con una clave privada independiente, dominio de uso y día UTC. La misma cédula produce otra huella al cambiar el día. Límite: diez reportes por día UTC y sesenta segundos entre reportes, también al cambiar de dispositivo.
- El número completo existe transitoriamente en memoria del navegador y del servidor durante el envío HTTPS. Este código no lo escribe en Firestore, almacenamiento local, registros de aplicación, URL ni respuestas de API. Revisa también las herramientas externas de analítica, captura de errores y registros de infraestructura: no deben registrar cuerpos de este endpoint ni campos del formulario.

La huella es un dato **seudónimo**, no una garantía de anonimato. El administrador del servidor controla la clave y el tratamiento de estos datos. Debe definir finalidad, aviso al ciudadano, responsable, acceso y retención antes de activar la recogida real. Las cuotas reducen envíos repetidos; no comprueban la veracidad de un incidente ni evitan todos los abusos.

## Contrato HTTP

`GET /api/reports` no necesita autenticación y siempre usa `Cache-Control: no-store`:

```json
{"guestIdentityEnabled": false}
```

Con `REPORT_GUEST_ID_ENABLED` ausente o igual a `false`, responde así sin acceder a Firebase. Una instancia configurada como activa responde `true` únicamente si puede comprobar la política privada. Una configuración incompleta, una política inactiva o un fallo de lectura producen `503`; el cliente no debe interpretar ese fallo como permiso para omitir la cédula.

`POST /api/reports` requiere `Content-Type: application/json`, `Authorization: Bearer <token de Firebase Auth anónimo>` y cuerpo de hasta 8192 bytes:

```json
{
  "report": {
    "category": "Otro",
    "description": "Semáforo averiado: no enciende en la intersección.",
    "lat": 18.476,
    "lng": -69.943,
    "occurredAt": "2026-01-01T12:00:00.000Z"
  },
  "cedula": "<once dígitos introducidos por el ciudadano>"
}
```

No se aceptan campos adicionales. El token se verifica en el servidor con comprobación de revocación y debe tener proveedor `anonymous`. Las cuentas registradas siguen el flujo existente; la cédula no inicia una sesión institucional.

Solo después de confirmar la transacción atómica responde `201`:

```json
{"id": "<id del reporte>", "status": "pending"}
```

Los errores no devuelven el número, el token ni detalles de credenciales:

| Estado | Código |
|---|---|
| 400 | `REPORTS_INVALID_REQUEST` |
| 401 | `REPORTS_AUTH_REQUIRED` |
| 405 | `REPORTS_INVALID_REQUEST` |
| 413 | `REPORTS_BODY_TOO_LARGE` |
| 429 | `REPORTS_RATE_LIMIT` |
| 503 | `REPORTS_NOT_CONFIGURED` o `REPORTS_UNAVAILABLE` |

Las cuotas, el reporte y su límite de sesión se escriben en una sola transacción. Si falla una parte no se crea el reporte. La política se comprueba otra vez dentro de la transacción, para respetar una desactivación concurrente. Los límites se recalculan en cada reintento, incluso si cambia el día UTC.

El servidor valida el cuerpo y la sesión antes de consultar Firestore en un POST. El GET público activo consulta la política en cada petición: se evita una caché positiva para respetar la desactivación sin un intervalo de datos desfasados. Antes de habilitarlo al público, configurar protección de tasa en la infraestructura para `/api/reports`, incluyendo el GET, y comprobar sus costes y disponibilidad según el plan contratado. Las cuotas por identidad del POST no limitan las lecturas del GET ni sustituyen esa protección.

## Activación en producción

1. Designar al responsable del tratamiento y aprobar el aviso y la retención del piloto. Acordar quién administra el proyecto Firebase. Esto sigue pendiente; no se ha habilitado la recogida de documentos reales.
2. Desplegar primero el código y las reglas de Firestore actualizadas, conservando desactivados tanto la política como el indicador del servidor. Las colecciones privadas no deben permitir lecturas ni escrituras desde clientes públicos.
3. Configurar en el servidor `FIREBASE_SERVICE_ACCOUNT_JSON` con una cuenta vigente del proyecto correcto. No usar variables `VITE_` para credenciales ni reutilizar una clave privada que se haya compartido públicamente o por chat. La credencial requiere los permisos mínimos para verificar sesiones y ejecutar estas transacciones; revisar IAM con el administrador del proyecto.
4. Crear una clave aleatoria independiente para `REPORT_ID_HMAC_KEY` de al menos 32 bytes, por ejemplo mediante `openssl rand -hex 32`. Guardarla como secreto del servidor en Vercel. No pegarla en el repositorio, navegador o chat. Su rotación cambia las huellas y reinicia en la práctica la agrupación de cuotas; documentar y restringir la operación.
5. Configurar `REPORT_GUEST_ID_ENABLED=true` **solo en el servidor**. Crear mediante consola o Admin SDK el documento privado `systemPolicies/reporting` con `requireGuestIdentity: true`. Hacer ambos cambios durante una ventana de activación: mientras solo uno esté activo, los envíos invitados pueden quedar temporalmente bloqueados. El backend no se declara listo hasta que los dos coincidan.
6. Verificar que `GET /api/reports` devuelve `true`, que el formulario solicita el dato en el paso privado y que el envío produce un reporte pendiente sin cédula. Un intento de escritura anónima directa a `reports` debe ser rechazado por las reglas cuando la política exige identidad. Comprobar tanto el flujo nuevo como una pestaña de una versión anterior.
7. Configurar y comprobar una política TTL para el campo `expiresAt` del grupo de colecciones `guestIdentityLimits`. El campo por sí solo **no borra documentos**. Su valor es el inicio del día UTC de creación más dos días: entre 24 y 48 horas desde el envío; la eliminación efectiva de Firestore es asíncrona. Si TTL aún no está operativo, establecer un procedimiento de borrado y verificarlo; no afirmar que existe retención automática.
8. Probar cuotas, errores y recuperación con datos de prueba autorizados antes de invitar a ciudadanos. No habilitar acceso institucional con esta funcionalidad: requiere el panel, roles y MFA de su propia fase.

Para volver temporalmente al flujo anterior, cambiar primero `systemPolicies/reporting.requireGuestIdentity` a `false` y después desactivar `REPORT_GUEST_ID_ENABLED`; comprobar el estado devuelto al cliente. No usar un fallo de API como mecanismo de retorno al flujo anterior. Si solo se elimina la clave del servidor mientras la política sigue activa, el comportamiento previsto es bloquear el envío, no guardar el número sin protección.

Revisar por separado la retención de copias de seguridad y registros: una eliminación TTL no acredita que se hayan eliminado datos de respaldos previos. Las copias de esta implementación solo contendrían huellas y contadores, nunca números completos, pero siguen requiriendo una política de acceso y retención.

En desarrollo y preview, `reportsViteProxy()` expone el mismo contrato en Vite. No se incluyen cuentas de servicio de ejemplo ni una clave HMAC dentro de la aplicación. La demostración local de reportes debe mantenerse sin documentos reales.

## Verificación realizada y límites

`tests/guest-reports.test.js` usa el `Timestamp` real de Firebase Admin y dobles de prueba de las transacciones y verificación de tokens; incluye también un servidor HTTP Node real. Comprueba validación y límites de cuerpos, errores que ocultan datos, formatos de cédula, claves y rotación diaria de HMAC, campos persistidos, cuotas entre dispositivos, concurrencia, fallos de transacción, reintentos a medianoche y cambios de política.

No son pruebas contra Firebase de producción, reglas desplegadas, TTL real, IAM, un registro civil ni autoridades. El helper de transacciones se valida contra el contrato del SDK instalado (`firebase-admin` 14.5.x); la documentación oficial de configuración de proveedores e infraestructura debe revisarse al activar el piloto. La API no publica métricas ni garantías de eficacia frente a fraude de identidad.

## Verificación realizada y pendiente

Se probaron el endpoint y las transacciones con proveedores simulados, las cuotas concurrentes, la separación de datos y el cliente Firebase real en Chromium con HTTP simulado; no se enviaron cédulas ni reportes a Firebase real. Las reglas nuevas se revisaron como código, pero **no se compilaron ni ejecutaron en el emulador**: la descarga oficial del JAR quedó bloqueada por el proxy con CONNECT 403. Antes de activar, comprobar con emulador: política ausente/false permite el lote invitado existente; true lo rechaza; las cuentas registradas conservan su flujo; nadie desde el cliente público lee/escribe políticas o cuotas privadas; solo se leen reportes aprobados.

Esta modalidad comprueba exclusivamente formato de cédula dominicana. Si se activa en la instancia pública global, los invitados de otros países necesitarán la alternativa de cuenta registrada. Mantenerla apagada o aislarla en la instancia del piloto hasta definir el alcance territorial y los documentos admitidos.
