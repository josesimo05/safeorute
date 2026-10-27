# SafeRoute

Prototipo para Colegio Jaime Molina Mota × Actuana Academy, Feria INTEC STEM. React + JavaScript + Leaflet/OpenStreetMap + Firebase + PWA, preparado para GitHub y Vercel.

## 1. Abrir en Antigravity

Descomprime esta carpeta y ábrela como proyecto. Instala Node.js LTS compatible con Vite (22.12 o posterior; probado aquí con Node 24). En la terminal de la carpeta:

```bash
npm ci
npm run dev
```

En Windows también puedes abrir `INICIAR-WINDOWS.bat`; instala dependencias si faltan y muestra la dirección local.

Abre la URL de la terminal. La configuración web del proyecto Firebase `saferoute-f87c1` ya está incluida. La app inicia en modo comunidad; las reglas, la base de datos y los proveedores de Authentication deben estar habilitados en ese proyecto. Para probar sin servicios externos, ejecuta `npm run dev -- --mode demo`: los datos de ejemplo son ficticios y los reportes locales están identificados como simulados.

## 2. Qué funciona

- Mapa real con puntos, zoom y selección de ubicación; lista sincronizada con filtros por categoría, fecha, horario y texto.
- Formulario con geolocalización voluntaria y coordenadas redondeadas a 3 decimales. No guarda una trayectoria ni la identidad del autor en el documento público.
- Categorías: robo, intento de robo, poca iluminación, espacio abandonado, bache y otro.
- Validación de longitud, fecha, ubicación, enlaces, teléfonos y correos. No sustituye una revisión de otros datos personales.
- Posibles duplicados: misma categoría, menos de 180 m y hasta una hora. En Firebase compara sólo reportes aprobados visibles; la revisión humana debe cotejar los pendientes.
- Patrones por categoría y horario, con los filtros actuales.
- Planificador móvil: sugiere lugares y direcciones mientras escribes el origen/destino y muestra el nombre del establecimiento cuando está disponible. La búsqueda es mundial por defecto; el selector del planificador y el botón del globo permiten limitarla a un país. Al cambiarlo, el mapa se mueve automáticamente a ese país y las búsquedas usan ese centro. La vista del país guardado se restaura al volver a abrir la app; **Todos los países** muestra la vista mundial. Los centros de los 249 países están incluidos y no necesitan una consulta de red. Puedes elegir una sugerencia con un toque o con las flechas arriba/abajo y Enter; Escape cierra la lista. Al elegir, aparecen los marcadores A/B antes de calcular. También puedes usar tu ubicación o el botón **Elegir en mapa** de cada campo: abre un mapa a pantalla completa con una mira central; arrastra o toca el mapa para colocarla y pulsa **Confirmar origen** o **Confirmar destino**. **Cancelar selección** conserva el punto anterior y un toque aislado no confirma un lugar. Geoapify calcula rutas con los criterios `balanced` y `short`; la app elimina geometrías repetidas y muestra hasta dos rutas distintas, según la red vial disponible. Los tiempos son estimaciones sin tráfico en tiempo real ni selección de hora de salida.
- Al seleccionar una ruta, el indicador cuenta reportes comunitarios aprobados a 150 m de la geometría, sin afirmar que el trayecto sea seguro/peligroso. Las rutas con tiempos dentro del 30% del más rápido se destacan; las más largas siguen visibles con su diferencia de tiempo.
- Busca gasolineras, farmacias, supermercados y hospitales en un radio de 5 km alrededor del punto medio de la ruta elegida. Leyenda con símbolos en el mapa.
- Navegación dentro de SafeRoute con **Iniciar navegación**: mantiene la alternativa que elegiste, muestra tu posición GPS, la próxima indicación del proveedor, el avance y la distancia y tiempo estimado restantes. Puedes seguir tu ubicación, volver a centrar o ver la ruta completa. La voz se activa voluntariamente; el resumen y la lista de indicaciones también se pueden consultar desde el planificador. Si deniegas la ubicación, las indicaciones siguen disponibles.
- La navegación avisa cuando la posición se aleja de la ruta, sin sustituirla automáticamente. **Recalcular desde mi ubicación** solicita una nueva ruta desde el GPS e intenta mantener el criterio elegido, recomendado o más corto. Con poca precisión GPS evita anunciar maniobras o confirmar la llegada. Al llegar, al detener la navegación o al salir de ella se cancela el seguimiento. Las posiciones se usan durante la sesión y no forman un historial de trayectos guardado.
- Interfaz incluida en español, inglés, francés, portugués, alemán, italiano, árabe y chino simplificado. El botón del globo permite cambiar idioma y país; las preferencias quedan guardadas en este navegador. Al iniciar, usa un idioma compatible del navegador o español como alternativa. Los ocho paquetes están incluidos en la PWA y se pueden cambiar sin conexión después de la primera carga. Árabe adapta la interfaz a lectura de derecha a izquierda. Los nombres de lugares y los reportes conservan su idioma original; no se envían a un traductor.
- Diseño móvil con mapa y planificador amplio en la parte inferior, cabecera compacta, barra inferior y controles grandes. Al planificar se ocultan los bloques de presentación e instalación para ganar espacio. El planificador y la leyenda se pueden desplegar; la selección por mapa y la navegación usan toda la pantalla. Incluye modo oscuro/claro guardado y formulario de reporte rápido con categoría y ubicación; el detalle queda opcional.
- Registro e inicio de sesión por correo con Firebase Authentication. Los reportes públicos continúan sin mostrar el correo. En modo demostración el alta está desactivada hasta conectar Firebase.
- En demostración: persistencia en este navegador y moderación local de los pendientes.
- PWA instalable con manifest, iconos para Android/iOS y service worker. La app avisa cuando queda disponible sin conexión y pide confirmación antes de aplicar una actualización. Los mapas, rutas y servicios conectados necesitan internet; no se descargan mapas masivamente.
- API de IA en Vercel que sugiere categoría y necesidad de revisión, con autenticación y cuotas. El botón “Sugerir categoría” usa reglas de palabras clave, no IA.

