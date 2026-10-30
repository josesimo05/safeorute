# SafeRoute ITS — Fase 1: diseño y criterios de aceptación

**Estado:** propuesta de diseño para aprobación. **Elaboración:** 29 de octubre de 2026. **Última revisión:** 30 de octubre de 2026.
Este documento no constituye un MVP ejecutado ni una certificación de precisión o capacidad. La Fase 2 comienza únicamente después de la aprobación del usuario.

El sistema medirá vehículos y condiciones de circulación a partir de cámaras autorizadas. Presentará por separado los hechos observados y las hipótesis sobre sus causas. La integración propuesta con SafeRoute, pendiente de confirmación, utilizará una API de un servicio Python persistente; el cliente web no recibirá streams RTSP, credenciales de cámaras ni imágenes sin anonimizar.

Documentos complementarios:
- [Verificación de fuentes, versiones y APIs](VERIFICACION_DE_FUENTES.md).
- [Calibración y validación de velocidad con teléfono GPS](VALIDACION_VELOCIDAD.md).
- [Ejemplo sintético de contrato de alerta](EJEMPLO_ALERTA_DISENO.json).
- [Plantilla de cámara no operativa](CAMARA_PLANTILLA_DISENO.json).

## 1. Información confirmada y supuestos de trabajo

Las respuestas recibidas conservan opciones entre corchetes. No se interpretan como decisiones tomadas. Están confirmados República Dominicana, el uso de niveles cualitativos de confianza, la separación de observación e hipótesis y la política de privacidad por defecto.

| Dato pendiente | Supuesto usado para diseñar | Consecuencia y decisión necesaria |
|---|---|---|
| Integración o producto independiente | Servicio ITS separado, con REST y WebSocket consumibles por SafeRoute | Confirmar integración, dominio, identidad y usuarios; ninguna modificación del frontend forma parte de esta fase |
| Ciudad y vías | Santo Domingo, avenidas urbanas semaforizadas | Es un escenario provisional, no una ubicación confirmada; autopistas requieren otros rangos y reglas |
| Cantidad de cámaras | Una para MVP; diez solo como escenario de dimensionamiento | Confirmar cantidades y crecimiento antes de comprar infraestructura |
| Posición y características | Cámara fija, 1080p, 15–25 FPS de origen | Visión nocturna, codec y óptica desconocidos; PTZ solo sirve para velocidad con preset inmóvil y calibrado |
| Acceso y derechos sobre video | Archivo grabado autorizado, con timestamps válidos, si no hay RTSP disponible | Confirmar procedencia y permiso; no se seleccionarán streams públicos sin comprobar derechos y estabilidad |
| Hardware y presupuesto | Linux x86_64, CPU de 4–8 núcleos, 16 GB RAM y sin GPU | Es una base para probar una cámara, no una capacidad garantizada ni un presupuesto aprobado |
| Frecuencia analítica | Objetivo inicial de 5 FPS procesados, inferencia a 416 × 416 | Debe medirse; resolución/FPS insuficientes pueden impedir la precisión objetivo |
| Latencia requerida | p95 de publicación ≤5 s y p99 ≤10 s después de reunir evidencia suficiente | Confirmar el objetivo; medir aparte el tiempo de observación necesario |
| Audiencia y operación | Cinco usuarios internos y revisión por operador | No publicar causas automáticamente hasta tener política, responsable y validación |
| Referencias geométricas | Se conseguirán medidas físicas y cámara estable antes de validar velocidad | Sin ellas, velocidad métrica no válida; no sustituirla por una cifra estimada sin fundamento |
| Referencia de velocidad | Carro de prueba con teléfono GPS; radar no disponible hasta confirmación | Un teléfono de baja frecuencia puede producir un resultado inconcluso |
| GPS de usuarios/dispositivos | No disponible en el MVP; integración opcional en Fase 4 | No reutilizar silenciosamente ubicaciones de SafeRoute; requiere consentimiento y contrato propios |
| Semáforos, obras y meteorología | Ninguna fuente conectada inicialmente | Algunas causas no serán diagnosticables con confianza alta |
| Histórico y atención | Métricas y alertas durante 90 días; responsable por designar | Confirmar retención, equipo, horario de atención y permisos antes de producción |

Estos supuestos permiten diseñar y probar con video autorizado. No permiten prometer que las ocho causas se reconocerán con una sola cámara sin datos adicionales.

## 2. Alcance funcional y límites observables

El detector base tendrá cuatro clases operativas: carro, moto, guagua/bus y camión. Las clases COCO correspondientes son car, motorcycle, bus y truck. En República Dominicana, la definición de guagua debe precisar si incluye minibuses y furgonetas de pasajeros; COCO puede clasificarlos de otra forma. El conjunto de evaluación local deberá reflejar esa decisión.

El flujo se medirá por carril y dirección mediante líneas de conteo. La velocidad se calculará sobre una región vial calibrada. Las métricas incluirán su vigencia, cobertura y calidad; una ausencia de datos será nula/no disponible, nunca una velocidad cero.

El sistema distinguirá:
- **Observación:** vehículo inmóvil, cola, caída de velocidad, cierre visible confirmado, imagen no utilizable.
- **Hipótesis:** accidente, avería, anomalía semafórica, lluvia como factor, demanda elevada o embudo.
- **Conocimiento externo:** fase semafórica, cierre autorizado, reporte de asistencia o revisión de un operador.

YOLOX con clases COCO no contiene categorías de accidente, avería, escombros o conos. Detectar una caja de semáforo tampoco identifica su color ni su funcionamiento. Las ampliaciones de clases y los conectores externos pertenecen a la Fase 5 y necesitan datos y validación.

## 3. Arquitectura propuesta

~~~mermaid
flowchart TD
    CAM[Cámara RTSP/IP autorizada] --> ING[Proceso de ingesta por cámara]
    FILE[Video autorizado de prueba] --> ING
    ING --> BUF[Buffer reciente y acotado]
    ING --> HEALTH[Salud de stream e imagen]
    BUF --> DET[Detección ONNX]
    DET --> TRACK[Tracking local por cámara]
    CFG[Configuración y calibración versionadas] --> TRACK
    CFG --> SPEED[Velocidad y geometría vial]
    TRACK --> SPEED
    TRACK --> COUNT[Conteo por carril y línea]
    SPEED --> AGG[Ventanas y estado de congestión]
    COUNT --> AGG
    GPS[GPS opcional con consentimiento] --> FUSE[Fusión por tramo y tiempo]
    AGG --> FUSE
    FUSE --> RULES[Motor de evidencias e hipótesis]
    CTX[Semáforos, cierres, clima y revisión] --> RULES
    HEALTH --> RULES
    RULES --> TX[Alertas y outbox en una transacción]
    AGG --> DB[(PostgreSQL)]
    HEALTH --> DB
    TX --> DB
    DB --> RELAY[Relay de entrega serializado]
    RELAY --> EVENTS[Registro durable de eventos]
    EVENTS --> API[API REST y servidor WebSocket]
    DB --> API
    API --> UI[Dashboard / SafeRoute]
