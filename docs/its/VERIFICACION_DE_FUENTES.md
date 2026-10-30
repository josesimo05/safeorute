# Fase 1 — verificación de versiones y APIs

Fecha de consulta: 29 de octubre de 2026. Este documento verifica existencia y semántica en fuentes oficiales; **no registra una instalación, prueba de compatibilidad, benchmark, auditoría de seguridad ni certificación del sistema**. Los paquetes no se han instalado para esta fase.

## Cómo interpretar los estados

- **D — documentación oficial consultada:** README, manual o documentación mantenida por el proyecto, incluidos sus archivos en el repositorio oficial.
- **C — código oficial consultado:** implementación, firmas o comentarios de API en una versión identificada. Se distingue de haber leído el portal de documentación.
- **M — metadatos oficiales consultados:** versión y requisitos publicados por el proyecto en PyPI. Confirma publicación; no funcionamiento conjunto.
- **P — pendiente:** verificación concreta durante el MVP o información/decisión del usuario. No significa que el usuario deba investigar las APIs que ya verificamos.

Varios portales de documentación devolvieron HTTP 403 en este entorno. Se consultaron documentos y código de sus repositorios oficiales cuando estuvieron disponibles. No se presentan los portales bloqueados como leídos. Las ramas `main` son fuentes móviles: en el MVP se fijará su commit antes de depender de ellas.

## Stack candidato del piloto CPU

| Componente / versión propuesta | Estado comprobado | API o característica efectivamente comprobada | Pendiente del MVP o del usuario |
|---|---|---|---|
| CPython **3.12.14** | D; intérprete local identifica esa versión | `time.monotonic_ns()` y `time.time_ns()` en documentación oficial de esa versión | Imagen base, digest, parche de seguridad vigente y ejecución del contenedor final |
| PyAV **19.0.2** | C, M | `av.open`, `InputContainer.decode`, `demux`, `VideoFrame.to_ndarray`, `Frame.pts`, `Frame.time_base`, `av.library_versions`; Python >=3.12 | Codec y timestamps de cada fuente; FFmpeg realmente enlazado; plataforma del wheel |
| YOLOX, código **0.3.0** | D, C | Ejemplo oficial de inferencia ONNX, pre/postprocesamiento y Nano/Tiny; clases COCO | Descargar el artefacto elegido, SHA-256, licencia aplicable a pesos/datos, precisión local y latencia |
| Pesos ONNX oficiales de YOLOX Nano/Tiny, release **0.1.1rc0** | D: enlaces oficiales y entrada 416×416 documentados | Artefactos enlazados por el README ONNX de YOLOX 0.3.0; versión de pesos y código son diferentes | No descargados ni ejecutados; no hay hash inventado ni equivalencia implícita entre releases |
| ONNX Runtime CPU **1.22.1** | C, M | `InferenceSession`, `get_inputs()`, `run()` y argumento `providers`; Python >=3.10 | Operadores del modelo, forma/tipo de entrada y rendimiento en CPU real |
| NumPy **2.2.6** | C, M | `numpy.linalg.inv` y `numpy.linalg.lstsq` en fuente versionada | Compatibilidad de los binarios de OpenCV/ORT con este conjunto y pruebas numéricas |
| `opencv-python` **4.11.0.86**, OpenCV **4.11.0** | C, M | `VideoCapture`, `findHomography`, `getPerspectiveTransform`, `perspectiveTransform`; propiedades de backend/timeout/PTS documentadas en cabeceras oficiales | Binding Python y backend del contenedor, distorsión y calibración real; no se ejecutaron estas funciones aquí |
| Supervision / ByteTrack **0.26.1** | C, M | `ByteTrack(...)`, `update_with_detections(...)`, `reset()`; tipo `Detections` | Cadencia procesada, configuración de pérdidas, oclusiones, motos e ID switches |
| FastAPI **0.162.0** | D, C, M | Ejemplo oficial con `FastAPI.get`, `FastAPI.websocket`, `WebSocket.accept`, `receive_text`, `send_text` | Contratos propios, autenticación y pruebas REST/WS. El WebSocket necesita contrato separado; OpenAPI no lo documenta automáticamente |
| Pydantic **2.14.2** | C, M | `BaseModel.model_validate`, `model_dump` | Validadores del dominio, unidades y timestamps; paquete publicado el día de esta consulta, sin prueba de madurez local |
| `uvicorn[standard]` **0.54.0** | C, M | `uvicorn.run`; el extra incorpora dependencias para soporte WebSocket | Lock exacto de transitivas y arranque detrás de TLS/proxy real |
| `SQLAlchemy[asyncio]` **2.1.6** | C, M | `create_async_engine`, dialecto `postgresql+psycopg` | Migraciones, transacciones, pool, concurrencia y compatibilidad conjunta |
| `psycopg[binary]` **3.3.6** | C, M | `AsyncConnection.connect`; binario empaquetado disponible según plataforma | libpq incluido, arquitectura, conexiones LISTEN dedicadas y obligaciones de distribución |
| PostgreSQL **17.10** | D, C | Tag oficial, `jsonb`, `LISTEN/NOTIFY`; notificación asociada al commit | Disponibilidad de imagen/digest, backups, restauración y política de actualizaciones |
| Docker Compose **2.40.3** | D | Release oficial; especificación `healthcheck` y `depends_on: condition: service_healthy` | Docker Engine/host y límites de recursos. Compose no sustituye reintentos ni readiness de aplicación |