## 3. Firebase: proyecto saferoute-f87c1

La configuración web proporcionada está en `src/firebase-config.js`; no hace falta copiar variables para conectar este proyecto. No se activa Analytics. Verifica estos requisitos en la consola:

1. En Authentication → Sign-in method, activa Anónimo y Correo electrónico/contraseña.
2. Crea la base de datos `(default)` en Cloud Firestore si todavía no existe; no dejes reglas públicas de prueba.
3. Para cambiar de proyecto, copia `.env.example` a `.env.local` y reemplaza las cuatro variables `VITE_FIREBASE_*` juntas (`apiKey`, `authDomain`, `projectId`, `appId`). No mezcles identificadores de distintos proyectos. Nunca subas `.env.local` a GitHub. Reinicia Vite o recompila al cambiar variables.
4. Copia `firestore.rules` en Firestore → Reglas y publica. Alternativamente, configura Firebase CLI y ejecuta `firebase deploy --only firestore:rules --project saferoute-f87c1`. El archivo `.firebaserc` también selecciona este proyecto por defecto.
5. Ejecuta `npm run dev`. La etiqueta “Comunidad · Firebase” indica el modo configurado; comprueba que la consulta de reportes termina sin error. Esa etiqueta por sí sola no verifica permisos ni conectividad. Los ejemplos locales no se suben.
6. Envía un reporte. Aparecerá en Firestore con `status: pending`. El mapa público consulta sólo `status: approved`.
7. El equipo revisa los hechos y datos personales en la consola Firebase. Cambia `status` a `approved` para publicar o `rejected` para rechazar. No existe una pantalla de administrador público en modo Firebase.

Para probar sin conexión al proyecto, ejecuta `npm run dev -- --mode demo`, compila con `npm run build -- --mode demo` o define `VITE_DEMO_MODE=true`. El modo comunidad no muestra la moderación local ni guarda reportes reales offline.

Si al enviar un reporte sin iniciar sesión falla `accounts:signUp` con HTTP 400, la app está intentando obtener una sesión anónima antes de escribir en Firestore. Revisa **Authentication → Método de acceso → Anónimo**. `ADMIN_ONLY_OPERATION` o `OPERATION_NOT_ALLOWED` indican un método no habilitado; `CONFIGURATION_NOT_FOUND` requiere terminar la configuración de Authentication. Si el proveedor ya está habilitado, revisa `error.message` en la respuesta de esa petición para distinguir problemas de clave, restricciones u otras causas. La app conserva el formulario y muestra un aviso específico para los errores conocidos; no se considera guardado un reporte cuando falla la autenticación.