~~~

**Fronteras de ejecución:**
1. El trabajador de video es un proceso distinto del servidor HTTP. Iniciar varios procesos Uvicorn no debe iniciar varias veces una cámara.
2. Una cámara tiene un único propietario activo. En multicámara, una lease y un token de fencing impiden escrituras de trabajadores cuyo arrendamiento venció.
3. La captura y la inferencia se desacoplan con un buffer de uno o dos frames recientes por cámara. Se descartan frames decodificados antiguos, no paquetes H.264 arbitrarios que otros paquetes necesiten para decodificarse.
4. El detector GPU, si se adopta después del benchmark, podrá compartirse mediante un planificador con lotes pequeños y tiempo de espera acotado. No se acumularán lotes para maximizar throughput a costa de la latencia.
5. SafeRoute puede continuar en Vercel. RTSP, inferencia y conexiones WebSocket persistentes se ejecutarán en edge, VM o contenedores persistentes con conectividad autorizada a las cámaras.
6. La base histórica ITS se separa de los reportes comunitarios existentes. Una hipótesis ITS no aprueba ni sobrescribe un reporte de Firebase.

## 4. Stack candidato y estado de verificación

La existencia de una versión y sus APIs se verificó en fuentes oficiales. No se instalaron juntas ni se ejecutaron con las cámaras del usuario. La compatibilidad binaria, los hashes, las licencias de artefactos concretos y el rendimiento son puertas de aceptación del MVP.

Leyenda: **D** documentación/ejemplo oficial consultado; **C** código oficial versionado consultado; **M** metadatos oficiales de publicación; **P** pendiente de comprobación en el entorno o de decisión del usuario. El apéndice enlazado identifica cada fuente y el alcance de la comprobación.

| Componente | Versión candidata | Motivo y API comprobada | Estado |
|---|---|---|---|
| Python | 3.12.14 | Base común; relojes monotónicos para vigilancia del proceso | D; imagen y digest P |
| PyAV | 19.0.2 | Decodificación y acceso explícito a PTS y time_base | C/M; RTSP y wheel real P |
| YOLOX Nano, con Tiny como alternativa a evaluar | Código 0.3.0; ONNX oficiales publicados en release 0.1.1rc0 | Modelo vehicular de bajo costo; inferencia ONNX oficial | D/C; pesos elegidos, SHA-256 y precisión P |
| ONNX Runtime CPU | 1.22.1 | InferenceSession, get_inputs y run | C/M; rendimiento conjunto P |
| OpenCV Python | opencv-python 4.11.0.86 | Geometría, homografía y operaciones de imagen | C/M; backend y biblioteca nativa P |
| NumPy | 2.2.6 | Arreglos y operaciones de geometría | C/M; combinación binaria P |
| Supervision / ByteTrack | 0.26.1 | ByteTrack, update_with_detections y reset | C/M; asociación con motos/oclusiones P |
| FastAPI | 0.162.0 | REST y WebSocket; ejemplos oficiales de recepción/envío | D/C/M; seguridad y carga P |
| Pydantic | 2.14.2 | model_validate y model_dump | C/M; contratos finales P |
| Uvicorn | uvicorn[standard] 0.54.0 | Servidor ASGI y dependencias de WebSocket | C/M; motor y límites P |
| SQLAlchemy | SQLAlchemy[asyncio] 2.1.6 | Motor asíncrono y dialecto PostgreSQL/psycopg | C/M; transacciones y migraciones P |
| psycopg | psycopg[binary] 3.3.6 | Conexión PostgreSQL asíncrona | C/M; plataforma y libpq de distribución P |
| PostgreSQL | 17.10 | Histórico, JSONB y transacciones/outbox | D/C; imagen, backup y recuperación P |
| Docker Compose | 2.40.3 | Despliegue de servicios y healthchecks | D; Engine/host/digests P |

Supervision exige opencv-python. Instalar además opencv-python-headless introduciría dos distribuciones del mismo módulo cv2; la base propuesta utiliza solo opencv-python y las bibliotecas del sistema que requiera el contenedor.

La versión efectiva de FFmpeg enlazada por PyAV se registrará con el artefacto real; instalar un ejecutable FFmpeg en el host no demuestra que el wheel lo utilice. El perfil GPU queda pendiente de modelo de tarjeta, driver, CUDA/cuDNN y una versión de ONNX Runtime GPU que exista y sea compatible. No se presume esa compatibilidad a partir del perfil CPU.

El dashboard reutilizará la interfaz web de SafeRoute si se confirma la integración. La decisión no exige otra biblioteca de mapas: puede representar cámaras, tramos y alertas sobre el mapa existente. Las versiones exactas del frontend se conservarán desde su lockfile y se comprobarán al integrar, sin actualizarlas como parte de este diseño.

## 5. Módulos y contratos internos propuestos

Los nombres siguientes son interfaces del proyecto por desarrollar, no funciones atribuidas a una biblioteca.

| Módulo | Entrada | Salida y responsabilidad |
|---|---|---|
| ingest | Fuente autorizada y configuración | Frame en RAM, cámara, época de stream, PTS, base temporal, llegada UTC y monotónica; reconexión y watchdog |
| frame_buffer | Frames decodificados | Frame reciente con edad y contador de descartes; memoria acotada |
| camera_health | Continuidad de frames, PTS y medidas de imagen | Estado de salud, hechos, vigencia y calidad; separado de congestión |
| detector | Frame y pesos verificados | Cajas, clase y puntuación del detector; no causas de incidentes |
| tracker | Detecciones, época y cadencia real procesada | Tracks locales efímeros; observación real separada de predicción |
| calibration | Correspondencias y región válida | Transformación versionada, error independiente, preset y estado válido/inválido |
| speed | Puntos de apoyo observados y tiempos del medio | Velocidad en km/h, soporte temporal, dispersión y razones de abstención |
| counter | Trayectorias observadas, carriles y líneas | Cruces orientados deduplicados en RAM y agregados por intervalo |
| aggregation | Mediciones válidas y cobertura | Estado actual cada 5 s e histórico de 60 s por carril/tramo |
| fusion | Estimaciones cámara/GPS comparables | Estimación fusionada o conflicto, pesos/soporte y procedencia |
| congestion | Velocidad, presencia y línea base | fluido/moderado/denso/detenido o desconocido |
| cause_engine | Observaciones y contexto vigente | Hipótesis, alternativas, nivel cualitativo y criterios satisfechos/faltantes |
| alerts | Episodios y revisión | Alerta versionada, ciclo de vida, publicación y outbox transaccional |
| delivery | Outbox confirmado | Secuencia durable de entrega y señal de novedades |
| api / dashboard | Estado, eventos y autorización | Contratos REST/WS, mapa, histórico y operación |

