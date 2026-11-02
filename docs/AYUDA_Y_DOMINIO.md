# Soporte de SafeRoute y corrección de la dirección

## Soporte incluido

El botón **Ayuda** abre un diálogo con ocho temas y sus respuestas en español, inglés, francés, portugués, alemán, italiano, árabe y chino. La búsqueda y las preguntas frecuentes están incluidas en la PWA y funcionan sin conexión después de cargar la app. No hacen llamadas a un modelo ni generan consumo de IA.

El chat envía únicamente la pregunta actual y el idioma a `POST /api/support`. No adjunta automáticamente reportes, GPS, correo, historial del chat ni datos ITS. El servidor verifica un token Firebase y usa los artículos de ayuda como contexto. La respuesta contiene texto, IDs de artículos utilizados y una indicación de si hace falta ayuda humana. Las respuestas pueden contener errores: las citas y el contexto limitado reducen el riesgo, pero no garantizan exactitud.

El historial de la ventana vive solo en memoria y se borra al cerrar la ayuda. Los contadores de uso se guardan en `supportLimits`, accesibles únicamente desde el servidor; no contienen las preguntas. El proveedor de IA recibe el texto enviado y tiene sus propias condiciones de tratamiento de datos. La app no afirma que ese proveedor no conserve datos.

El propietario decidió no asignar todavía correo ni WhatsApp. **Copiar consulta** prepara el texto para compartirlo voluntariamente; no envía mensajes ni crea tickets o buzones. No hay un destinatario inventado ni una cuenta de correo creada.

## Activar la IA en Vercel

La ayuda incluida funciona sin configurar IA. Para respuestas del modelo, define en el proyecto Vercel:

- `SUPPORT_AI_API_KEY` y `SUPPORT_AI_MODEL`, o reutiliza los valores existentes de `GOOGLE_AI_API_KEY` y `GOOGLE_AI_MODEL`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`, con acceso al mismo proyecto Firebase que usa la app. Solo servidor; nunca `VITE_` ni el repositorio.
- Authentication anónima habilitada para consultas sin inicio de sesión, o una sesión Firebase válida existente.

Selecciona un modelo disponible en tu cuenta que soporte GenerateContent con JSON estructurado. No se fija un modelo no verificado ni se utiliza una clave de mapas para pagar consultas de IA. El despliegue y una prueba real deben confirmar acceso, facturación y compatibilidad del modelo elegido.

El servidor usa `maxOutputTokens: 384`, pregunta de hasta 1200 caracteres, ocho artículos y ninguna conversación anterior. Reserva las cuotas antes de contactar al proveedor:

| Límite predeterminado | Valor |
|---|---:|
| Por usuario y día UTC | 10 |
| Espera entre consultas del usuario | 60 segundos |
| Total diario UTC del soporte | 50 |
| Total mensual UTC del soporte | 1000 |

Variables opcionales: `SUPPORT_AI_USER_DAILY_LIMIT`, `SUPPORT_AI_DAILY_LIMIT` y `SUPPORT_AI_MONTHLY_LIMIT`. Deben ser enteros positivos; los máximos admitidos son 50, 1000 y 20000, respectivamente. Una configuración inválida bloquea el consumo. Los reintentos o fallos del proveedor conservan la reserva; crear otra sesión no evita el límite global. Son límites de solicitudes del soporte, **no un tope monetario de la cuenta de Google**, y no incluyen la API de clasificación de reportes. Configura también alertas de facturación/cuotas del proveedor según el modelo y presupuesto.

Si faltan credenciales, falla la autenticación o se agota el límite, la interfaz lo indica y mantiene las FAQ disponibles. No presenta una respuesta prefabricada como si procediera de IA. Vite usa el mismo manejador local de `/api/support`; el modo demo sin Firebase mantiene el chat no disponible y permite probar las FAQ.

## Dirección solicitada

Objetivo solicitado: corregir `safeorute.vercel.app` a un nombre con **saferoute**, preferentemente `saferoute.vercel.app` si está disponible. **No se ha asignado ese dominio ni se ha confirmado su disponibilidad.** Esta sesión no tiene una credencial Vercel vinculada y sus peticiones a ambos hostnames reciben un 403 del proxy de red. Ese resultado no permite concluir que el nombre esté libre ni ocupado.

La marca, el manifest y el nombre de paquete ya dicen SafeRoute/saferoute. Cambiar texto del repositorio no cambia el dominio del proveedor. El repositorio GitHub y el backend Render conservan sus direcciones reales: reemplazarlas por nombres no asignados rompería conexiones.

Para ejecutar el cambio desde la cuenta propietaria:

1. En Vercel, abre el proyecto actual y revisa **Settings → General → Project Name** y **Settings → Domains**. Solicita el nombre correcto; si no está disponible, utiliza una variante con `saferoute`. Confirma la URL que Vercel haya asignado realmente.
2. Añade la nueva URL a los dominios autorizados de Firebase Authentication y, si corresponde, App Check/reCAPTCHA. Añádela también a las restricciones de origen de Geoapify; conserva temporalmente la dirección anterior.
3. Despliega y comprueba instalación, cuentas, mapas, búsqueda, rutas, soporte y `/api/its` en la nueva URL. Los endpoints de la app son relativos al origen, por lo que la integración ITS no requiere cambiar el CORS del backend Render.
4. Mantén el dominio anterior como alias o configura una redirección solo después de comprobar la nueva dirección, usando las opciones que permita la cuenta. No se ha instalado una redirección hacia un dominio sin verificar.
5. Ten en cuenta que preferencias, service worker y datos de demostración locales pertenecen a cada origen. No se trasladan automáticamente; la app instalada puede necesitar abrirse o instalarse desde la nueva URL. Los documentos remotos de Firebase no cambian de base por renombrar el sitio.

Para que el asistente ejecute las operaciones de alojamiento, hace falta una conexión autorizada de Vercel. El requisito `VERCEL_TOKEN` ya existe en los ajustes del entorno, pero no tiene una credencial vinculada. Su valor debe proporcionarse mediante la configuración segura, nunca por chat ni en archivos del proyecto.

## Comprobaciones de esta entrega

El 2 de noviembre de 2026 pasaron las 110 pruebas Node del proyecto, 41 pruebas Chromium de la PWA y el build de producción. Incluyen FAQ sin conexión, ocho idiomas, teclado/foco, copia manual, historial borrado al cerrar, ausencia de un contacto inventado y mensajes honestos cuando la IA no está configurada. Se mantuvieron las regresiones existentes de mapas, navegación GPS e integración ITS.

Las pruebas de cuotas usan una base serializable simulada con concurrencia, persistencia entre instancias y límites de día/mes. El adaptador HTTP del modelo se comprobó con respuestas controladas y el manejador con un servidor HTTP Node real. **No se ejecutó una consulta a un proveedor IA de pago ni se verificó Firebase Admin contra una cuenta real para este soporte.** La activación remota y las operaciones de dominio requieren acceso a sus respectivos servicios; no se presentan como realizadas.