`npm run test:firebase` comprueba estos tres rechazos HTTP con el SDK de Firebase en Chromium y respuestas simuladas. No crea usuarios ni escribe reportes en el proyecto real. Usa la misma instalación de Chromium y la variable `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` documentadas para las pruebas PWA.

La configuración web de Firebase es pública y se incluye en la compilación de la PWA. No utiliza un archivo de cuenta de servicio ni una clave privada. La cuenta de servicio solo es necesaria para la API opcional de IA en el servidor; configúrala como secreto del servidor, nunca dentro del cliente ni del ZIP. Si una clave privada se comparte en un chat o repositorio, revócala y reemplázala antes de usar esa cuenta.

Al conectar Firestore, el mapa puede quedar sin reportes: los ejemplos locales no se copian a la base real. Un reporte nuevo queda pendiente hasta que un moderador lo apruebe en la consola.

Las reglas impiden que el cliente apruebe, modifique o borre reportes. La escritura utiliza un lote con un documento técnico de límite por sesión anónima: un envío cada 60 segundos. Ese documento no es público ni se guarda dentro del reporte. La moderación desde consola depende de los permisos IAM del proyecto. El anonimato es frente al público; los proveedores pueden procesar identificadores técnicos y registros de conexión.

Para un piloto público: configura Firebase App Check con reCAPTCHA v3, completa `VITE_FIREBASE_APPCHECK_SITE_KEY`, prueba y activa la exigencia en Firestore. La cuota por sesión no impide que alguien cree nuevas sesiones. Revisa todos los reportes antes de aprobarlos.

### Activar navegación y lugares

La interfaz está traducida a los ocho idiomas incluidos. Geoapify Routing no admite árabe ni chino: en esos dos casos se solicitan instrucciones al proveedor en inglés para poder calcular la ruta; el planificador, el resumen y los controles conservan el idioma elegido. La navegación indica cuándo las maniobras están en inglés y las lee con esa voz cuando está disponible. Las búsquedas y los lugares reciben el idioma seleccionado.

1. Crea una cuenta Geoapify y una API key para Maps, Geocoding, Routing y Places. En `.env.local`, asigna `VITE_GEOAPIFY_API_KEY=TU_CLAVE` y reinicia Vite. Este archivo está ignorado por Git; no publiques la clave en el repositorio.
2. En Vercel, configura `VITE_GEOAPIFY_API_KEY` en el proyecto de `safeorute.vercel.app` y vuelve a compilar/desplegar. Guardarla en `.env.local` no la configura en Vercel. La clave se incluye en el navegador: restríngela al sitio desplegado y a los orígenes de desarrollo local que necesites, y configura cuotas en Geoapify.
3. Geoapify sirve los mapas raster `osm-carto` en modo claro y `dark-matter-yellow-roads` en modo oscuro, las sugerencias, direcciones, rutas y lugares. La búsqueda usa **Todos los países** por defecto; en el botón del globo puedes limitarla a un país o territorio ISO 3166-1. Cambiar ese filtro borra el origen, el destino y las rutas actuales, detiene una navegación activa y centra inmediatamente el mapa en el país elegido. La vista inicial de cada país está incluida sin conexión; las imágenes del mapa siguen necesitando Internet. La app envía el idioma elegido al proveedor cuando corresponde, aunque los nombres propios pueden permanecer en su idioma original. La cobertura de direcciones, establecimientos y rutas depende de los datos disponibles en Geoapify para cada región. El mapa oscuro conserva los colores del proveedor sin invertir las imágenes. Routing consulta los tipos `balanced` y `short` y elimina geometrías idénticas: puede haber hasta dos rutas distintas. Los tiempos no incluyen tráfico en tiempo real y no se envía una hora de salida. Los servicios requieren Internet y pueden tener cuota o costo según la cuenta.
4. Calcula las rutas, selecciona una y pulsa **Iniciar navegación**. SafeRoute utiliza la geometría y las maniobras de esa alternativa dentro de la propia app, sin enviarte a otro navegador de mapas. La ubicación requiere permiso y HTTPS o localhost; mantén SafeRoute visible y la pantalla encendida. El navegador o el sistema pueden suspender el GPS al bloquear la pantalla o cambiar de aplicación. **Detener navegación** libera el seguimiento GPS y detiene la voz.
5. El tiempo restante se estima proporcionalmente al tramo de geometría pendiente a partir del tiempo calculado por Geoapify: no utiliza tráfico en directo ni garantiza una hora de llegada. Una ubicación poco precisa o la cercanía física al destino desde otra parte de la ruta no deben confirmar la llegada. Si el GPS falla, puedes reintentarlo o consultar la lista de indicaciones sin ubicación.

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