Cada medición conservará cámara, tramo, carril cuando corresponda, unidad, ventana, calidad, versión de calibración/modelo/reglas y tiempo de disponibilidad. No se guardará un identificador de vehículo global.

## 6. Tiempo real, ingesta y tracking

La velocidad necesita el tiempo del video: diferencia de PTS × time_base entre observaciones. En archivos con FPS variable o al saltar frames, dividir el número de frames por el FPS nominal genera errores.

PTS es tiempo relativo del medio; no equivale automáticamente a UTC de captura. Se guardarán por separado:
- Tiempo del medio para movimiento y conteo.
- UTC del servidor para histórico de recepción/decisión.
- Reloj monotónico para timeout, duración del procesamiento y vigilancia.
- Relación captura↔UTC y su incertidumbre, únicamente cuando se pueda verificar.

Se distinguirán arrival_age_seconds, edad desde disponibilidad en ingesta, y capture_age_seconds, edad desde captura verificada. Si falta UTC de captura, capture_age_seconds será nula/desconocida: recibir frames nuevos no prueba que la escena sea reciente. Esa incertidumbre se conservará en API/dashboard y limitará alertas públicas actuales hasta corroborar su vigencia; un heartbeat no sustituye el reloj de captura.

PTS ausente, discontinuo o reiniciado abre una nueva época de stream e invalida los intervalos afectados. No se reemplaza silenciosamente por hora de llegada: la red puede entregar frames con retraso variable. Los archivos de ensayo llevarán modo replay; procesarlos más rápido que tiempo real no prueba una latencia de captura real. En replay no se emitirán alertas públicas ni se actualizará el estado de tráfico vivo. El dashboard mostrará que son datos de ensayo. Si UTC de captura es desconocido, se conservarán época, PTS/base temporal y ventanas del medio, con captura UTC nula y recepción UTC separada; no se fechará la escena antigua como tráfico actual. El fin normal de un archivo es replay_finished, no una falla de cámara.

El trabajador reintentará conexiones con backoff y jitter. Un lector bloqueado tendrá aislamiento de proceso y watchdog; un timeout no debe bloquear otras cámaras. La carga y los descartes se medirán por cámara para detectar pérdida de cobertura. El motor de reglas evaluará evidencia al recibir observaciones, con un objetivo inicial de ticks de como máximo 1 s; la actualización visual de métricas cada 5 s no retrasará una alerta ya elegible. La publicación de alertas será inmediata tras commit, con catchup de respaldo acotado.

ByteTrack se configurará según la cadencia efectivamente procesada. Su parámetro frame_rate no convierte el tracker en un reloj físico. Las predicciones sin observación no aportarán evidencia nueva de velocidad ni duración de un incidente. La reconexión, un salto temporal o un cambio de escena reinician el estado que ya no sea válido.

## 7. Calibración de cada cámara

1. **Fijar el encuadre.** Registrar resolución, recorte, zoom, enfoque y preset. La PTZ debe permanecer inmóvil para usar una calibración. Una zona con pendiente distinta requiere otra transformación o un modelo geométrico más elaborado.
2. **Establecer coordenadas métricas.** Medir puntos del pavimento con cinta, rueda o equipo topográfico autorizado. No asumir un ancho reglamentario ni utilizar grados geográficos como metros. Corregir distorsión óptica si se dispone de una calibración intrínseca válida.
3. **Recoger correspondencias.** Mínimo matemático: cuatro pares no colineales. Propuesta de trabajo: 8–12 para ajuste y 4–6 puntos diferentes de control, repartidos cerca/lejos y a ambos lados de la región útil.
4. **Ajustar y validar la homografía.** Una opción es estimar suelo→imagen con RANSAC y tolerancia en píxeles, invertir y validar imagen→suelo. Si se ajusta directamente hacia metros, la tolerancia queda en metros: no copiar el valor predeterminado como si fueran píxeles. Revisar degeneración, inliers y error por subzona.
5. **Dibujar regiones viales.** Carriles, hombro, líneas orientadas y ejes longitudinales. Excluir horizonte, aceras y áreas donde pocos píxeles representan distancias excesivas. Meta geométrica provisional: RMSE independiente ≤0,5 m en la región aceptada.
6. **Comprobar vehículos reales.** El centro inferior de la caja aproxima contacto con el suelo; sombras, camiones y oclusión lo desplazan. La homografía no elimina ese sesgo. Reducir la región o abstenerse cuando la medición no sea fiable.
7. **Versionar y vigilar deriva.** Conservar referencias, errores y preset. Movimiento de cámara, mantenimiento o cambio de lente invalida la calibración hasta comprobarla de nuevo. Un cambio de escena también puede invalidar carriles y líneas, no solo velocidad.

La velocidad longitudinal se estimará con una pendiente robusta de distancia sobre el eje del carril frente al tiempo real del medio: v_longitudinal_firmada_kmh = 3,6 × ds/dt. Se conservará el signo para comprobar sentido; la velocidad física y las reglas de detenido usarán su magnitud. Un vehículo en sentido contrario se separará del flujo esperado, nunca se clasificará detenido por tener una velocidad negativa ni cancelará velocidades de otros vehículos. Propuesta inicial: ventanas de 1–2 s con al menos seis observaciones reales válidas; no sumar magnitudes positivas de jitter para convertir un vehículo parado en móvil.

Sin calibración o con una trayectoria insuficiente, el sistema emitirá speed_valid=false y motivos. Podrá seguir ofreciendo detección o conteo en imagen solo si sus zonas continúan siendo válidas.

## 8. Conteo, agregación y congestión

Un cruce requiere posiciones observadas a ambos lados de una línea orientada, dirección coherente e histéresis espacial. Se interpolará la hora entre observaciones cercanas; no se interpolará a través de una oclusión extensa. El carril será el del punto de cruce, considerando cambios de carril y regiones limítrofes.

La deduplicación cámara/época/track/línea/dirección vivirá en RAM. Los IDs se limitan a la cámara y sesión de observación. El histórico conservará agregados, no trayectorias ni identificadores persistentes de vehículos.

Un reinicio puede perder cruces: exigir observación aguas arriba antes de armar un nuevo track reduce duplicados, pero no recupera mágicamente vehículos ocultos durante la caída. Se informarán cobertura, reinicios y huecos. Los snapshots de una ventana se reemplazarán idempotentemente; reintentar una escritura no incrementará otra vez el conteo.

