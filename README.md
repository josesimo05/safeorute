# SafeRoute

Prototipo para Colegio Jaime Molina Mota × Actuana Academy, Feria INTEC STEM. React + JavaScript + Leaflet/OpenStreetMap + Firebase + PWA, preparado para GitHub y Vercel.

## 1. Abrir en Antigravity

Descomprime esta carpeta y ábrela como proyecto. Instala Node.js LTS compatible con Vite (22.12 o posterior; probado aquí con Node 24). En la terminal de la carpeta:

```bash
npm ci
npm run dev
```

En Windows también puedes abrir `INICIAR-WINDOWS.bat`; instala dependencias si faltan y muestra la dirección local.

Abre la URL de la terminal. No necesitas configurar servicios para la demostración. Los datos de ejemplo son ficticios y todos los reportes locales están identificados como simulados.

## 2. Qué funciona

- Mapa real con puntos, zoom y selección de ubicación; lista sincronizada con filtros por categoría, fecha, horario y texto.
- Formulario con geolocalización voluntaria y coordenadas redondeadas a 3 decimales. No guarda una trayectoria ni la identidad del autor en el documento público.
- Categorías: robo, intento de robo, poca iluminación, espacio abandonado, bache y otro.
- Validación de longitud, fecha, ubicación, enlaces, teléfonos y correos. No sustituye una revisión de otros datos personales.
- Posibles duplicados: misma categoría, menos de 180 m y hasta una hora. En Firebase compara sólo reportes aprobados visibles; la revisión humana debe cotejar los pendientes.
- Patrones por categoría y horario, con los filtros actuales.
- Planificador móvil: busca direcciones del origen/destino, usa tu ubicación, deja elegir lugares en el mapa y calcula la ruta a la hora de salida seleccionada. TomTom devuelve la ruta más rápida y hasta cinco alternativas con tráfico. Puede devolver menos de cinco si la red vial no ofrece suficientes alternativas; la app no inventa rutas.
- Al seleccionar una ruta, el indicador cuenta reportes comunitarios aprobados a 150 m de la geometría, sin afirmar que el trayecto sea seguro/peligroso. Las rutas con tiempos dentro del 30% del más rápido se destacan; las más largas siguen visibles con su diferencia de tiempo.
- Busca gasolineras, farmacias, supermercados y hospitales cerca del punto medio de la ruta elegida. Leyenda con símbolos en el mapa.
- Botones para escuchar un breve resumen con la voz del navegador y abrir el destino en Google Maps, Apple Maps o Waze. Esas apps recalculan el camino; no reciben la alternativa elegida ni los avisos.
- Diseño móvil con barra inferior, controles grandes, modo oscuro/claro guardado y formulario de reporte rápido con categoría y ubicación; el detalle queda opcional.
- Registro e inicio de sesión por correo con Firebase Authentication. Los reportes públicos continúan sin mostrar el correo. En modo demostración el alta está desactivada hasta conectar Firebase.
- En demostración: persistencia en este navegador y moderación local de los pendientes.
- PWA con manifest, iconos y service worker. Después de una primera visita a la versión de producción, la interfaz funciona sin conexión. Los mapas base de OpenStreetMap y Firebase necesitan internet. No se descargan mapas masivamente.
- API de IA en Vercel que sugiere categoría y necesidad de revisión, con autenticación y cuotas. El botón “Sugerir categoría” usa reglas de palabras clave, no IA.

## 3. Conectar Firebase

1. Crea tu proyecto en https://console.firebase.google.com/ y registra una app web.
2. En Authentication → Sign-in method, activa Anónimo y Correo electrónico/contraseña.
3. Crea Cloud Firestore; no dejes reglas públicas de prueba.
4. Copia `.env.example` a `.env.local` y completa las cuatro variables `VITE_FIREBASE_*` de la configuración de tu app. Nunca subas `.env.local` a GitHub.
5. Copia `firestore.rules` en Firestore → Reglas y publica. Alternativamente, configura Firebase CLI y ejecuta `firebase deploy --only firestore:rules`.
6. Reinicia `npm run dev`. La etiqueta pasará de “Demostración” a “Comunidad · Firebase”. Los ejemplos locales no se suben.
7. Envía un reporte. Aparecerá en Firestore con `status: pending`. El mapa público consulta sólo `status: approved`.
8. El equipo revisa los hechos y datos personales en la consola Firebase. Cambia `status` a `approved` para publicar o `rejected` para rechazar. No existe una pantalla de administrador público en modo Firebase.