En https://vercel.com/ → Add New Project → importa el repositorio. Framework: Vite; build: `npm run build`; salida: `dist`. Firebase ya apunta a `saferoute-f87c1`. Define las cuatro variables `VITE_FIREBASE_*` solo si quieres reemplazar ese proyecto y `VITE_GEOAPIFY_API_KEY` para activar mapas, navegación y lugares. En el proyecto existente de `safeorute.vercel.app`, agrega esta variable y vuelve a compilar/desplegar. Publica y agrega el dominio de Vercel a los dominios autorizados de Firebase Authentication y reCAPTCHA. Los cambios en variables VITE requieren una nueva compilación y despliegue.

La configuración local no confirma que la variable esté guardada en Vercel. Para este cambio no se dispone de credenciales de Vercel; la variable y el nuevo despliegue deben configurarse desde tu cuenta.

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

Prueba: filtrar, elegir un lugar, enviar, abrir Moderación y aprobar (modo demo), volver al mapa, recargar y confirmar persistencia. En Navegar escribe nombres como **Colegio Jaime Molina Mota** o **Club San Gerónimo**, elige las sugerencias y confirma que aparecen A/B antes de calcular. Prueba también flechas arriba/abajo, Enter y Escape. Desde el selector de país cambia a Estados Unidos, Francia o Bolivia y comprueba que el mapa se mueve; recarga para verificar la vista guardada y cambia de idioma sin conexión. En Patrones comprueba los conteos con la lista.

En móvil, pulsa **Elegir en mapa**, arrastra o toca para colocar la mira y confirma el origen o destino. Comprueba también que cancelar no cambia un punto elegido. Calcula rutas, elige una alternativa y pulsa **Iniciar navegación**: revisa las indicaciones y la ubicación permitida/denegada, el seguimiento de la alternativa, el aviso fuera de ruta, la voz voluntaria y el botón para detener. El recálculo debe producirse solo al pedirlo y conservar el criterio cuando esté disponible. Prueba señal GPS débil y recuperación, llegada cerca del destino y suspensión al bloquear la pantalla desde un teléfono real; las posiciones simuladas del navegador no sustituyen esa comprobación. Revisa también lugares, modo oscuro/claro y registro de cuenta. Instala desde el menú del navegador cuando esté disponible; en iPhone usa Compartir → Añadir a pantalla de inicio. La instalación requiere HTTPS o localhost y soporte del navegador.

### Instalar la PWA y usarla sin conexión

1. Compila con `npm run build` y sirve `dist` con `npm run preview`, o despliega en Vercel con HTTPS. El servidor `npm run dev` no activa el service worker: sirve para desarrollar, no para comprobar instalación u offline.
2. Abre la app con conexión y espera el aviso de disponibilidad sin conexión. En Chrome/Edge para Android o escritorio, usa **Instalar app** cuando el navegador lo permita; también puede aparecer en su menú. En iPhone/iPad abre Safari, pulsa **Compartir → Añadir a pantalla de inicio** y confirma. La app muestra instrucciones cuando no hay instalación automática.
3. Abre SafeRoute desde su icono: debe iniciar en su propia ventana. Los iconos incluyen una variante adaptable con margen para el recorte de Android y un icono de pantalla de inicio para iOS.
4. Para probar offline, recarga una vez con conexión después de activar el service worker, desconecta y vuelve a abrir la app. La interfaz, los filtros y los reportes simulados guardados en ese navegador siguen disponibles. Los mapas de Geoapify/OpenStreetMap, rutas, búsquedas, Firebase, cuentas e IA necesitan conexión. Los reportes reales no se guardan en una cola offline ni se envían automáticamente al reconectar.
5. Cuando haya otra versión, la app ofrece actualizar o hacerlo más tarde. Termina de guardar cualquier formulario antes de aceptar: aplicar la actualización recarga la app. Una actualización pospuesta no debe interrumpir lo que estás escribiendo.

