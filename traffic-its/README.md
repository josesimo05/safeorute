# SafeRoute ITS — MVP de una cámara

Servicio Python separado para detectar y seguir vehículos, contar cruces por carril, estimar velocidad **cuando hay calibración válida**, observar congestión y comunicar estado por REST y WebSocket. Incluye un dashboard móvil de metadatos, sin mostrar ni guardar video.

La demostración usa objetos y geometría **sintéticos**, identificados como tales en API y dashboard. Prueba funcionamiento y recuperación, no precisión de detección ni de velocidad en República Dominicana. El adaptador real carga YOLOX Nano ONNX y ByteTrack; una fuente real nunca se convierte silenciosamente en simulación si falla.

Este MVP corresponde a la Fase 2 del [diseño aprobado](../docs/its/FASE_1_DISENO.md). Multicámara, fusión de GPS y clasificación de las ocho causas requieren sus fases y validación. Un fallo de cámara tiene su alerta separada. La aplicación no afirma accidente, avería, escombros ni semáforo dañado por detectar una cola.

El [recorrido técnico del MVP](../docs/its/FASE_2_MVP.md) explica los módulos, contratos, diferencias respecto del diseño y comprobaciones de esta entrega.

## Empezar con la demostración local

Se necesita Python 3.12 y un sistema compatible con los wheels bloqueados. Desde esta carpeta, con [uv](https://docs.astral.sh/uv/):

```bash
uv venv .venv --python python3.12
uv pip install --python .venv/bin/python --require-hashes -r requirements-dev.lock
uv pip install --python .venv/bin/python --no-deps -e .
.venv/bin/python -m traffic_its.cli demo --host 127.0.0.1 --port 8000
```

Abre `http://127.0.0.1:8000/`. El comando inicia API, procesamiento sintético y relay. Detén con Ctrl+C. La base SQLite local está en `data/`, ignorada por Git; conserva solo agregados, salud y alertas, no frames ni trayectorias. Los pesos ONNX no son necesarios para esta demostración.

En Windows usa `python` para crear el entorno y `.venv\Scripts\python.exe` en lugar de `.venv/bin/python`. Si las bibliotecas nativas del sistema no están disponibles, usa Docker.

Para una ejecución breve de comprobación:

```bash
.venv/bin/python -m traffic_its.cli demo --host 127.0.0.1 --port 8000 --duration 20
.venv/bin/python -m traffic_its.cli doctor
```

`doctor` informa versiones, proveedores y configuración relevante. La mera importación de una biblioteca no demuestra rendimiento ni precisión local.

## Docker Compose con PostgreSQL

La composición inicia PostgreSQL, API, trabajador y relay como servicios distintos. Solo la API expone un puerto, enlazado a `127.0.0.1` por defecto.

```bash
python scripts/init_local_env.py
docker compose up --build
```

El script crea `.env` privado con credenciales aleatorias nuevas, conserva un archivo existente y no imprime sus valores. También puedes completar `.env.example` y guardarlo como `.env`. Usa valores hexadecimales aleatorios para la contraseña PostgreSQL, porque forma parte de una URL. No subas `.env` al repositorio.

Abre `http://127.0.0.1:8000/`. El perfil predeterminado es sintético y permite lectura anónima **solo de datos de demostración**. Las acciones de operador requieren `ITS_API_TOKEN`; el dashboard permite introducirlo y lo mantiene en memoria, sin URL ni almacenamiento persistente del navegador.

```bash
docker compose ps
docker compose logs --tail 100 api worker relay
docker compose down
```

`down` conserva el volumen PostgreSQL. No uses `down -v` si necesitas conservar el histórico. La base no publica su puerto al host. Los servicios de aplicación funcionan como usuario sin privilegios, con raíz de solo lectura y `/tmp` temporal; los modelos, las configuraciones y los videos opcionales se montan en lectura.

Los healthchecks verifican proceso/API/base. La salud específica de captura y calidad se consulta en el dashboard; un proceso vivo no implica que la cámara esté enviando datos válidos. Los límites iniciales de CPU/RAM del trabajador son configurables y no equivalen a una capacidad validada.

Los archivos públicos de `configs/` y `models/` montados deben poder leerse desde el UID 10001 del contenedor. Si creaste esos archivos con permisos privados, ajusta su lectura/travesía o prepara un montaje de grupo apropiado; mantén privados los archivos `.env` y las credenciales. El Dockerfile acepta un CA bundle corporativo opcional como secreto BuildKit `build_ca` durante la instalación, sin desactivar TLS ni copiarlo a la imagen.

## Video real autorizado

Primero descarga el modelo oficial fijado por el manifiesto:

```bash
.venv/bin/python -m traffic_its.cli download-model --output models/yolox_nano.onnx
.venv/bin/python -m traffic_its.cli doctor --model models/yolox_nano.onnx
```

`models/manifest.json` registra fuente oficial, release de pesos, entrada y SHA-256 observado. El archivo ONNX está ignorado por Git y no se descarga durante el build Docker. En el entorno de desarrollo se ejecutó el modelo fijado con ONNX Runtime CPU sobre una imagen vacía; ese smoke test comprueba carga/inferencia, no precisión vehicular. Se comprobará su hash antes de inferencia. Ese hash garantiza identidad respecto del artefacto fijado, no es una firma independiente del autor ni una medida de precisión.

Para un archivo con Docker, edita el `.env` ignorado:

```dotenv
ITS_DEMO=false
ITS_CAMERA_CONFIG=file.json
ITS_VIDEO_DIRECTORY=/ruta/absoluta/a/videos-autorizados
ITS_VIDEO_FILENAME=prueba.mp4
```

Luego:

```bash
docker compose -f compose.yaml -f deployment/compose.file.yaml up --build
```

La carpeta se monta en `/inputs` como solo lectura. No se copia el archivo a una base ni se graba otro video. `configs/file.json` comienza sin calibración y sin líneas: detección y salud pueden funcionar, pero la velocidad métrica y el aforo por carril permanecerán **no disponibles** hasta completar geometría y habilitar sus controles. El fin normal del archivo es `replay_finished`, no una caída de cámara. Un replay no actualiza tráfico real ni se publica como una alerta pública vigente.

Para procesos locales separados, crea un `.env.local` privado con `ITS_DATABASE_URL` (por ejemplo una ruta SQLite local), `ITS_API_TOKEN`, `ITS_DEMO=false`, `ITS_CAMERA_SOURCE` y `ITS_MODEL_PATH`. La CLI solo carga ese archivo cuando lo pides explícitamente con `--env-file`, sin ejecutarlo como código de shell:

```bash
.venv/bin/python -m traffic_its.cli --env-file .env.local api --host 127.0.0.1 --port 8000
.venv/bin/python -m traffic_its.cli --env-file .env.local worker --config configs/file.json
.venv/bin/python -m traffic_its.cli --env-file .env.local relay
```

Cada comando ocupa su terminal. Todos deben compartir la misma base y configuración del entorno. El `.env` de Compose no se carga automáticamente en procesos locales; el hostname `db` de Docker solo existe en su red interna. No escribas una URI RTSP con contraseña en un comando guardado en el historial ni en un archivo versionado; usa el mecanismo de secretos de tu entorno.

## Cámara RTSP autorizada

Configura en `.env`:

- `ITS_DEMO=false`.
- `ITS_CAMERA_CONFIG=rtsp.json`.
- `ITS_CAMERA_SOURCE`: URI real de una cámara a la que tengas acceso autorizado, mantenida como secreto.

```bash
docker compose -f compose.yaml -f deployment/compose.rtsp.yaml up --build
```

La conectividad a la cámara debe existir desde el trabajador, normalmente mediante LAN o VPN. No se necesita publicar RTSP en Internet. El runtime usa el valor de la variable referida por la configuración; el dashboard y las respuestas públicas no reciben esa URI.

Los timeouts, la reconexión y la salud evitan que una lectura fallida se presente como velocidad cero. PTS del medio y llegada al sistema son relojes diferentes. La edad de captura se marca desconocida si no existe una correspondencia UTC fiable; una imagen recibida ahora podría contener una escena retrasada.

## Calibrar una fuente real

Copia el ejemplo apropiado de `configs/` a una configuración privada de tu instalación. Usa `schema_version: "0.1.0"`; las plantillas `1.0-design` de la Fase 1 se reconocen como documentos de diseño, no como calibración operativa.

1. Fija posición, resolución, zoom y preset. La cámara PTZ debe quedar inmóvil para esa calibración.
2. Mide referencias sobre el pavimento en metros. Añade correspondencias `fit_points_image_px` y `fit_points_ground_m`, con al menos cuatro puntos no colineales; se recomiendan 8–12 para ajustar.
3. Añade al menos cuatro `independent_control_points` diferentes de las referencias de ajuste. Guarda cada par `image_px` / `ground_m` y el error medido en `validation_rmse_metres`; el runtime comprueba otra vez la geometría. La meta inicial de aceptación geométrica es RMSE ≤0,5 m, no una precisión demostrada de esta cámara.
4. Define `frame_size_px`, `valid_roi_image_px`, `camera_fixed`, `calibration_id` y estado `valid`. Define cada carril con `polygon_image_px` y su `centerline_ground_m`; define líneas con dos puntos, carril y dirección de cruce.
5. Solo entonces habilita `metric_speed_enabled` y/o `lane_flow_enabled`. Una geometría incompleta, inválida o con error independiente excesivo se rechaza o deja la medición no disponible.
6. Valida con recorridos y una referencia temporal independiente antes de usar cifras operativamente. Consulta el [plan con carro y GPS](../docs/its/VALIDACION_VELOCIDAD.md).

Los números de `demo.json` corresponden a una escena generada y **no sirven para calibrar una cámara real**. El punto inferior de la caja es una aproximación al contacto con la vía y puede fallar con oclusión/sombras. La velocidad usa observaciones reales y timestamps del medio; no suma movimientos de jitter ni posiciones predichas para inventar distancia.

## API e integración

La API se documenta en `/docs` y publica `/openapi.json`. La autenticación de este piloto usa un token Bearer de operador; la integración con identidad federada y permisos organizacionales debe acordarse antes de un despliegue público. Fuera de demostración, se requiere token para leer los recursos operativos. Las mutaciones lo requieren siempre.

| Recurso | Uso |
|---|---|
| `GET /healthz`, `GET /readyz` | Vida y preparación del servicio |
| `GET /v1/snapshot` | Cámaras, estados, alertas y cursor inicial |
| `GET /v1/cameras` | Configuración no sensible y estado por cámara |
| `GET /v1/cameras/{id}/health` | Salud y vigencia |
| `GET /v1/segments/{id}/state` | Último estado de un tramo |
| `GET /v1/metrics/history?camera_id=...` | Histórico agregado, con límite y filtros |
| `GET /v1/alerts` | Observaciones y alertas disponibles para el rol |
| `POST /v1/alerts/{id}/review` | Revisión del operador |
| `GET /v1/events?cursor=...` | Recuperación durable de eventos |
| `WS /v1/stream` | Actualizaciones y reanudación |

Listados devuelven `{ "items": [...] }`. El snapshot devuelve cámaras/estados/alertas, `cursor` como cadena y hora del servidor. El WebSocket tiene un contrato propio, separado de OpenAPI:

1. Conectar por `wss` cuando haya TLS; durante desarrollo local se usa `ws`.
2. Enviar como primer mensaje `{ "token": "...", "cursor": "0" }`; no poner el token en el query string.
3. Recibir mensajes `stream.ready` y eventos con `event_id`, `entity_id`, `revision`, `cursor`, `event_type`, `payload`, `created_at`.
4. Deduplicar por `event_id`, conservar revisión por entidad y reconectar desde el último cursor aplicado. La entrega es al menos una vez, no exactamente una.
5. Un cursor vencido produce HTTP 410 o `resync_required`; obtener un nuevo snapshot y reanudar. La retención inicial de eventos es de siete días.

PostgreSQL/SQLite conserva cambios y outbox transaccional. El relay asigna el orden de entrega después de confirmar las transacciones; no usa IDs concurrentes como si fueran orden de commit. Reintentar una ventana reemplaza su snapshot sin incrementar el conteo otra vez.

SafeRoute puede consumir estos contratos desde su frontend mientras el servicio se ejecuta en un host persistente. Configura `ITS_ALLOWED_ORIGINS` con los orígenes exactos autorizados y un dominio HTTPS para la API. El MVP no instala automáticamente un servidor en Vercel ni expone cámaras en la aplicación existente.

## Privacidad y límites del MVP

- No se almacenan frames, video, rostros, placas, trayectorias ni identificadores persistentes de vehículos.
- Los IDs del tracker viven en memoria y se reinician por época; el histórico contiene agregados.
- GPS, fusión y diagnósticos específicos de las ocho causas no están habilitados en esta fase.
- Una cámara caída, desenfocada o con tiempo inválido produce salud/calidad degradada; no se convierte en tráfico detenido ni en tráfico recuperado.
- Las alertas separan **Observado** de **Causa probable**. La confianza cualitativa no es el score del detector ni una probabilidad validada.
- No se ejecutan acciones sobre semáforos, cierres ni servicios de emergencia.

La CPU y el modelo pequeño priorizan un piloto económico. Noche, lluvia, motos pequeñas y oclusión pueden requerir otro encuadre, más resolución o un modelo ajustado. No hay resultados locales que demuestren aún las metas de precisión de la Fase 1; la simulación y el smoke test del modelo no los sustituyen.

## Pruebas y diagnóstico

```bash
.venv/bin/python -m pytest
.venv/bin/python -m traffic_its.cli doctor
```

Las pruebas cubren configuración, tiempos/ingesta, seguimiento, geometría, conteo, salud, persistencia, recuperación y acceso API. El dashboard se comprueba aparte en navegador. Los fixtures temporales de pruebas pueden generar un video en una carpeta de ensayo eliminable; el servicio productivo no graba video.

La validación de datos reales se documenta en [FASE_1_DISENO.md](../docs/its/FASE_1_DISENO.md), [VALIDACION_VELOCIDAD.md](../docs/its/VALIDACION_VELOCIDAD.md) y [VERIFICACION_DE_FUENTES.md](../docs/its/VERIFICACION_DE_FUENTES.md).

## Versiones y despliegue

Los requisitos directos están en `pyproject.toml`; `requirements.lock` y `requirements-dev.lock` bloquean versiones transitivas con hashes. Docker instala el lock de runtime; no vuelve a resolver dependencias ni incluye tests, el entorno virtual o fuentes de video del host.

Docker Compose utiliza PostgreSQL 17.10 y la imagen Python 3.12.14. Verificar el digest de las imágenes del despliegue, restauración de backups, actualizaciones de seguridad y capacidad con la cámara real forma parte de la preparación operativa. El piloto no constituye una certificación de disponibilidad, precisión o idoneidad para sancionar.

Las atribuciones de YOLOX, Leaflet y dependencias se conservan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), incluido el [texto completo Apache 2.0 de YOLOX](licenses/YOLOX-Apache-2.0.txt).