Ventanas propuestas:
- Actualización visual de estado cada 5 s, con estadísticas móviles de 10–30 s según indicador.
- Conteos históricos por carril y clase en ventanas de 60 s; UTC cuando la captura esté verificada y ventanas relativas al medio para replay o tiempo absoluto desconocido. Exportación y evaluación en intervalos de 15 min con esa procedencia explícita.
- Tiempo realmente observado y validez junto al agregado. Una ventana parcialmente observada no representa un minuto completo.
- Tasa durante la parte observada q = 3600 × N / segundos_observados, en vehículos/hora; mostrar también el conteo entero N y la cobertura. Es una normalización de tasa, no el conteo real de una hora ni del tiempo no observado. Con huecos importantes no se publicará como aforo completo de la ventana.
- Velocidad espacial comparable de tramo: 3,6 × suma de distancias longitudinales estimadas en metros / suma de tiempos observados en segundos, agrupando un mismo sentido y ventana, incluyendo tiempo de vehículos detenidos. Los desplazamientos proceden del ajuste robusto y la dirección válida; no de sumar valores absolutos del jitter frame a frame. Si solo hay otra definición disponible, etiquetarla y no fusionarla como si fueran equivalentes.

Con cámara saludable y ningún vehículo observado, el conteo puede ser cero, pero la velocidad media es nula/no medible, no cero km/h. La vista puede indicar sin vehículos observados sin inventar una velocidad libre.

La presencia visual y el número de tracks visibles son proxies afectados por oclusión; no se presentarán automáticamente como densidad física exacta.

Para comenzar se construirá una línea base local de velocidad libre por cámara, sentido y condiciones. Hasta tenerla habrá umbrales manuales explícitos. Estos parámetros iniciales son hipótesis de ingeniería, no umbrales universales validados:

| Estado | Regla inicial a evaluar |
|---|---|
| Fluido | Velocidad relativa a referencia local ≥0,75 y datos suficientes |
| Moderado | Relación entre 0,45 y 0,75 |
| Denso | Relación inferior a 0,45; una relación <0,10 refuerza la hipótesis de saturación |
| Detenido | Velocidad ≤5 km/h y presencia/cola sostenida durante aproximadamente 30 s |
| Desconocido | Datos, calidad, calibración o soporte insuficientes |

La prioridad de detenido sobre otras etiquetas se implementará expresamente para evitar reglas solapadas. Apertura y recuperación tendrán ventanas e histéresis diferentes. Un rojo semafórico puede producir un estado detenido normal; eso no equivale a un incidente ni demuestra una falla del semáforo.

## 9. Fusión opcional cámara + GPS

La Fase 4 incorporará solo datos autorizados. Una posición de navegación en SafeRoute no se convierte automáticamente en telemetría ITS.

Se emparejarán estimaciones por tramo, sentido y ventana común. Una fuente con UTC de captura desconocido no puede alinearse con GPS de teléfonos hasta establecer un mapeo temporal y una incertidumbre aceptables; sincronizar el servidor no crea ese mapeo. GNSS ordinario no asigna carril con fiabilidad suficiente por defecto. Una media de velocidades al cruzar una línea y una media de recorrido por un tramo representan magnitudes distintas: primero se igualará la definición.

Método inicial:
1. Normalizar velocidad y su incertidumbre a km/h antes de comparar fuentes: si llegan en m/s, multiplicar velocidad y sigma por 3,6, y varianza por 3,6². Filtrar tiempos imposibles, datos vencidos, ubicación fuera de tramo y calidad insuficiente.
2. Agrupar por dispositivo efímero y recorrido para no considerar cien muestras de un teléfono como cien fuentes independientes.
3. Obtener estimaciones robustas por fuente y una varianza empírica, calibrada con ensayos; aplicar un piso de incertidumbre.
4. Fusionar con pesos inversos a esa varianza: w_i = 1 / (sigma_i² + sigma_floor²); v_f = suma(w_i × v_i) / suma(w_i). Las unidades de sigma serán km/h. Se explicará la hipótesis de errores independientes y se reducirá el peso cuando existan errores compartidos; este promedio no demuestra optimalidad.
5. Si |v_cámara − v_GPS| supera max(10 km/h, 3 × incertidumbre_combinada), declarar conflicto y revisar calidad. No promediar ciegamente fuentes incompatibles.
6. Si solo una fuente supera controles, usarla con esa procedencia. Si ambas son dudosas, abstenerse y conservar las estimaciones separadas.

Con GPS desactivado, se conserva la estimación de cámara y su calidad; el módulo no bloquea el pipeline. El umbral de conflicto y el mínimo provisional de tres dispositivos distintos por ventana son parámetros por validar, no garantías estadísticas. Una flota de buses o taxis puede sesgar el resultado respecto del conjunto del tráfico. GPS no estima volumen total por sí solo ni identifica la causa de un incidente.

La precisión horizontal Android y la de Geolocation web tienen semánticas distintas; no se convertirán directamente en una sigma de velocidad comparable. Se usará incertidumbre de velocidad reportada cuando exista o una distribución de error medida por fuente.

## 10. Motor de causas y confianza

Cada alerta separará **Observado**, **Causa probable**, **Confianza** y **Acción recomendada**. El puntaje del detector no será la confianza de una causa. Dos indicadores calculados sobre los mismos tracks tampoco son dos corroboraciones independientes.

| Nivel | Criterio |
|---|---|
| Alto | Datos actuales, observación suficiente, geometría válida para lo medido, patrón específico persistente, sin contradicciones importantes y regla validada en ese dominio. Accidentes no presenciados, averías y fallas semafóricas requieren corroboración humana o autorizada que distinga alternativas |
| Medio | Patrón persistente compatible, pero existen alternativas plausibles o falta corroboración específica; redacción posible/probable |
| Bajo | Evidencia escasa, ambigua o contradictoria; la presentación principal dice causa no determinada y muestra los hechos |
| No evaluable | Estado de calidad separado, no cuarto nivel de confianza: datos caídos, vencidos o mediciones necesarias inválidas |