La instalación y el service worker requieren HTTPS o localhost y dependen del soporte del navegador. Una dirección HTTP de la red Wi-Fi no equivale a localhost en el teléfono. No borres los datos del sitio si quieres conservar los reportes de demostración. La PWA guarda la interfaz, no respuestas privadas de las API ni mapas para navegación sin conexión.

Si aparecen `ERR_NETWORK_CHANGED` o `ERR_NAME_NOT_RESOLVED`, comprueba la conexión y la resolución DNS del dispositivo. Al recibir el evento de reconexión del navegador, la app vuelve a cargar los tiles visibles del mapa; también ofrece **Reintentar mapa** cuando falla la carga. El aviso desaparece cuando ya no quedan tiles fallidos en la vista, sin recargar la página ni borrar el formulario. Firebase conserva los reintentos automáticos del SDK. Una petición `Listen` con `TYPE=terminate` pertenece al cierre del canal y puede fallar durante el cambio de red; por sí sola no demuestra un problema de permisos.

Para revisar una nueva versión en Chrome/Edge DevTools: **Application → Manifest** debe mostrar el nombre, iconos y URL de inicio; **Service Workers** debe mostrar el registro activo. Activa **Network → Offline**, recarga y comprueba que funcionan filtros y reportes simulados; después restaura la conexión. Para comprobar actualizaciones, conserva una pestaña de la versión anterior, publica otra compilación y confirma que aparece el aviso sin recargar hasta pulsar actualizar. En Vercel, `sw.js` y el manifest se sirven con revalidación para detectar versiones nuevas.

### Pruebas automatizadas de la PWA

La matriz usa Chromium para la suite completa y Firefox/WebKit para las pruebas comunes de compatibilidad. La primera vez instala los tres motores con `npx playwright install chromium firefox webkit`; en Linux, si faltan bibliotecas del sistema, usa `npx playwright install --with-deps chromium firefox webkit`. Después ejecuta:

```bash
npm run test:pwa
```

El comando compila una versión de demostración aislada en `.pwa-test-dist`, ejecuta la suite completa en Chromium y las pruebas comunes de búsqueda, rutas, diseño móvil y recarga offline en Firefox y WebKit, sin contactar ni escribir en Firebase real y sin reemplazar la compilación de producción en `dist`. Cubre manifest/iconos e instalación, recarga sin conexión con reportes locales y filtros, instrucciones para iPhone mediante emulación, un aviso nativo de instalación simulado, una actualización real del service worker que espera confirmación, recuperación del mapa tras fallos de tiles/cambios de red y navegación. Las comprobaciones de interfaz incluyen anchos de 320, 390 y 768 px, sugerencias de lugares, marcadores previos al cálculo, mapa a pantalla completa con confirmación/cancelación de puntos, cambio de país con desplazamiento del mapa y restauración de su vista. La navegación usa posiciones GPS simuladas para comprobar la alternativa elegida, el progreso, la precisión de ubicación, la llegada, el rechazo de permisos, la detención del seguimiento y el recálculo solicitado. También incluye cambio y persistencia de los ocho idiomas sin conexión, dirección de lectura árabe, búsqueda mundial y envío del país/idioma al proveedor. La emulación de iPhone y el motor WebKit de Playwright no sustituyen una prueba en Safari de un iPhone real; simular GPS tampoco verifica la precisión o continuidad de la señal de un teléfono. Para usar un Chromium ya instalado, define `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` con la ruta de su ejecutable antes del comando.

Si solo está disponible Chromium, ejecuta `npm run test:pwa -- --project=chromium`. En este entorno se ha ejecutado Chromium; las descargas oficiales de Firefox y WebKit quedaron bloqueadas con HTTP 403. Los proyectos permanecen configurados para ejecutarlos donde estén disponibles, pero no se afirma que hayan pasado aquí ni que la app se haya probado en todos los navegadores.

## 7. Alcance y pruebas

Los tests automatizados cubren Haversine, clasificación, umbrales de duplicación, validación, conteo de reportes cercanos a una polilínea, avance sobre la ruta y sus maniobras, llegada con precisión suficiente, las vistas de los 249 países, ejemplos y rechazo de solicitudes/respuestas inválidas en la API. Las consultas puntuales a Geoapify para Colegio Jaime Molina Mota y Club San Gerónimo verifican esos ejemplos; no garantizan cobertura de todos los establecimientos ni el funcionamiento en producción. La conectividad de Firebase requiere verificación independiente. Las pruebas no demuestran una precisión del 80 %: para medirla prepara un conjunto independiente etiquetado manualmente y documenta los resultados.