Las reglas impiden que el cliente apruebe, modifique o borre reportes. La escritura utiliza un lote con un documento técnico de límite por sesión anónima: un envío cada 60 segundos. Ese documento no es público ni se guarda dentro del reporte. La moderación desde consola depende de los permisos IAM del proyecto. El anonimato es frente al público; los proveedores pueden procesar identificadores técnicos y registros de conexión.

Para un piloto público: configura Firebase App Check con reCAPTCHA v3, completa `VITE_FIREBASE_APPCHECK_SITE_KEY`, prueba y activa la exigencia en Firestore. La cuota por sesión no impide que alguien cree nuevas sesiones. Revisa todos los reportes antes de aprobarlos.

### Activar navegación y lugares

1. Crea una cuenta de desarrollador TomTom y una API key habilitada para Routing, Search y Map Display. En `.env.local`, asigna `VITE_TOMTOM_API_KEY=TU_CLAVE` y reinicia Vite.
2. En producción, agrega la misma variable a Vercel y despliega de nuevo. Restringe la clave a los dominios de prueba y producción de SafeRoute; esta variable se incluye en el cliente web, así que debe limitarse por dominio/cuota.
3. TomTom se usa para el mapa nocturno, rutas/tiempos con tráfico, búsqueda de direcciones y lugares. La alternativa depende de qué calles y caminos existan para ese trayecto. Datos del proveedor requieren Internet y pueden tener cuota o costo según la cuenta.
4. Para abrir la ruta fuera de SafeRoute, toca Google Maps, Apple Maps o Waze. Para usar la navegación activa desde una pantalla CarPlay, SafeRoute necesita una app iOS nativa, solicitar a Apple el entitlement de navegación y pasar su revisión. Una PWA no se convierte en app CarPlay al instalarse; este paquete abre el proveedor externo y no integra CarPlay nativamente.

## 4. GitHub y Vercel

