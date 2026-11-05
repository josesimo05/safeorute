# Activar la revisión de reportes compartidos

Los reportes nuevos quedan **pendientes**. El mapa, las rutas y la suscripción pública reciben únicamente los **aprobados**. Este comportamiento conserva la revisión previa elegida para SafeRoute; aprobar para publicación no certifica la veracidad del hecho.

La nueva revisión funciona con Firebase Authentication y reglas de Firestore, no con el selector de perfiles del prototipo `/piloto/`. Ese selector sigue siendo una demostración y nunca concede permisos reales.

## Configuración que debe completar el propietario

1. En el proyecto Firebase que usa la web, habilitar **Authentication → Sign-in method → Google** y completar la información que solicite el proveedor. Habilitar **Anónimo** si también se aceptan envíos sin cuenta; no se crea una cuenta visible al ciudadano por usar esa sesión técnica.
2. En **Authentication → Settings → Authorized domains**, registrar el dominio estable de **Production** de Vercel. Compartir ese dominio, no el enlace temporal con hash de un despliegue protegido. `authDomain` sigue apuntando al dominio autorizado del proyecto Firebase, según su configuración web.
3. Publicar el contenido actualizado de `firestore.rules` desde la consola de Firestore o mediante el procedimiento de despliegue autorizado del proyecto. Subir el código a GitHub o desplegar Vercel **no publica las reglas de Firebase**.
4. Entrar a SafeRoute con **Continuar con Gmail**. El botón usa el proveedor Google de Firebase; puede permitir otras cuentas de Google, no demuestra por sí mismo un vínculo institucional. No hay proveedor Apple. Si el navegador bloquea ventanas emergentes, permitirlas para el dominio y volver a pulsar el botón; el código no redirige automáticamente descartando tareas abiertas.
5. Consultar el UID de esa cuenta en **Firebase Authentication → Users**. Con una cuenta propietaria/IAM autorizada, crear el documento privado `reportModerators/<UID>` con el campo booleano `active: true`. No usar el correo como ID y no asignar permisos a visitantes por defecto. El cliente web no puede crear, listar ni modificar membresías.
6. La cuenta revisora debe ser **no anónima y tener correo verificado**. Si se acaba de verificar una cuenta por correo, renovar la sesión para que el token lo refleje. Solo entonces aparece la revisión real habilitada en la aplicación.

No se requieren claves privadas en el navegador, nuevos secretos de Vercel ni una cuenta de servicio para esta revisión del cliente. No se deben copiar cuentas de servicio al código ni introducir sus claves en el chat.

## Cómo se guarda una decisión

`reviewReport(id, status)` admite únicamente `approved` o `rejected` y ejecuta una transacción del SDK web de Firebase:

- Lee la membresía activa, el reporte pendiente y la ausencia de revisión anterior.
- Comprueba otra vez la sesión y la membresía en cada reintento.
- Modifica exclusivamente `reports/<id>.status`.
- Crea simultáneamente `reportReviews/<id>` con `reportId`, `moderatorUid`, `status` y `reviewedAt` del servidor.

Las reglas impiden aprobar sin auditoría, alterar el texto/ubicación durante la revisión, sobrescribir una decisión, publicar campos privados adicionales o autoconcederse el rol. Una revocación de membresía deja de autorizar nuevas lecturas/decisiones. El historial de revisión es privado y no se añade al documento público del reporte.

Un pendiente malformado o con datos que deben descartarse sigue siendo **rechazable**: únicamente se cambia su estado y se registra la decisión privada. No se copian esos datos a la auditoría ni se los publica. La aprobación conserva la validación del contenido en la aplicación y el esquema público estricto en las reglas; ante texto inapropiado se debe rechazar, no corregirlo silenciosamente durante la aprobación.

La suscripción del público permanece filtrada por `status == approved`. Después de aprobar, otros dispositivos conectados al mismo proyecto reciben el cambio sin recargar ni volver a calcular la ruta. Los filtros de Exploración no deben excluir los reportes compartidos del contexto de una ruta.

## Comprobación con dos dispositivos

1. Abrir el **mismo dominio de Production** en dos navegadores/perfiles independientes, con conexión. La cabecera debe indicar **Reportes de la comunidad**, no demostración ni un error de configuración.
2. En el dispositivo A, enviar un incidente ficticio identificable y sin datos personales. Debe mostrarse como enviado a revisión; no debe ser público todavía.
3. En una sesión con membresía revisora, localizar ese pendiente y aprobarlo. Solo hacerlo si el propietario autoriza ese reporte de prueba en su proyecto real.
4. En el dispositivo B, mantener una ruta que pase cerca del punto. Verificar que se actualicen su conteo, su marcador y el listado de incidentes sin recargar, manteniendo la ruta seleccionada.
5. Repetir con filtros restrictivos en Explorar: el contexto compartido de la ruta no debe desaparecer por esos filtros. Un incidente alejado del corredor no debe contarse como cercano.
6. Revocar `active` o cerrar sesión y comprobar que desaparece la bandeja privada. Un visitante sin rol no puede leer pendientes ni ejecutar decisiones.

Un reporte rechazado queda fuera de la suscripción pública. No se cambia el estado de reportes reales automáticamente para preparar una demostración.

## Configuración inválida y demostración local

- El proyecto público predeterminado ya está incorporado en la configuración web. Fragmentos cuyas variables coinciden exactamente con ese proyecto se completan con sus valores predeterminados. Para usar otro proyecto, proporcionar las **cuatro** variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` y `VITE_FIREBASE_APP_ID` juntas, y recompilar; nunca se mezclan fragmentos de un proyecto alternativo con el predeterminado.
- Una sustitución incompleta se identifica como configuración inválida: no se guarda un falso éxito en `localStorage` ni se convierte silenciosamente en demostración.
- El build público normal `npm run build` usa modo `production` y comparte con Firebase aunque quede una variable antigua `VITE_DEMO_MODE=true` en Vercel. Eliminar esa variable de Production evita confusión y permite mantener coherente la configuración.
- Una demostración desplegable se compila explícitamente con `npm run build -- --mode demo`. En desarrollo también se respeta `VITE_DEMO_MODE=true`. El modo demo puede sincronizar pestañas del mismo navegador/origen mediante `storage`, pero **no comparte entre dispositivos**.
- La cédula privada continúa siendo una opción independiente, desactivada por defecto y sujeta a su propia guía. Ningún rol de moderación se obtiene introduciendo una cédula.
- Los reportes guardados mientras la web mostraba **Demostración · Datos simulados** siguen siendo locales. No se suben automáticamente: el conjunto puede incluir ejemplos ficticios. Tras activar el modo comunidad, reenviar el reporte de prueba y aprobarlo mediante la bandeja autorizada.

## Verificación del cambio

Las pruebas de `tests/report-review.test.js` cubren cuentas verificadas, membresías, decisiones atómicas, carreras, revocación durante un reintento y separación entre reporte público/auditoría. Son pruebas con un adaptador serializable: por sí solas no demuestran la ejecución de reglas en Firebase ni una configuración real del proveedor Google.

La verificación con emulador o las comprobaciones autorizadas sobre el proyecto real deben conservar su resultado separado. No se afirma que habilitar Google, asignar un UID, publicar reglas o aprobar reportes en producción haya ocurrido por compilar este repositorio.