Las reglas Firebase y llamadas reales a Gemini necesitan pruebas en tu proyecto/Emulator y credenciales; no se verificaron contra servicios reales al preparar este paquete. El build comprueba la aplicación, no sustituye pruebas del navegador, accesibilidad, IAM ni revisión de privacidad. Antes de un piloto público, prueba las reglas con Emulator Suite (rechazo de escrituras no autenticadas, aprobación por cliente, campos extras, lectura de pendientes y abuso de cuotas).

No hay datos oficiales verificados, alertas de velocidad ni garantías sobre seguridad. La ausencia de reportes no significa ausencia de incidentes. La navegación sigue el GPS mientras la sesión está activa en primer plano, con las limitaciones de permisos y precisión del navegador; no garantiza funcionamiento en segundo plano o con la pantalla bloqueada. El tiempo restante es una estimación del trayecto pendiente sin tráfico en tiempo real. Las maniobras y la voz dependen de las instrucciones que entregue Geoapify y de las voces disponibles; las rutas sin maniobras detalladas conservan la geometría y avisan de esa ausencia. SafeRoute avisa de una desviación y permite pedir un recálculo; no cambia automáticamente la ruta seleccionada. Prepara la ruta y configura los controles con el vehículo detenido.

## 8. Archivos para aprender y modificar

- `src/App.jsx`: pantallas y formulario.
- `src/style.css`: colores, diseño y adaptación al teléfono.
- `src/PlaceSearch.jsx`: sugerencias, búsqueda por nombre y selección de origen/destino.
- `src/LocaleContext.jsx`, `src/i18n.js` y `src/translations*.js`: idioma, dirección de lectura y traducciones incluidas sin conexión.
- `src/regions.js` y `src/country-views.js`: países, alcance de búsqueda y vistas iniciales incluidas sin conexión.
- `src/geoapify.js`: mapas, direcciones, lugares y rutas del proveedor.
- `src/NavigationSession.jsx`: seguimiento GPS, próximas indicaciones, voz y controles de navegación dentro de SafeRoute.
- `src/route-progress.js`: progreso sobre la geometría, maniobras pendientes, distancia y estimación del tiempo restante.
- `src/logic.js`: validación, clasificación por reglas y cálculos geográficos.
- `src/store.js`: almacenamiento local o Firebase.
- `src/firebase-config.js`: configuración web pública de Firebase y selección de modo comunidad/demostración.
- `api/analyze.js`: autenticación, cuotas y consulta de IA en servidor.
- `firestore.rules`: acceso y validación de Firebase.
- `vite.config.js`: compilación y PWA.

Documentación oficial: https://vite.dev/guide/ · https://firebase.google.com/docs/auth/web/anonymous-auth · https://firebase.google.com/docs/firestore/security/get-started · https://firebase.google.com/docs/auth/admin/verify-id-tokens · https://ai.google.dev/gemini-api/docs/structured-output · https://leafletjs.com/reference.html · https://apidocs.geoapify.com/docs/maps/ · https://apidocs.geoapify.com/docs/geocoding/ · https://apidocs.geoapify.com/docs/routing/ · https://apidocs.geoapify.com/docs/places/

Esquemas OpenAPI de Geoapify: https://github.com/geoapify/geoapify-openapi-specs

Los centros de país y las escalas iniciales de `src/country-views.js` derivan de [mledoze/countries](https://github.com/mledoze/countries/tree/6031f5df137c41c76d180c55a0782185ae3ed05b), © sus colaboradores, bajo [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). La tabla derivada conserva esa licencia y aproxima una vista del territorio principal; no define fronteras políticas ni límites para calcular rutas.

### Probar desde un teléfono en la misma Wi-Fi

Abre `INICIAR-EN-CELULAR.bat` en la computadora. En la terminal busca la línea `Network: http://...` y escribe esa dirección en el navegador del teléfono conectado al mismo Wi-Fi. Esto sirve para revisar el diseño; la geolocalización y la instalación PWA requieren HTTPS. En Vercel abre el sitio publicado en el teléfono: Android puede mostrar “Instalar app”; en iPhone, Safari → Compartir → Añadir a pantalla de inicio.