Son versiones **candidatas de diseño**, no un lock de producción. El MVP resolverá dependencias transitivas con hashes, ejecutará smoke tests del conjunto y analizará vulnerabilidades/licencias. Si una versión necesita un parche, se actualizará con pruebas y registro de la decisión antes de desplegar.

### Decisiones de empaquetado verificadas

1. Supervision 0.26.1 requiere `opencv-python`. No instalar a la vez `opencv-python-headless`: comparten el espacio `cv2`. Para este baseline se usa `opencv-python` con las bibliotecas de sistema necesarias, aunque el trabajador no abra ventanas. La alternativa de mantener ByteTrack directamente y usar headless requeriría una decisión y mantenimiento explícitos.
2. Uvicorn base puede no incluir un motor WebSocket; se propone el extra `standard`. SQLAlchemy 2.1 requiere su extra `asyncio` para incorporar `greenlet` en este uso.
3. No instalar a la vez ORT CPU y una variante GPU esperando una selección automática. La rama GPU queda pendiente del hardware y matriz CUDA/cuDNN comprobada. **No se propone `onnxruntime-gpu==1.22.1`: su consulta de metadatos no fue satisfactoria.** La existencia de la versión CPU no implica la del paquete GPU.
4. Instalar un ejecutable FFmpeg externo no modifica automáticamente las bibliotecas que usa PyAV. Registrar las versiones de `av.library_versions` y la configuración/licencias de la imagen concreta.
5. Las licencias declaradas en las fuentes incluyen Apache 2.0 para YOLOX/OpenCV, MIT para ORT/Supervision/FastAPI/Pydantic/SQLAlchemy, BSD para NumPy/Uvicorn/PyAV y LGPL-3.0-only para psycopg. La licencia del código no demuestra por sí sola los derechos sobre los pesos, imágenes de entrenamiento, codecs o cámaras: revisar los artefactos realmente distribuidos.

## Detalles de API que condicionan el diseño

### Tracking

En Supervision 0.26.1 se verificó la firma:

`ByteTrack(track_activation_threshold=0.25, lost_track_buffer=30, minimum_matching_threshold=0.8, frame_rate=30, minimum_consecutive_frames=1)`.

Estos son valores predeterminados de la librería, **no una recomendación validada para nuestras cámaras**. `frame_rate` escala el buffer de pérdida, pero cada actualización incrementa un frame interno: configurar según la cadencia procesada y usar tiempo real para reglas y velocidad. Reiniciar el tracker al cambiar de época del stream. ByteTrack aprovecha detecciones de menor puntuación; filtrar todas a 0.5 antes de asociarlas puede perjudicarlo. La puntuación de detección nunca se convierte en confianza de una causa.

COCO contiene los índices base cero `car=2`, `motorcycle=3`, `bus=5`, `truck=7`. No contiene accidente, avería, escombros ni conos. `traffic light` no significa estado rojo/verde ni diagnóstico de funcionamiento. La categoría dominicana de guagua/minibús necesita definición operativa y validación local.

### Geometría

El umbral de reproyección de `findHomography` está en las unidades del destino. Si se ajusta imagen→suelo en metros, `3.0` significa tres metros, no tres píxeles. El diseño propone ajustar suelo→imagen con tolerancia en píxeles deliberada, invertir y verificar puntos de control independientes en metros. `getPerspectiveTransform` con cuatro puntos no elimina la necesidad de validar ni la degeneración geométrica.

