# Probar SafeRoute ITS desde Internet

Esta configuración publica **una demostración sintética de lectura** con el backend Python, REST, WebSocket y dashboard. No conecta cámaras, Firebase ni datos de dispositivos. La velocidad, el aforo y la congestión que aparecen son generados para probar el recorrido del programa; no describen el tránsito de Santo Domingo.

El archivo [render.yaml](../../render.yaml) está preparado para crear un servicio web Docker en Render. El enlace siguiente abre el flujo de despliegue del proveedor; **no es una demo ya desplegada**.

[Desplegar la demo en Render](https://render.com/deploy?repo=https://github.com/josesimo05/safeorute)

## Crear el enlace público

1. Abre el enlace e inicia sesión en tu cuenta de Render. Selecciona el repositorio `josesimo05/safeorute` y el Blueprint de la raíz, `render.yaml`, si el proveedor lo solicita.
2. Revisa que se cree únicamente `safeorute-its-demo`, con runtime Docker y plan `free`. Confirma las condiciones y disponibilidad actuales en tu cuenta antes de crear el servicio. El manifiesto no solicita una base de pago, un disco persistente ni un cambio automático a un plan de pago. La oferta gratuita, su disponibilidad y límites dependen de Render.
3. Crea el servicio y espera a que termine el build. El punto de entrada es `python -m traffic_its.public_demo`; escucha el puerto `PORT` que proporciona el proveedor y sirve el dashboard en `/`.
4. Abre la URL HTTPS que Render asigne y compártela para la prueba. No se predice aquí el nombre de host: el nombre solicitado puede necesitar un sufijo o ya estar ocupado.

No hace falta copiar una clave de Firebase, Geoapify, cámara o cuenta de servicio. Este despliegue no usa un token de operador y mantiene las revisiones/escrituras sin autorización deshabilitadas. No añadas credenciales de cámaras a este servicio de prueba.

Render debe proporcionar `RENDER_EXTERNAL_URL` para admitir el origen HTTPS exacto del WebSocket detrás de su proxy. El módulo de arranque utiliza esa URL del proveedor; no necesita un comodín CORS. Si se usa otro proveedor, configura el origen HTTPS público mediante `ITS_PUBLIC_ORIGIN` y comprueba la conexión WebSocket desde ese origen. La entrada pública configura internamente `ITS_ALLOWED_ORIGINS` con ese origen exacto.

## Qué probar

El escenario inicial `ITS_DEMO_SCENARIO=congestion` genera vehículos lentos con geometría sintética conocida. El programa conserva el periodo de evidencia de la regla: espera unos 30 segundos de mediciones elegibles antes de abrir la alerta de congestión. No reduzcas ese tiempo para presentarlo como una alerta real más rápida.

- Al abrir `/`, debe verse el aviso de **demostración sintética**, la salud de cámara y la velocidad generada.
- El contador por carril debe crecer y el histórico debe actualizarse.
- En el escenario congestionado debe aparecer una alerta con **Observado** separado de **Causa probable**. La causa queda no determinada, de confianza baja; no afirma un accidente ni una avería.
- La conexión debe indicar que recibe actualizaciones. En las herramientas del navegador, `/v1/stream` debe usar `wss`, completar la conexión y recibir estados/eventos.
- Comprueba la interfaz desde un celular y desde escritorio. El mapa base externo es opcional; los datos del ensayo no dependen de sus imágenes.

Puedes cambiar `ITS_DEMO_SCENARIO` a `fluido` y reiniciar el servicio para otro ensayo. Los escenarios y las horas del video pertenecen a la simulación, no a una cámara real.

Para una comprobación HTTP externa, reemplaza el ejemplo por la URL HTTPS que haya asignado el proveedor:

```bash
curl --fail https://TU-SERVICIO.onrender.com/readyz
curl --fail https://TU-SERVICIO.onrender.com/v1/snapshot
```

La primera respuesta debe indicar preparación del servicio y conexión a la base de ensayo. El snapshot debe declarar fuente `demo`; preparación no equivale a precisión validada de una cámara. La recuperación por WebSocket empieza con un mensaje `{"cursor":"0"}` y no requiere un token en este perfil público de lectura.

Con las dependencias del proyecto instaladas puedes ejecutar la comprobación integral contra la URL asignada:

```bash
.venv/bin/python scripts/smoke_public_demo.py https://TU-SERVICIO.onrender.com --scenario congestion
```

Espera hasta 90 segundos y comprueba REST, WebSocket, velocidad sintética de 8 km/h, incremento del aforo, cobertura histórica, cursor, alerta con al menos 30 segundos de evidencia y rechazo de cambios anónimos. Termina con JSON y código de salida cero solo si pasan las comprobaciones. Mantiene la verificación TLS y no solicita credenciales. Ese resultado es funcional, no un benchmark de precisión. Para el escenario de 30 km/h usa `--scenario fluido`.

## Duración y datos del ensayo

SQLite y sus agregados son **efímeros**. Un reinicio, nueva instancia o despliegue puede reiniciar la simulación y su histórico. Los planes gratuitos pueden suspender instancias por inactividad; verifica esa política y espera el arranque cuando vuelvas a abrir el enlace. Esta configuración no ofrece disponibilidad permanente, retención garantizada ni capacidad multicámara.

`autoDeploy: false` evita que una nueva subida a GitHub se publique automáticamente en este servicio; para probar una versión nueva usa el despliegue manual del proveedor. Esto no cambia la aplicación SafeRoute ya publicada en Vercel.

Para producción hacen falta otro perfil de despliegue, histórico persistente, autenticación de operadores, una cámara autorizada y calibrada, validación de precisión y capacidad con el hardware de destino. La demo pública no demuestra esas condiciones.

## Fuentes y estado de verificación

Consultado el 2 de noviembre de 2026:

- [Ejemplo oficial FastAPI de Render](https://github.com/render-examples/fastapi/blob/main/render.yaml): servicio web, plan `free`, arranque con `PORT` y `autoDeploy`.
- [README oficial FastAPI](https://github.com/render-examples/fastapi/blob/main/README.md): flujo de creación del servicio y enlace oficial `render.com/deploy?repo=...`.
- [Ejemplo oficial RAG](https://github.com/render-examples/rag-engine/blob/main/render.yaml): runtime Docker, `dockerfilePath`, `dockerContext` y comprobación HTTP de salud.
- [Ejemplo oficial MCP Toolshed](https://github.com/render-examples/mcp-toolshed/blob/main/render.yaml): runtime Docker y `dockerCommand`.
- [Ejemplo oficial de workflows Pydantic](https://github.com/render-examples/pydantic-agents-workflows/blob/main/render.yaml): uso de `rootDir` para un servicio dentro del repositorio.
- [Especificación de Blueprints](https://render.com/docs/blueprint-spec) y [esquema JSON de Render](https://render.com/schema/render.yaml.json): el acceso desde este entorno fue rechazado por el proxy con HTTP 403. La validación completa del manifiesto por el servicio de Render y el build en esa plataforma quedan pendientes hasta crear el servicio.

La configuración del repositorio y las pruebas locales no crean una cuenta, un servicio o una URL pública por sí mismas. No se dispone aquí de una sesión o credencial de Render con la que confirmar un despliegue remoto.

Se comprobó el parseo YAML local, que existe un único servicio de prueba sin base o disco adicional y que las rutas de contexto/Dockerfile resuelven dentro de `traffic-its/`. Esta comprobación local no sustituye al validador del proveedor.