Crea un repositorio vacío en tu GitHub. Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Crear prototipo SafeRoute"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/saferoute.git
git push -u origin main
```

En https://vercel.com/ → Add New Project → importa el repositorio. Framework: Vite; build: `npm run build`; salida: `dist`. Define las variables `VITE_FIREBASE_*` y `VITE_TOMTOM_API_KEY` para cuentas y navegación conectadas. Publica y agrega el dominio de Vercel a los dominios autorizados de Firebase Authentication y reCAPTCHA. Los cambios en variables VITE requieren un nuevo despliegue.

No se ha creado un repositorio ni un despliegue en tus cuentas; este paquete contiene el código y configuración completos.

## 5. Activar IA real

La API `/api/analyze` funciona en Vercel, no en el servidor de desarrollo de Vite. En local puedes usar `vercel dev` con tu proyecto y variables configurados.

En las variables de servidor de Vercel:

- `GOOGLE_AI_API_KEY`: clave de Google AI Studio.
- `GOOGLE_AI_MODEL`: identificador de un modelo de Gemini habilitado en tu cuenta con soporte GenerateContent y respuestas JSON estructuradas. Consulta la documentación del proveedor y disponibilidad del modelo.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON completo de una cuenta de servicio del MISMO proyecto Firebase, como variable secreta en una sola línea. Se usa para verificar tokens y guardar cuotas en Firestore. Nunca lo pongas en una variable VITE ni en un archivo del repositorio.

La función verifica el token Firebase, limita una solicitud/minuto y diez/día por sesión, y 200/día globales. Una solicitud fallida después de reservar cupo también consume cupo. No guarda el texto enviado en el documento de cuota. El texto se envía a Google para clasificarlo; usa ejemplos ficticios para la feria. La respuesta se valida y el usuario puede corregir la categoría. Todos los envíos siguen pendientes: la IA no aprueba hechos ni decide que un barrio es seguro. Establece cuotas/presupuesto en el proveedor. Los costes dependen de tus cuentas.

## 6. Verificar antes de la feria

```bash
npm test
npm run build
npm run preview
```

Prueba: filtrar, elegir un lugar, enviar, abrir Moderación y aprobar (modo demo), volver al mapa, recargar y confirmar persistencia. En Recorrido selecciona dos puntos. En Patrones comprueba los conteos con la lista. En móvil prueba ubicación permitida/denegada, sugerencias de dirección, rutas con y sin tráfico, lugares, modo oscuro/claro, registro de cuenta y diseño vertical. Instala desde el menú del navegador cuando esté disponible; en iPhone usa Compartir → Añadir a pantalla de inicio. La instalación requiere HTTPS o localhost y soporte del navegador.

Para probar offline usa la versión construida: visita y recarga con conexión, luego desconecta. La interfaz y los ejemplos deben seguir; el mapa base puede desaparecer. Los reportes reales no se encolan sin conexión: un fallo de envío se muestra al usuario.

## 7. Alcance y pruebas

Los tests automatizados cubren Haversine, clasificación, umbrales de duplicación, validación, conteo de reportes cercanos a una polilínea, ejemplos y rechazo de solicitudes/respuestas inválidas en la API. No se probaron los servicios TomTom/Firebase con claves reales. No demuestran una precisión del 80 %: para medirla prepara un conjunto independiente etiquetado manualmente y documenta los resultados.

Las reglas Firebase y llamadas reales a Gemini necesitan pruebas en tu proyecto/Emulator y credenciales; no se verificaron contra servicios reales al preparar este paquete. El build comprueba la aplicación, no sustituye pruebas del navegador, accesibilidad, IAM ni revisión de privacidad. Antes de un piloto público, prueba las reglas con Emulator Suite (rechazo de escrituras no autenticadas, aprobación por cliente, campos extras, lectura de pendientes y abuso de cuotas).

No hay datos oficiales verificados, alertas de velocidad, seguimiento GPS continuo ni garantías sobre seguridad. La ausencia de reportes no significa ausencia de incidentes. Los tiempos corresponden al proveedor de mapas para la hora solicitada; el prototipo no recalcula automáticamente el trayecto mientras conduces. La lectura de voz ofrece un resumen, no instrucciones giro a giro. Conduce siguiendo la navegación que prefieras y nunca uses el teléfono mientras el vehículo está en movimiento.

## 8. Archivos para aprender y modificar

- `src/App.jsx`: pantallas y formulario.
- `src/style.css`: colores, diseño y adaptación al teléfono.
- `src/logic.js`: validación, clasificación por reglas y cálculos geográficos.
- `src/store.js`: almacenamiento local o Firebase.
- `api/analyze.js`: autenticación, cuotas y consulta de IA en servidor.
- `firestore.rules`: acceso y validación de Firebase.
- `vite.config.js`: compilación y PWA.

Documentación oficial: https://vite.dev/guide/ · https://firebase.google.com/docs/auth/web/anonymous-auth · https://firebase.google.com/docs/firestore/security/get-started · https://firebase.google.com/docs/auth/admin/verify-id-tokens · https://ai.google.dev/gemini-api/docs/structured-output · https://leafletjs.com/reference.html · https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route · https://docs.tomtom.com/search-api/documentation/search-service/points-of-interest-search · https://developer.apple.com/documentation/carplay

### Probar desde un teléfono en la misma Wi-Fi

Abre `INICIAR-EN-CELULAR.bat` en la computadora. En la terminal busca la línea `Network: http://...` y escribe esa dirección en el navegador del teléfono conectado al mismo Wi-Fi. Esto sirve para revisar el diseño; la geolocalización y la instalación PWA requieren HTTPS. En Vercel abre el sitio publicado en el teléfono: Android puede mostrar “Instalar app”; en iPhone, Safari → Compartir → Añadir a pantalla de inicio.