| Causa solicitada | Observado | Hipótesis y requisito adicional | Confusores que impiden afirmarla |
|---|---|---|---|
| Accidente o vehículo detenido | Vehículo previamente móvil permanece en carril; cola y maniobras de rodeo | Inmovilización puede observarse; accidente requiere confirmación o modelo específico validado y corroboración | Rojo normal, parada de bus, carga/descarga, oclusión o cambio de ID |
| Avería en carril u hombro | Vehículo inmóvil en zona definida, duración e invasión o no del carril | Motivo mecánico requiere asistencia vial, operador o fuente autorizada | Parada voluntaria, control vial, emergencia, vehículo estacionado |
| Obstáculo o escombros | Objeto persistente y trayectorias de evitación | Detector adicional con clases locales o revisión humana; COCO base no identifica escombros | Sombra, reflejo, mancha, bache, iluminación o compresión |
| Semáforo dañado o desincronizado | Parada/descarga anómala por aproximación y ciclo | Plan, fase/controlador o revisión autorizada; módulo de luces separado y validado si se necesita | Saturación, prioridad, rojo programado o intersección siguiente bloqueada |
| Obra o cierre | Utilización reducida de un carril y fusión de trayectorias | Cierre/obra autorizada o confirmación; detector de barreras/conos adicional si se incorpora | Restricción habitual, giro, cobertura deficiente o carril naturalmente vacío |
| Lluvia o baja visibilidad | Contraste/alcance degradados, reflejos y reducción de velocidad | Meteorología localizada y vigente o modelo validado; relación causal todavía puede ser incierta | Noche, suciedad, desenfoque, contraluz y exposición |
| Exceso de volumen | Llegadas altas frente a línea base, cola creciente y descarga observada | Línea base por cámara/sentido/tipo de día; sin incidente visible en el área cubierta | Incidente fuera de campo u oculto; no afirmar ausencia global de incidentes |
| Embudo por reducción | Convergencia de trayectorias y cola antes de reducción conocida | Geometría de carriles confirmada y observación de la zona de fusión | Puede coexistir con obra, avería o demanda elevada |

Las hipótesis pueden coexistir: obra → reducción → embudo, agravado por demanda. El motor conservará alternativas y evidencias faltantes; no forzará una única etiqueta.

Las recomendaciones se dirigirán al operador: revisar cámara, contrastar controlador, confirmar cierre o solicitar evaluación. No accionarán semáforos, cerrarán carriles ni enviarán instrucciones de emergencia automáticamente.

**Política inicial de publicación:** acceso interno; causas públicas solo con nivel alto y aprobación del operador. Eliminar la revisión humana será una decisión posterior, por clase y condición, sustentada en validación independiente. Un hecho revisado puede publicarse como carril bloqueado aunque su motivo siga indeterminado.

## 11. Salud de cámara, condiciones difíciles y vigencia

| Situación | Detección propuesta | Comportamiento |
|---|---|---|
| Sin frames/errores de lectura | Timeout, continuidad y heartbeat | Alerta separada de ingesta no disponible; no diagnosticar automáticamente cámara físicamente averiada |
| Posible imagen congelada | Repetición de contenido más continuidad/PTS y contexto | Una calle vacía casi estática no basta; congelamiento sospechado hasta corroborar |
| Imagen obstruida/no utilizable | Cambio fuerte de textura, contraste, saturación o región visible | Distinguir limitaciones de noche/lluvia/óptica; abstenerse de métricas inválidas |
| Noche, lluvia y reflejos | Calidad por subzona y validación por condición | Reducir región o soporte, usar modelo/cámara apropiados y abstenerse; no ocultar caída de recall |
| Oclusión y sombras | Pérdidas de tracks, soporte temporal y estabilidad del punto de apoyo | No convertir predicciones en observaciones; registrar cobertura y errores de ID |
| Cámara movida/PTZ | Cambio de encuadre/preset y controles geométricos | Invalidar calibración y zonas afectadas; requiere comprobación |
| Sobrecarga | Edad de frames, FPS efectivos, descartes y duración de etapas | Mantener buffer acotado y avisar cobertura degradada |
| Fuente vencida | Edad y ventana de evidencia | Estado stale/unknown; no reutilizarlo como dato actual |

La pérdida de una cámara no resuelve una congestión. Una alerta pasa a información vencida/no observable, y solo se marca recuperada cuando vuelve a haber evidencia de recuperación con calidad suficiente.

## 12. Alertas, API y entrega en tiempo real

Los contratos siguientes son propuestos para la API propia v1; no existen endpoints desplegados por esta fase.

| Método y recurso | Propósito |
|---|---|
| GET /v1/cameras | Cámaras permitidas, ubicación/configuración no sensible y estado |
| GET /v1/cameras/{id}/health | Salud, última observación y calidad |
| GET /v1/segments/{id}/state | Velocidad por fuente, congestión, vigencia y observabilidad |
| GET /v1/metrics/history | Agregados paginados por cámara/tramo/carril e intervalo |
| GET /v1/alerts | Alertas por estado, tiempo, causa y permiso |
| GET /v1/alerts/{id} | Hechos, hipótesis, criterios y revisiones visibles |
| POST /v1/alerts/{id}/review | Aprobación, rechazo o reconocimiento por rol autorizado |
| GET /v1/events | Recuperación de eventos desde cursor, con autorización |
| POST /v1/gps/samples | Ingesta opcional y consentida de Fase 4 |
| GET /healthz y /readyz | Vida del proceso y preparación de dependencias |
| WS /v1/stream | Cambios de alertas/salud/estado, heartbeat y reanudación |

Las unidades serán explícitas: km/h, metros, segundos y UTC ISO 8601. Una respuesta incluirá versión de esquema, revisión, fuente, ventana y calidad. Histórico tendrá rango máximo, paginación y límites de carga; no consultas ilimitadas.

El contrato WebSocket se documentará y probará por separado. La generación OpenAPI de REST no documenta por sí sola los mensajes WebSocket.

**Entrega durable:**
1. Una transacción guarda la revisión de alerta y su outbox.
2. Un relay serializado recoge filas ya confirmadas, asigna una secuencia de entrega con bloqueo transaccional y registra el evento.
3. La secuencia de entrega refleja ese orden serializado de commit. Un BIGSERIAL asignado por escritores concurrentes no basta: un ID menor puede confirmar después de que el cliente ya avanzó a otro mayor.
4. LISTEN/NOTIFY despierta procesos; no sustituye el registro durable. Se hará catchup periódico aunque no llegue una notificación.
5. Cada mensaje llevará event_id, entity_id, revision y cursor como cadena. Entrega al menos una vez; el cliente deduplica y nunca aplica una revisión anterior.
6. Retención provisional del replay de eventos, no de video: siete días. Un cursor expirado produce 410 en REST o resync_required en WS; el cliente obtiene snapshot actual y reanuda.
7. Clientes lentos tienen cola acotada y recuperación, no memoria ilimitada. Varias instancias API mantienen sus propios cursores de fanout.

Ciclo del incidente y revisión son distintos: candidato/abierto/resuelto/vencido; reconocido es una acción operativa, no resolución. Publicación pendiente/aprobada/suprimida se audita por separado. Actualizaciones materiales incrementan revisión del mismo episodio para evitar una nueva alarma cada segundo.

## 13. Histórico y esquema lógico

Esquema conceptual, sujeto a migraciones y pruebas en el MVP:

