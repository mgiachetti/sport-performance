# 0102. Video de alta velocidad en Android con un módulo propio, e importación de videos en cámara lenta desde la galería

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #257 (B-610)

## Contexto

El CMJ por video ([0085](0085-cmj-por-video.md)) y el sprint por video ([0082](0082-sprint-por-video-foto-finish.md)) filman con `react-native-vision-camera` 5 a 120 fps como mínimo (240 preferidos). En un Samsung Galaxy S24 Ultra la app dice que el teléfono no graba a 120 fps, y el teléfono sí lo hace con su cámara.

La causa está en cómo Android expone la alta velocidad. VisionCamera 5 en Android lee `cameraInfo.supportedFrameRateRanges` de CameraX, que son los rangos normales del auto-exposure; en Samsung llegan a 30 o 60. Android le da 120 y 240 fps a una app de terceros solo con una **sesión de captura de alta velocidad restringida** de Camera2 (`CameraConstrainedHighSpeedCaptureSession`), en las cámaras con la capacidad `REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO`, con los tamaños de `StreamConfigurationMap.getHighSpeedVideoSizes()` y los rangos de `getHighSpeedVideoFpsRangesFor(size)`. VisionCamera no usa esa sesión. En iOS AVFoundation lista los formatos de alta velocidad y VisionCamera funciona.

También hay teléfonos que no le dan alta velocidad a ninguna app, aunque su cámara filme en cámara lenta. Y en el campo a veces el evaluador ya filmó con la cámara del teléfono.

## Decisión

- **Módulo propio de alta velocidad en Android** (`apps/mobile/modules/high-speed-camera`, Kotlin, módulo Expo local como `cmj-frames`):
  - `getCameras()` lista las cámaras traseras con la capacidad de alta velocidad, con sus tamaños y rangos.
  - La vista `HighSpeedCamera` abre la sesión con dos superficies al tamaño de alta velocidad, que es lo máximo que acepta: la vista previa (un `SurfaceView` con tamaño de buffer fijo) y una superficie persistente (`MediaCodec.createPersistentInputSurface`). Cada `MediaRecorder` graba desde esa superficie, así que una grabación nueva no rearma la sesión.
  - La vista previa usa el rango variable más amplio que la cámara lista para ese tamaño y que termina en la tasa de grabación (`[30, 240]` en el S24 Ultra). La grabación usa el rango fijo `[fps, fps]` que la sesión exige. Probado en un S24 Ultra con una app de prueba:
    - Una vista previa con el rango fijo hace abortar al HAL de cámara de Samsung (`SIGABRT` en `vendor.samsung.hardware.camera.provider`, en el segundo pedido), y el servicio entero se reinicia.
    - Con la vista previa variable, la grabación sale a 240,1 fps en 720p y en 1080p, y a 119,4 fps a 120. Se pierden unos 5 cuadros en el paso de la vista previa a la grabación.
    - En API 28 o más, la petición de grabación va además como parámetros de la sesión (`SessionConfiguration.setSessionParameters`), para que el HAL elija el modo del sensor al crear la sesión. También probado en el S24.
  - Si la cámara cae antes de dar alrededor de un segundo de vista previa y sin grabación en curso, el error cuenta como `configure_failed`: la pantalla pasa al candidato siguiente en vez de quedar en error.
  - El MP4 se graba sin audio, en H.264, con `setVideoFrameRate(fps)`: la línea de tiempo del archivo es tiempo de captura. Se corta solo al llegar a la duración o al tamaño máximo.
  - Devuelve la ruta, la duración y los cuadros por segundo reales del archivo (muestras sobre su línea de tiempo).
  - Todo lo de cámara y grabador corre en un hilo propio, que se ajusta a lo que piden las props.
  - Si la app pasa a segundo plano o la superficie se destruye, se cierra la cámara. Una grabación cortada así se descarta con el error `interrupted`. Al volver, la cámara se reabre sola.
  - Los errores llegan como `onError` con un código y la pantalla los muestra con los estados que ya tenía (`error`, `no_permission`, `unsupported`).
- **Cuándo se usa el módulo:** en Android, siempre que el teléfono liste una sesión de alta velocidad con un rango fijo que llegue al mínimo. Es la forma que Android documenta para filmar a 120 o 240 fps desde una app. Esperar a que los rangos de VisionCamera fallen sería depender de rangos que el sistema no garantiza. Si no hay sesión de alta velocidad, sigue VisionCamera, que avisa cuando no alcanza. En iOS sigue VisionCamera.
- **Qué se filma** (`chooseHighSpeedConfig`, `src/video/high-speed.ts`, puro y testeado):
  - Primero 240 fps a 720p o más, con el tamaño más cercano al del test (720p para el CMJ, 1080p para el sprint).
  - Si no hay, la tasa más cercana a 240 que llegue al mínimo, a 720p o más. Recién después, menos de 720p.
  - Nunca se graba con un rango variable. Si empatan, gana la primera cámara que lista el sistema (la principal).
  - Con el intento se guarda la tasa de la sesión mientras la tasa medida en el archivo (cuadros sobre su línea de tiempo) esté a ±10% de ella. Si se aleja más, se guarda la medida, redondeada a la tasa estándar más cercana (`recordedFrameRate`). Si esa tasa queda bajo el mínimo, el video se descarta y la pantalla dice que el teléfono no alcanza.