### Video y relojes

PyAV usa `frame.pts * frame.time_base` como tiempo de presentación. Es tiempo relativo del medio, no necesariamente UTC de captura. El parámetro `av.open(timeout=...)` se expresa en segundos, incluido el par apertura/lectura documentado en la fuente. Las opciones FFmpeg RTSP `timeout` y genérica `rw_timeout` emplean microsegundos; no intercambiarlas sin conversión.

Como referencia adicional se leyó documentación FFmpeg **8.0** de `rtsp_transport=tcp`, `timeout` y `rw_timeout`; esto **no afirma que PyAV 19.0.2 esté enlazado exactamente a FFmpeg 8.0**.

OpenCV 4.11.0 documenta `CAP_PROP_OPEN_TIMEOUT_MSEC=53` y `CAP_PROP_READ_TIMEOUT_MSEC=54` solo al abrir y solo con FFmpeg/GStreamer. `CAP_PROP_POS_MSEC` está documentado para archivos; no es una autoridad fiable de captura RTSP. `CAP_PROP_PTS=71` existe con FFmpeg, expresado en base temporal FPS: exige validación de backend/monotonicidad. `CAP_PROP_STREAM_OPEN_TIME_USEC` indica apertura de conexión, no captura.

El baseline usa PyAV para ingesta temporal y OpenCV para operaciones de imagen/geometría; no mezcla silenciosamente relojes entre decodificadores.

## APIs y fuentes de GPS para la validación

| Fuente / versión | Verificación real | Límite y pendiente |
|---|---|---|
| Android Location, AOSP Android 8/API 26 y Android 15/API 35 | C: `getSpeed`, `hasSpeed`, `getSpeedAccuracyMetersPerSecond`, `hasSpeedAccuracy`, `getElapsedRealtimeNanos`; velocidad m/s y semántica de precisión documentada | Usuario confirma teléfono/logger, campos exportados, frecuencia y calidad real. Tiempo monotónico no compara relojes de dispositivos distintos |
| W3C Geolocation, editor draft consultado el 29-10-2026 | D: `watchPosition`, `speed` nullable m/s y precisión horizontal; no garantiza muestreo periódico ni campo `speedAccuracy` | Es especificación en desarrollo, no prueba de implementación de todos los navegadores. Verificar el teléfono concreto; no sirve para prometer 5–10 Hz |
| Apple `CLLocation.speedAccuracy` | P: el portal oficial no pudo consultarse por bloqueo | No se asume en el MVP ni en el plan Android. Verificar documentación/dispositivo si se elige iOS |

La precisión horizontal Android y la descrita por W3C no tienen idéntica semántica de cobertura. Ninguna debe usarse sin conversión/validación como desviación estándar de velocidad para la fusión.

## Fuentes oficiales consultadas