| Tabla | Campos principales y tipos propuestos | Claves/índices y finalidad |
|---|---|---|
| cameras | id texto, segment_id texto, ubicación numérica, secret_ref texto, config JSONB, enabled boolean | PK id; índice tramo/estado; sin URI con contraseña |
| calibrations | id texto, camera_id texto, versión, correspondencias JSONB, matriz JSONB, errores JSONB, preset, valid_from timestamptz | Inmutable por versión; FK cámara; trazabilidad de geometría |
| camera_leases | camera_id, owner texto, lease_until timestamptz, fencing_token bigint | Una fila por cámara; rechazar escrituras de propietarios vencidos |
| lane_metric_windows | id UUID, cámara/carril texto, clase, source_mode, stream_epoch UUID, calibración texto, media_start_ticks bigint, base temporal, capture_start timestamptz nullable, ingested_at timestamptz, duración, conteo, velocidad nullable, cobertura y time_quality | Clave idempotente de cámara/carril/ventana del medio/época/versiones; captura UTC nullable no es la única clave; índices cámara+tiempo/modo; partición según carga |
| metric_current | cámara/tramo/carril, source_mode, revisión, estado JSONB, observed_at nullable, received_at, expires_at y time_quality | Último estado por entidad; escritura reemplazable para dashboard |
| camera_health | cámara, código, evidencia JSONB, inicio/fin/última observación | Índice cámara+tiempo; eventos distintos de tráfico |
| alerts | id UUID, cámara/tramo/zonas, ciclo, publicación, confianza ordinal, revisión, fechas | Índices estado+tiempo, tramo+tiempo y publicación |
| alert_revisions | alert_id, revision entero, observed JSONB, hypotheses JSONB, acciones, calidad y procedencia | Único alert_id+revision; auditoría de revisión humana |
| outbox | id UUID, entidad/revisión, payload autorizado, created_at, delivered_at | Reintentos idempotentes; índice pendientes |
| delivery_events | delivery_sequence bigint, event_id UUID, entidad/revisión, audiencia, payload, fecha | Secuencia serializada; event_id único; índice audiencia+secuencia |
| delivery_counter | clave del stream y último número bigint | Fila bloqueada para asignar orden durable sin la carrera de commit |
| audit_log | actor/rol, acción administrativa, entidad, fecha y resultado | Sin payload GPS, imágenes, contraseñas ni IDs de vehículo |

Las ventanas parciales conservarán sus huecos y épocas; una actualización de calibración corta la serie o crea otra versión. La procedencia incluirá hashes de modelo/configuración cuando se disponga de los artefactos reales, nunca hashes inventados. La API de tráfico actual excluirá replay; consultas históricas conservarán ese modo y no inventarán captura UTC cuando solo haya tiempo del medio.

No habrá tablas de placas, rostros, frames, trayectorias individuales ni GPS bruto. La telemetría GPS se agregará en memoria y se descartará conforme a la política aprobada. Los datos de ensayo se tratarán separadamente de producción.

Retención provisional: 90 días de métricas/alertas, siete días del registro de replay y un plazo operativo de logs por confirmar. La política de backup debe respetar la expiración; eliminar una fila no elimina automáticamente copias de respaldo.

## 14. Dashboard e integración SafeRoute

El mapa mostrará cámaras y tramos con colores de congestión; gris indicará datos desconocidos o vencidos. No se interpretará gris como vía despejada.

Cada cámara tendrá estado, hora de última muestra, FPS efectivos, calidad y calibración. Cada tramo mostrará velocidad, ventana, fuente cámara/GPS/fusión, cobertura y estado. La ficha de alerta separará Observado y Causa probable, mostrará nivel y criterio, alternativas, hora, ubicación, cámara y recomendación.

Los operadores podrán filtrar, reconocer y revisar alertas, inspeccionar histórico agregado y ver causas que permanecen indeterminadas. El dashboard público será una proyección aprobada, no la misma respuesta administrativa sin filtrar.

La vista por defecto es de metadatos: no incluye video ni capturas. Una previsualización futura requeriría autorización y anonimización comprobada; un detector COCO no anonimiza placas o rostros por sí solo.

La aplicación cliente recibirá un snapshot y después cambios. Guardará cursor/revisiones para reconectar, indicará pérdida de conexión y no dejará un color de tráfico antiguo como si fuera actual.

## 15. Despliegue, capacidad y operación

Servicios previstos para Docker Compose: api, worker de cámara, relay, PostgreSQL y terminación TLS existente o por seleccionar. Habrá secretos por referencia, volúmenes solo para base/artefactos aprobados, healthchecks y límites de recursos. La inferencia no se multiplicará con las réplicas del API.

Dependencias listas al arrancar no garantizan disponibilidad continua: el código deberá reintentar conexión a base/cámaras y finalizar de forma controlada. Ante caída de base se acotará memoria, se declarará degradación y no se anunciará como durable una alerta que no se pudo confirmar.

| Escenario | Base de dimensionamiento provisional | Validación necesaria |
|---|---|---|
| Una cámara CPU | 4–8 núcleos, 16 GB RAM; Nano 416 y objetivo de 3–5 FPS procesados | Benchmark con codec, movimiento, cámara y contenedor reales |
| Cuatro a diez cámaras | 12–16 núcleos, 32–64 GB RAM y GPU de 8–16 GB como candidato | Número de cámaras por GPU por medir; decodificación puede seguir en CPU |
| Veinte o más | Varios nodos con asignación explícita y capacidad de reemplazo | Prueba de carga, leases/fencing, red, base y fanout; no extrapolar linealmente |

Son estimaciones para planificar pruebas, no requisitos garantizados ni cotizaciones. La alternativa más económica inicial es un equipo CPU ya disponible y un stream secundario de menor FPS/resolución si la cámara lo proporciona y permite cumplir la precisión. Si el CPU no cumple, se ajustará modelo/ROI/cadencia de forma explícita o se reevaluará GPU.

Planificación de red: un stream 1080p H.264 puede requerir aproximadamente 2–6 Mbit/s, según contenido y configuración; añadir 30% de margen. Diez cámaras serían aproximadamente 26–78 Mbit/s de entrada. Debe medirse bitrate real, especialmente con noche y lluvia. Edge permite enviar principalmente metadatos hacia la nube.

Un frame RGB 1080p sin comprimir ocupa unos 6,2 MB. Dos buffers por diez cámaras suman unos 124 MB, aparte de tensores, decodificadores y runtime. Esta cuenta no dimensiona por sí sola la RAM total.

Ejemplo histórico: diez cámaras × cuatro carriles × 1.440 minutos × 90 días = 5.184.000 filas por minuto/carril, antes de subdividir por clase u otras dimensiones. A 0,5–1,5 KB por fila serían aproximadamente 2,6–7,8 GB; es una hipótesis de tamaño, no medición de PostgreSQL. Reservar al menos 20 GB y margen adicional para índices, revisiones, WAL y backups, y medir crecimiento real. Separar clases en columnas/JSON agregado evita multiplicar filas innecesariamente; la estructura final se probará.

