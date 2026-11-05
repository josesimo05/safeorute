# Verificación real de reportes compartidos y revisión

La prueba `tests/rules/shared-reports.test.mjs` usa el SDK Firebase 13.0.0 y `@firebase/rules-unit-testing` 6.0.0 contra un **emulador real de Firestore**. Compila y ejecuta las reglas actuales. No usa la base de producción, cuentas de Google reales, Firebase Admin ni credenciales de aplicación predeterminadas.

La autenticación de los contextos es sintética, como corresponde al emulador: esta prueba no certifica el login OAuth de Gmail ni la configuración de dominios del alojamiento.

## Dependencias y emulador comprobados

- Node.js 24.19.0 y Java 21 en el entorno de desarrollo. La dependencia de pruebas `@firebase/rules-unit-testing` 6.0.0 requiere Node **24.12.0 o superior**; utiliza esa versión para `test:rules`.
- Cloud Firestore Emulator **1.20.2**, obtenido del componente oficial Google Cloud SDK **550.0.0**.
- Manifest consultado: `https://dl.google.com/dl/cloudsdk/channels/rapid/components-v550.0.0.json`.
- Archivo del componente: `https://dl.google.com/dl/cloudsdk/channels/rapid/components/google-cloud-sdk-cloud-firestore-emulator-20250929142209.tar.gz`.
- Tamaño del archivo comprimido: **56 914 837 bytes**.
- SHA-256 del archivo comprimido: `6c6bd30603e61a3b328b61b8bffd76583405b50145ae049d7786cf18d988f4ba`.

El tamaño y SHA-256 se verificaron antes de extraer o ejecutar el JAR. No se desactivaron TLS ni comprobaciones de integridad. El componente más reciente consultado, Firestore 1.23.0, requería Java 25; no se ejecutó en Java 21. Se eligió una versión oficial compatible, sin alterar su checksum.

Los binarios y dependencias temporales quedaron fuera del repositorio en `/workspace/scratch/firebase-rules-check/`. No se deben subir los JAR ni credenciales al proyecto.

## Arranque local

Descarga el componente a una carpeta de desarrollo, verifica el tamaño y checksum indicados y extrae **únicamente** `platform/cloud-firestore-emulator/cloud-firestore-emulator.jar`. No uses una descarga distinta con el checksum anterior.

El JAR del componente Google Cloud no contiene una entrada `Main-Class`; su lanzador oficial usa la siguiente clase. Desde la raíz del proyecto, sustituye la ruta del JAR por tu archivo ya verificado:

```bash
java -Duser.language=en \
  -cp /ruta/verificada/cloud-firestore-emulator-1.20.2.jar \
  com.google.cloud.datastore.emulator.firestore.CloudFirestore \
  --host 127.0.0.1 --port 8080 \
  --project_id demo-saferoute-sharing \
  --rules ./firestore.rules \
  --single_project_mode true --single_project_mode_error true
```

Espera el mensaje `Dev App Server is now running`. El servidor solo escucha en loopback. Mantén ese proceso abierto mientras ejecutas la prueba:

```bash
NO_PROXY=127.0.0.1,localhost,::1 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
npm run test:rules
```

La suite exige `FIRESTORE_EMULATOR_HOST` explícito con host local, rechaza destinos externos y utiliza exclusivamente el proyecto ficticio `demo-saferoute-sharing`. Si no hay emulador, debe fallar; no omite las comprobaciones ni cambia a producción. Limpia los documentos del espacio de prueba al iniciar. `withSecurityRulesDisabled` se usa solo para crear los roles y escenarios de prueba que representaría el propietario en una configuración real.

## Casos ejecutados

1. La lectura pública permite aprobados y rechaza pendientes.
2. Solo una cuenta verificada con membresía activa puede consultar la cola de revisión.
3. Un cliente no puede otorgarse roles, concederlos a otros ni enumerar membresías.
4. Un moderador no puede publicar sin auditoría atómica ni alterar texto o coordenadas al revisar.
5. Un pendiente antiguo con campos privados adicionales no se puede aprobar. Sí puede rechazarse con un cambio exclusivo de estado y una auditoría privada mínima, sin copiar ni publicar esos campos.
6. Cuentas normales, no verificadas, anónimas o inactivas no pueden aprobar aunque intenten adjuntar una auditoría.
7. El lote existente de envío anónimo crea un pendiente invisible al público y mantiene su límite temporal.
8. **Dos clientes SDK independientes:** A crea un pendiente; B ya tiene una ruta y una suscripción pública. Tras la revisión real en el emulador, B recibe el reporte aprobado por `onSnapshot`, lo incorpora al corredor de su ruta sin cambiar el objeto de ruta y conserva solo los ocho campos públicos.
9. La auditoría es privada y no se puede modificar después de publicar.
10. Dos revisores concurrentes producen una única decisión y una auditoría coherente.
11. Revocar una membresía impide revisiones posteriores aunque el token siga siendo válido.
12. La política opcional de cédula obligatoria cierra la escritura anónima directa; las colecciones privadas siguen sin exposición pública.
13. Un cliente no puede crear directamente un reporte aprobado.

La comprobación de UI —marcadores, lista de incidentes y filtros de Exploración independientes— corresponde además a las pruebas de navegador. Este test valida comunicación y permisos reales del emulador, no precisión de rutas ni funcionamiento de una instancia de producción.

La ejecución reproducida desde el repositorio con las reglas actuales terminó con **13 pruebas aprobadas, 0 fallidas y 0 omitidas** mediante `npm run test:rules`. Incluye el envío anónimo pendiente, la aprobación atómica y la recepción en vivo por un segundo cliente independiente. El caso con campos privados adicionales comprueba que el esquema impide publicarlos; el filtrado de teléfonos o correos dentro de texto libre depende además de la validación de la aplicación y la revisión humana, y no debe presentarse como una garantía de las reglas.

## Activación real pendiente de la cuenta propietaria

Publicar el código en GitHub/Vercel no publica por sí mismo las reglas de Firestore, no habilita Google como proveedor ni crea moderadores. Antes de afirmar que la revisión opera en producción, el propietario debe aplicar los pasos de [ACTIVAR_REVISION.md](ACTIVAR_REVISION.md), revisar el contenido de las reglas y probar un reporte real autorizado desde dos dispositivos. No convertir todos los pendientes en aprobados automáticamente.