- [CPython 3.12.14, tiempo](https://github.com/python/cpython/blob/v3.12.14/Doc/library/time.rst).
- [YOLOX 0.3.0, ONNX README y enlaces a pesos](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/demo/ONNXRuntime/README.md).
- [YOLOX, inferencia ONNX](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/demo/ONNXRuntime/onnx_inference.py).
- [YOLOX Nano](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/exps/default/yolox_nano.py), [clases COCO](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/yolox/data/datasets/coco_classes.py), [licencia](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/LICENSE).
- [ORT 1.22.1, API](https://github.com/microsoft/onnxruntime/blob/v1.22.1/onnxruntime/python/onnxruntime_inference_collection.py) y [metadatos](https://pypi.org/project/onnxruntime/1.22.1/).
- [NumPy 2.2.6, álgebra lineal](https://github.com/numpy/numpy/blob/v2.2.6/numpy/linalg/_linalg.py), [metadatos](https://pypi.org/project/numpy/2.2.6/).
- [OpenCV Python 4.11.0.86](https://pypi.org/project/opencv-python/4.11.0.86/).
- [OpenCV 4.11.0, video](https://github.com/opencv/opencv/blob/4.11.0/modules/videoio/include/opencv2/videoio.hpp), [homografía](https://github.com/opencv/opencv/blob/4.11.0/modules/calib3d/include/opencv2/calib3d.hpp), [perspectiva](https://github.com/opencv/opencv/blob/4.11.0/modules/core/include/opencv2/core.hpp), [cuatro puntos](https://github.com/opencv/opencv/blob/4.11.0/modules/imgproc/include/opencv2/imgproc.hpp).
- [Supervision 0.26.1, ByteTrack](https://github.com/roboflow/supervision/blob/0.26.1/supervision/tracker/byte_tracker/core.py), [metadatos y dependencias](https://pypi.org/project/supervision/0.26.1/).
- [FastAPI 0.162.0, WebSocket oficial](https://github.com/fastapi/fastapi/blob/0.162.0/docs_src/websockets_/tutorial001_py310.py), [metadatos](https://pypi.org/project/fastapi/0.162.0/).
- [Pydantic 2.14.2](https://github.com/pydantic/pydantic/blob/v2.14.2/pydantic/main.py), [metadatos](https://pypi.org/project/pydantic/2.14.2/).
- [Uvicorn 0.54.0](https://github.com/Kludex/uvicorn/blob/0.54.0/uvicorn/main.py), [metadatos](https://pypi.org/project/uvicorn/0.54.0/).
- [SQLAlchemy 2.1.6, asyncio](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_6/lib/sqlalchemy/ext/asyncio/engine.py), [dialecto psycopg](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_6/lib/sqlalchemy/dialects/postgresql/psycopg.py), [metadatos](https://pypi.org/project/SQLAlchemy/2.1.6/).
- [psycopg 3.3.6](https://github.com/psycopg/psycopg/blob/3.3.6/psycopg/psycopg/connection_async.py), [metadatos](https://pypi.org/project/psycopg/3.3.6/).
- [PyAV 19.0.2, apertura](https://github.com/PyAV-Org/PyAV/blob/v19.0.2/av/container/core.py), [decodificación](https://github.com/PyAV-Org/PyAV/blob/v19.0.2/av/container/input.py), [frame](https://github.com/PyAV-Org/PyAV/blob/v19.0.2/av/frame.py), [VideoFrame](https://github.com/PyAV-Org/PyAV/blob/v19.0.2/av/video/frame.py), [metadatos](https://pypi.org/project/av/19.0.2/).
- [PostgreSQL 17.10](https://github.com/postgres/postgres/blob/REL_17_10/configure.ac), [JSON](https://github.com/postgres/postgres/blob/REL_17_10/doc/src/sgml/json.sgml), [NOTIFY](https://github.com/postgres/postgres/blob/REL_17_10/doc/src/sgml/ref/notify.sgml).
- [Compose 2.40.3](https://github.com/docker/compose/tree/v2.40.3), [especificación oficial de servicios](https://github.com/compose-spec/compose-spec/blob/main/05-services.md).
- [FFmpeg 8.0, protocolos](https://github.com/FFmpeg/FFmpeg/blob/n8.0/doc/protocols.texi).
- [Android 8, Location.java](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-8.0.0_r1/location/java/android/location/Location.java), [Android 15](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/location/Location.java).
- [W3C Geolocation, documento fuente oficial](https://github.com/w3c/geolocation/blob/main/index.html).
- [Apple, consulta pendiente](https://developer.apple.com/documentation/corelocation/cllocation/speedaccuracy).

## Dataset opcional: referencia real, no recurso asumido

Se verificó la existencia de [BrnoCompSpeed y su README oficial](https://github.com/JakubSochor/BrnoCompSpeed). El README indica solicitar acceso al autor y que su código de evaluación histórico usa Python 2. **No se descargó el dataset, no se verificó su licencia para este uso ni se propone ejecutar ese evaluador heredado como dependencia de producción.** Puede ser referencia metodológica si se obtiene autorización; no sustituye validación dominicana ni se afirma que incluya todos los tipos de vehículo/causas solicitados.

El piloto utilizará, por defecto, material propio/autorizado disponible en lectura. Un stream visible públicamente no constituye por sí solo permiso de uso, redistribución o validación.

## Datos que debe confirmar el usuario

Integración, ciudad/tipo de vía, cantidades, acceso autorizado, hardware/arquitectura, presupuesto, SLA, audiencia/operadores, puntos medidos, teléfono de prueba, disponibilidad GPS/contexto, usuarios y retención. El resto de comprobaciones técnicas pendientes —lock, binarios, modelo, pruebas y perfilado— se realizará durante el MVP después de aprobar esta fase.