La operación medirá FPS, edad de frames, descartes, errores de decode, latencia por etapa, cobertura de velocidad, antigüedad de leases, lag del outbox, clientes WS lentos y espacio libre. Se ensayarán backup/restauración y recuperación; RPO/RTO y horario de atención deben acordarse antes de producción.

## 16. Privacidad y seguridad

- Fuentes autorizadas y acceso RTSP desde red privada/VPN cuando corresponda; sin abrir cámaras a Internet como solución de integración.
- Credenciales en secretos, nunca en respuestas, repositorio, URLs de frontend, logs o mensajes de error.
- Frames solo en memoria; sin grabación, snapshots ni volcados de frames por defecto. El dashboard evita mostrar rostros o placas porque no entrega imágenes.
- Tracking local efímero, sin reidentificación entre cámaras ni asociación persistente con personas/dispositivos.
- GPS con consentimiento específico y revocable, minimización, agregado y expiración; sin registrar cuerpos de solicitudes.
- TLS para API/WSS, autenticación y roles. Validar Origin de WebSocket y permitir orígenes CORS exactos; no dar acceso administrativo por provenir de una página pública.
- Lista permitida de fuentes y límites de solicitudes/configuración para prevenir lectura de destinos internos arbitrarios.
- Artefactos de modelos y dependencias fijados con hashes; SBOM y análisis de vulnerabilidades/licencias antes de producción.
- Los ensayos usarán videos autorizados bajo control del usuario, montados solo lectura; cualquier retención adicional o corpus con imágenes identificables necesita política explícita.

La validación reproducible y la política de no guardar video deben conciliarse antes de preparar un corpus. El sistema no copiará grabaciones automáticamente para justificar una alerta.

## 17. Metas de aceptación y validación

Todas las cifras de esta sección son **metas propuestas**, no resultados obtenidos ni precisión garantizada. Se fijarán antes de evaluar el conjunto final y se reportarán también los casos que el sistema no puede medir.

| Área | Meta inicial medible | Evaluación |
|---|---|---|
| Detección | Precisión y recall ≥0,90 para cada una de las cuatro clases en la ROI/condición declarada, IoU ≥0,50 | Umbral fijado antes del test; mAP50 y mAP50:95 adicionales; estratos por clase/tamaño/día/noche |
| Conteo | WAPE ≤5% sobre ventanas de 15 min/carril con volumen suficiente; informar error absoluto para GT=0 o bajo | Comparación manual; no esconder falsos conteos en carriles vacíos |
| Velocidad | MAE ≤3 km/h, sesgo absoluto ≤1,5 km/h, P95 absoluto ≤7 km/h | Mismo tramo/intervalo, referencia con incertidumbre reportada y calibración independiente |
| Cobertura de velocidad | ≥80% de todos los pasos manualmente elegibles en ROI predeclarada | Denominador incluye vehículos perdidos, ocluidos y casos con abstención |
| Causas observables | Meta de precisión ≥0,95 para nivel alto y recall ≥0,80 en clases observables con contexto disponible | Métricas por causa y condición; reportar recall total, condicional y abstención |
| Falsas alarmas | Meta inicial ≤0,05 falsas alertas por cámara-hora | Horas negativas independientes y eventos deduplicados |
| Publicación técnica | p95 ≤5 s y p99 ≤10 s desde evidencia elegible hasta persistencia/recepción | Carga y reloj declarados; ensayar desconexión/replay y cliente real |
| Recuperación | Sin duplicación de conteos por reintento de escritura ni pérdida silenciosa de revisión confirmada | Fallos de worker/base/relay y commits concurrentes |
| Privacidad | Ningún frame, placa, rostro, URI secreta ni GPS bruto en salidas o almacenamiento por defecto | Inspección de base, API, logs y archivos del contenedor |

Para conteo: WAPE = suma de errores absolutos / suma de conteos de referencia. Se publicarán además errores por intervalo; un buen agregado no compensa un carril con fallo sistemático. La regla de volumen suficiente se fijará antes del ensayo, por ejemplo GT ≥20 por ventana, y los intervalos restantes se reportarán por separado.

El inicio de la latencia interna será la disponibilidad en ingesta del frame que completa los criterios de elegibilidad, no la finalización tardía de la regla; así se incluye la espera de inferencia, evaluación y entrega posterior. Se instrumentará decodificación por separado y se declarará cualquier buffering previo no observable. La latencia no oculta el tiempo de evidencia: una regla de inmovilización de 30 s tendrá un tiempo de detección mínimo cercano a esos 30 s, más procesamiento/publicación. Si no existe UTC de captura verificable, solo se certificará recepción→consumidor y se marcará desconocido el retraso anterior; no se afirmará latencia cámara→pantalla.

Como estimación de planificación, podrían observarse errores de velocidad de 2–5 km/h en condiciones buenas y de 5–10 km/h o más en malas. No son resultados propios ni márgenes garantizados. Cuando geometría, oclusión o tiempo no permiten una medida defendible, la salida correcta es no medible.

La precisión alta de una causa no se aceptará por una muestra pequeña o por el puntaje del detector. Se mostrarán intervalos de confianza y tamaños de muestra por clase. Un único emparejamiento uno-a-uno entre episodios predichos y eventos de referencia impedirá contar varias actualizaciones como varios aciertos; zona, sentido y tolerancia temporal se fijarán por causa antes de la evaluación final. Las clases raras sin suficientes eventos seguirán como no validadas. Mientras falte evidencia suficiente o las condiciones no estén validadas, la clase continuará para operadores y revisión humana.

## 18. Validación con carro y GPS de teléfono

Procedimiento resumido; el apéndice de velocidad desarrolla incertidumbre, APIs y análisis:
1. Elegir vehículo de ensayo autorizado y teléfono fijado; registrar solo durante el recorrido de prueba.
2. Medir un tramo A/B visible. Preferencia inicial: 100–200 m y alrededor de 10 s de observación cuando el encuadre lo permita; 100 m a 50 km/h son solo 7,2 s.
3. Conservar tiempo del fix, velocidad e incertidumbre cuando el teléfono/logger las exponga. La web watchPosition no garantiza frecuencia ni precisión de velocidad.
4. Registrar desfase y deriva entre reloj de teléfono y video mediante un método de sincronización separado del ajuste final; NTP del servidor no basta para demostrar sincronía del emisor.
5. Asociar el carro por ventana coordinada, carril y revisión humana, sin placa ni identificación persistente. No forzar asociaciones ambiguas.
6. Comparar exactamente el mismo intervalo A/B y definición de velocidad. Un GPS de 1 Hz en una ROI de 20 m no basta por sí solo para demostrar el error objetivo: comprobar incertidumbre y sincronización. Una velocidad GNSS reportada con precisión suficiente puede ser útil incluso a 1 Hz; no se acepta ni se descarta únicamente por su frecuencia.
7. Recoger como propuesta al menos 100 pasos independientes de evaluación, repartidos por carril, rango y condición, en días distintos de los usados para ajuste.
8. Reportar MAE, sesgo, P95, cobertura e intervalos agrupados por recorrido/día. Miles de frames del mismo paso no son miles de ensayos independientes.
9. Si la incertidumbre del teléfono es comparable con la meta de 3 km/h, informar acuerdo entre instrumentos o resultado inconcluso, no error absoluto demostrado.
10. Alternativa barata: puertas separadas por distancia medida y anotación manual de paso con tiempo verificable. Si se usa el mismo video, comparte reloj y óptica; es una comprobación útil pero no plenamente independiente de ellos.

