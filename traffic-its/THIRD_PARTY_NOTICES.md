# Componentes de terceros — SafeRoute ITS

Este documento conserva atribuciones de componentes usados por el MVP. No es una auditoría jurídica ni una revisión de vulnerabilidades, y no asigna una licencia nueva al código propio del proyecto. Las versiones de instalación y sus hashes están en `requirements.lock`; las dependencias de prueba están en `requirements-dev.lock`.

## Adaptación de YOLOX

La preparación de imagen, decodificación de la cuadrícula y supresión de cajas de `src/traffic_its/vision.py` siguen los ejemplos y utilidades de **YOLOX 0.3.0**, publicados bajo **Apache License 2.0**.

Avisos conservados de los archivos fuente originales:

> Copyright (c) Megvii Inc. All rights reserved.
>
> Copyright (c) Megvii, Inc. and its affiliates.

Fuentes oficiales de la adaptación:

- [Ejemplo de inferencia ONNX](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/demo/ONNXRuntime/onnx_inference.py).
- [Utilidades de demostración, decodificación y NMS](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/yolox/utils/demo_utils.py).
- [Preparación y transformaciones de imagen](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/yolox/data/data_augment.py).
- [Licencia original](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.3.0/LICENSE).

Cambios para este MVP: adaptador con los contratos internos de SafeRoute ITS; ejecución ONNX CPU; comprobación de SHA-256 y forma de entrada/salida; filtrado de vehículos COCO; validación y recorte de coordenadas; salida sin guardar imágenes. El generador y detector sintéticos son fixtures de demostración separados, no resultados de YOLOX sobre tránsito real.

Se incluye el **texto completo obtenido del repositorio oficial versionado** en [licenses/YOLOX-Apache-2.0.txt](licenses/YOLOX-Apache-2.0.txt). Debe conservarse al distribuir la adaptación. El SHA-256 del texto consultado es `0ec3668d3274bcf29e8a29e9576d5a2cd96fc78d3c5bec4387355a796e5d9088`.

Los pesos `yolox_nano.onnx` proceden del release oficial `0.1.1rc0`, mientras el ejemplo de código consultado pertenece a `0.3.0`. El manifiesto [models/manifest.json](models/manifest.json) conserva fuente, versiones y hash observado. El peso no está incorporado al repositorio ni se descarga automáticamente al construir Docker. Su identidad comprobada no equivale a certificación de precisión, firma independiente del editor ni una evaluación completa de derechos sobre datos de entrenamiento.

## Leaflet y mapa

El dashboard incorpora **Leaflet 1.9.4**, con sus archivos distribuidos y su [licencia BSD-2-Clause](src/traffic_its/static/vendor/leaflet/LICENSE) conservada junto a ellos.

> Copyright (c) 2010–2023, Volodymyr Agafonkin
>
> Copyright (c) 2010–2011, CloudMade

La biblioteca se sirve localmente; los tiles del mapa, cuando hay conexión, son un servicio externo. La interfaz conserva la atribución a **© OpenStreetMap contributors** y el enlace a [su página de copyright](https://www.openstreetmap.org/copyright). La licencia de Leaflet no concede derechos ilimitados de descarga, almacenamiento o redistribución del servicio de tiles. Este MVP no descarga mapas masivamente ni guarda tiles como archivo propio.

## Dependencias directas de ejecución

Las licencias indicadas se comprobaron en metadatos y archivos de las distribuciones instaladas; los binarios pueden incorporar componentes con avisos adicionales.

| Distribución | Versión fijada | Licencia principal declarada |
|---|---:|---|
| PyAV (`av`) | 19.0.2 | BSD-3-Clause para el wrapper; FFmpeg enlazado tiene sus propias condiciones |
| FastAPI | 0.162.0 | MIT |
| NumPy | 2.2.6 | BSD-3-Clause y avisos de componentes incluidos en sus wheels |
| ONNX Runtime | 1.22.1 | MIT |
| OpenCV Python | 4.11.0.86 | Apache 2.0; consultar también sus avisos de terceros |
| Pydantic | 2.14.2 | MIT |
| psycopg / psycopg-binary | 3.3.6 | LGPL-3.0-only y condiciones de bibliotecas incluidas |
| SQLAlchemy | 2.1.6 | MIT |
| Supervision | 0.26.1 | MIT; ByteTrack se utiliza a través de este paquete |
| Uvicorn | 0.54.0 | BSD-3-Clause |

Se preservan los archivos de licencia que instala cada wheel, por ejemplo:

- `av-*.dist-info/licenses/`.
- `numpy-*.dist-info/LICENSE.txt`, con avisos adicionales de bibliotecas numéricas incluidas.
- `onnxruntime/LICENSE`.
- `cv2/LICENSE.txt` y `cv2/LICENSE-3RD-PARTY.txt`.
- Los directorios `licenses/` de FastAPI, Pydantic, psycopg, SQLAlchemy, Supervision y Uvicorn.

Las dependencias transitivas del lock, el runtime Python, PostgreSQL y las bibliotecas Debian también conservan sus licencias respectivas. No se afirma que esta tabla sea un inventario exhaustivo de cada componente binario de una imagen futura.

## Binarios y redistribución

Antes de distribuir una imagen concreta, conservar los avisos y comprobar el inventario real de bibliotecas/codecs, las versiones que informa `av.library_versions` y las condiciones del binario usado. Instalar un ejecutable FFmpeg en el host no determina el FFmpeg enlazado por el wheel de PyAV. Las licencias de código, pesos, datasets, grabaciones y servicios de mapas son elementos distintos.

El software productivo no graba ni publica las imágenes de cámaras para acompañar este inventario. La autorización de una cámara o de un material de prueba debe corresponder a esa fuente; no se presume porque un stream sea visible públicamente.