- **Cadena de respaldo** (`highSpeedCandidates`, `HighSpeedOrVisionCamera`). Si la sesión no se configura (`configure_failed`) o el grabador rechaza el tamaño o la tasa (`recorder_failed`), se prueba el siguiente candidato, en este orden:
  1. la misma tasa a un tamaño menor;
  2. la tasa siguiente hacia abajo (120 fps);
  3. los tamaños mayores que el primero;
  4. menos de 720p.

  Cuando no queda ninguno, filma VisionCamera, que dice si el teléfono no alcanza. Si la falla ocurre al abrir, la pantalla sigue en "preparando". Si ocurre grabando, la grabación se corta con el aviso de error hasta que el siguiente candidato está listo. Los otros errores (cámara tomada por otra app, grabación interrumpida, permiso) no cambian de candidato.
- **Importar desde la galería**, en el CMJ y en el sprint, en Android y en iOS:
  - "Elegir un video en cámara lenta" abre el selector del sistema (`expo-image-picker`). En Android es el Photo Picker, o el selector de documentos donde no lo hay, y ninguno pide permiso de almacenamiento. Por eso `READ_EXTERNAL_STORAGE` y `WRITE_EXTERNAL_STORAGE` quedan bloqueados: los declaran `expo-file-system` y `expo-image-picker` hasta Android 12.
  - El archivo se copia al caché sin transcodificar. En iOS se usa `Passthrough` + `current` y se pide leer la fototeca: así el selector entrega el archivo original de la cámara lenta y no una versión armada para reproducir.
  - `CmjFrames.inspect` lee el archivo sin decodificar: el tiempo de presentación de las muestras de video, cuántas son, la tasa que declara el contenedor y la de captura que dejó la cámara en los metadatos. En Android es `MediaExtractor` y `METADATA_KEY_CAPTURE_FRAMERATE` (`com.android.capture.fps`). En iOS es `AVAssetReader` y los metadatos `capture.fps`.
- **Tiempo de captura de un archivo importado** (`videoTiming`, `src/video/imported.ts`, puro y testeado):
  - La tasa de la línea de tiempo sale del intervalo mediano entre cuadros, no de la que declara el contenedor.
  - Si más del 5% de los intervalos se aleja de la mediana, el video mezcla tramos lentos con tramos normales y se rechaza (`variable_rate`).
  - Si los metadatos dicen una tasa de captura mayor que la de la línea de tiempo, el archivo fue reajustado para verse lento: 240 fps capturados que se reproducen a 30. En ese caso la tasa de captura es la de los metadatos y `timelineScale` es el factor entre las dos (8 en el ejemplo). `timelineScale` se calcula con el intervalo medido (`fps de captura × intervalo mediano`), no con la tasa redondeada: con miles de cuadros, 29,97 contra 30 fps correría varios cuadros.
  - La medición usa siempre cuadros sobre la tasa de captura (`t = cuadros / fps de captura`). El extractor de cuadros pide el tiempo de captura multiplicado por `timelineScale`, así que el cuadro `i` es el mismo en las dos líneas de tiempo.
- **Cuándo se acepta un archivo importado.** Se acepta si llega al mínimo de 120 fps de captura y, en el CMJ, si además es MP4 o MOV y no pasa el tamaño de `cmj_video`. Si no, la pantalla dice por qué, con ícono y texto: la tasa que tiene, que mezcla velocidades, que no se pudo leer, el formato o el tamaño. Un archivo rechazado se borra del caché. Uno aceptado sigue al mismo marcado cuadro a cuadro, con su tasa de captura guardada en el intento.

## Consecuencias

- Hay código nativo propio de cámara en Android. Lo cubre el compilado de Kotlin, pero el comportamiento de la sesión depende de cada fabricante, y solo se prueba en un teléfono real: los tests de Node cubren la elección de tamaño y tasa y la lectura de tiempos, y el emulador no tiene cámara de alta velocidad.
- Un archivo reajustado a 30 fps sin la tasa de captura en los metadatos se rechaza como lento, aunque se haya filmado en cámara lenta. Es preferible a medir mal: la pantalla lo explica.
- En iOS, si no se da permiso a la fototeca, el selector puede entregar la versión de la cámara lenta armada para reproducir. Esa versión suele tener la velocidad mezclada o el archivo a 30 fps, y se rechaza diciendo por qué.
- El video del CMJ que se sube es el archivo tal cual. Si estaba reajustado, su línea de tiempo no es tiempo de captura. Los cuadros marcados y la tasa de captura del intento siguen siendo la medición.
- La hora de grabación del intento de un video importado es la del momento en que se importa, no la de la filmación.