No se provocarán accidentes ni bloqueos para conseguir ejemplos. Los incidentes se validarán mediante registros autorizados y evidencia confirmada.

## 19. Plan de pruebas y puertas de fase

| Caso | Resultado exigido |
|---|---|
| Carro, moto, guagua y camión, cerca/lejos | Métricas separadas; clases locales y fallos visibles |
| Cruce simple, cambio de carril y línea con jitter | Un cruce orientado correcto; sin doble conteo por oscilación |
| Cola en rojo normal y parada de guagua | Puede observarse detención; no diagnosticar accidente o semáforo dañado |
| Inmovilización fuera de cola | Hechos y duración correctos; motivo indeterminado sin corroboración |
| Sombra, reflejo y objeto ambiguo | No etiquetar escombros con un detector que no tiene esa clase |
| Noche, lluvia, desenfoque y lente parcialmente cubierta | Calidad degradada/abstención; alerta de salud separada |
| Oclusión y cambio de ID | Medir error de conteo/velocidad y cobertura; no convertir predicción en hecho |
| PTZ o cámara desplazada | Invalidar calibración/zona afectada; velocidad no disponible |
| RTSP interrumpido, lento o congelado | Aislar cámara, controlar memoria y diferenciar sospecha de fallo confirmado |
| FPS variable, frames descartados y PTS reiniciado | Tiempo correcto o abstención; nueva época sin mezclar tracks |
| Replay antiguo, UTC desconocido y fin de archivo | Modo ensayo visible, tiempo del medio preservado, sin alerta pública ni tráfico actual; EOF no es falla de cámara |
| GPS discrepante, de otra dirección o de un solo teléfono | Rechazar fusión incompatible y no inflar soporte por cantidad de muestras |
| Base caída y relay reiniciado | Ninguna alerta no confirmada presentada como durable; recuperación y huecos explícitos |
| Dos escritores con IDs en orden distinto de commit | Replay completo sin perder el commit tardío de menor ID original |
| WS desconectado, duplicado o consumidor lento | Reanudación, deduplicación, revisión monótona y memoria acotada |
| Cámara caída con alerta activa | Alerta vencida/no observable, no resuelta como tráfico recuperado |
| Corpus final separado de ajuste | Sin reutilizar sesiones para elegir umbral y reportar aceptación |

Fases y aprobación:
- **Fase 1, actual:** diseño, fuentes, contratos propuestos, supuestos y aceptación. Termina con revisión del usuario.
- **Fase 2, una cámara:** pipeline con video autorizado o RTSP, configuración/calibración, métricas, salud, API/WS, dashboard mínimo y pruebas. No se declara aprobado hasta medir.
- **Fase 3, multicámara:** aislamiento, leases/fencing, carga, recuperación, backup y capacidad real; decidir GPU con benchmark.
- **Fase 4, GPS:** consentimiento, ingestión, comparación temporal/espacial, conflictos y validación del beneficio real.
- **Fase 5, causas:** reglas/contextos/modelos adicionales por causa, revisión y evaluación independiente; publicar solo clases sustentadas.
- **Producción:** superar las puertas funcionales, de capacidad, seguridad, privacidad, operación y validación; documentar límites que permanezcan.

No se empieza otra fase por silencio o por disponer ya de un esquema de código.

## 20. Estructura prevista del proyecto y configuración

Estructura conceptual para la Fase 2; no son módulos implementados en esta entrega:

~~~text
traffic-its/
  pyproject.toml
  lock/
  src/traffic_its/
    ingest/             # video, tiempos y reconexión
    vision/             # detector, adaptador y tracking
    calibration/        # geometría, regiones y validación
    analytics/          # velocidad, conteo y congestión
    fusion/             # opcional, Fase 4
    causes/             # observaciones y reglas de Fase 5
    alerts/             # episodios, revisión y publicación
    delivery/           # outbox, relay y replay
    api/                # REST, WebSocket y autorización
    persistence/        # modelos y migraciones
    observability/      # salud, tiempos y métricas operativas
  configs/cameras/
  schemas/
  tests/unit/
  tests/integration/
  tests/replay/
  tests/acceptance/
  deployment/
  docs/
~~~

Ejemplo declarativo de diseño, deliberadamente no operativo hasta completar geometría y fuente:

La plantilla canónica es [CAMARA_PLANTILLA_DISENO.json](CAMARA_PLANTILLA_DISENO.json), con schema_version=1.0-design. Define source.kind, processing, calibration, lanes y count_lines; los contratos de validación y la documentación usarán esos mismos nombres. No es una configuración de cámara real: fuente, ubicación, correspondencias, carriles y líneas deben completarse. Tiene deshabilitadas velocidad métrica, aforo por carril y publicación específica hasta superar sus controles. No existe un segundo formato YAML con campos diferentes en esta fase.

La validación de configuración deberá rechazar una velocidad habilitada sin puntos suficientes, geometría degenerada, una línea fuera de su carril, unidades inconsistentes o referencias temporales inválidas. No se rellenan coordenadas ficticias para aparentar calibración.

## 21. Decisión requerida antes del MVP

Para aprobar la Fase 2 hace falta confirmar:
1. Integración con SafeRoute, ciudad/tipo de vía, una cámara piloto y objetivo posterior.
2. Video autorizado o acceso a cámara, resolución/FPS/codec y condición fija/PTZ.
3. Hardware real, lugar de ejecución y presupuesto máximo.
4. Disponibilidad de referencias físicas; si faltan, aceptar un MVP de detección/conteo sin velocidad métrica validada hasta calibrar.
5. Operador responsable, audiencia y objetivo de latencia.
6. Forma de ensayo con teléfono, retención y política de material de validación.

El diseño puede aprobarse con esos supuestos modificados por escrito. Esa aprobación autoriza preparar el MVP acordado, no afirmar precisión, ampliar la cantidad de cámaras ni habilitar publicación automática sin las pruebas correspondientes.
