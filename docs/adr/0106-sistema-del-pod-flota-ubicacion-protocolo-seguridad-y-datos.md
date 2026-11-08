# 0106. Sistema del pod: alcance M19 y primera, flota y asignación, consentimiento de ubicación, protocolo LoRa, seguridad, base de tiempo, log en la NAND y variantes del método

- Estado: Propuesto
- Fecha: 2026-11-08
- Issue: #116 (B-912)

## Contexto

[ADR 0105](0105-pod-gnss-imu-con-telemetria-en-vivo.md) define el hardware del pod, el vivo por LoRa y el posprocesado. Una revisión completa del diseño (sistema, firmware y datos) encontró que faltaba decidir lo que hace usable y seguro al sistema entero:

- **No hay modelo de flota**: ni registro de pods, ni asignación pod → jugador con rangos de tiempo, ni corrección de una asignación equivocada. Si dos jugadores se cambian el chaleco, la carga de uno queda en el otro y el ACWR de los dos se rompe.
- **El consentimiento no cubre la ubicación de verdad**: `CONSENT_TYPES` (`packages/domain/src/consent.ts`) solo tiene `data`, `image`, `health` y `menstrual_cycle`, y una firma `outdated` del texto de datos sigue contando como válida.
- **El protocolo LoRa no está especificado**: cómo recibe un pod su turno, cómo conviven dos clubes en el mismo partido, qué baja del gateway, y el formato byte a byte del paquete. Sin identificador de red, dos flotas sincronizadas por GNSS chocan en todos los turnos.
- **La seguridad es de una sola clave por club** y con contadores que se reinician en cada arranque: un pod perdido expone a todo el club y un contador en RAM reusa nonces.
- **La base de tiempo** asume GNSS: el RTC no corre en System OFF, la IMU tiene su propio oscilador y bajo techo puede no haber hora absoluta nunca.
- **El log en la NAND** no tiene formato, ni manejo de bloques malos, ni regla de borrado.
- **Las variantes del método** no cubren el caso más probable (log completo sin PPK) y la precedencia por sesión mezcla variantes en una misma serie.
- **Las definiciones de las métricas** no están copiadas de Catapult (filtros, tiempos de permanencia, fórmula de `accel_load_au`).

Además, el club definió dos cosas:

- **Alcance:** el pod es para **M19 y el plantel superior** (primera). No es para M13–M16 en principio.
- **Sin límite de lugar para grabar:** se usa de visitante y en entrenamientos sin gateway. No se limita la grabación a la cancha del club ni a la presencia del gateway.

## Decisión

### Alcance: M19 y primera

- El pod se asigna solo en las **categorías habilitadas** en la configuración del club (módulo por categoría, [ADR 0041](0041-configuracion-del-club.md)). El valor por defecto en seeds es M19 y primera.
- **Primera entra a la plataforma**: sus jugadores tienen cuenta con rol `player` y su staff usa los roles que ya existen. Hoy `DEFAULT_AGE_BANDS` (`packages/domain/src/category.ts`) solo tiene de M13 a M19. Se suma una **franja de adultos ("primera")** como dato, con la etapa `performance`, percentiles y rankings con nombres para jugadores, cargas máximas permitidas y sin franja de edad máxima. Su alta (franja, categoría, etapa, banderas y la incorporación de jugadores adultos y su staff) es B-920.
- **M19 tiene menores** (17 y 18 años): los principios de menores siguen valiendo. El consentimiento lo firma el tutor hasta los 18 y después el jugador ([ADR 0048](0048-mayoria-de-edad.md)).
- **Salvaguarda:** aunque el pod sea para M19 y primera, la pantalla en vivo **no muestra tabla de posiciones** en las etapas donde no hay rankings con nombres, por si un club lo habilita en otra categoría; por defecto se ordena por número de chaleco. La tablet del modo kiosco ([ADR 0086](0086-modo-kiosco.md)) nunca abre la ruta del vivo.

### Permisos

En la matriz ([ADR 0025](0025-matriz-de-permisos.md)), con RLS como última barrera:

| Acción | Quién |
|---|---|
| Administrar la flota (alta, baja, pérdida, préstamo, salud) | `admin` y `sc` |
| Asignar un pod a un jugador | `coach` y `sc` asignados a la categoría, y `admin` |
| Abrir la pantalla en vivo | `coach` y `sc` asignados a la categoría, y `admin` |
| Leer trazas de posición y mapas de calor | `coach` y `sc` asignados a la categoría, y `admin` |
| Ver la última posición de un pod perdido | `admin` y `sc` |
| Ver sus propias trazas y métricas del pod | el `player` (lo suyo, como el resto de su ficha) |
| Ver trazas de su hijo/a | el `parent` **no**: la ficha resumida de la familia no incluye posición |

### Consentimiento de ubicación

- **Tipo nuevo `location`**, como `menstrual_cycle` ([ADR 0092](0092-seguimiento-del-ciclo-menstrual.md)): un texto propio y versionado del club ([ADR 0043](0043-consentimientos.md)).
- **Hace falta `granted`** (no `outdated`) para **asignar un pod, ingerir sus datos y mostrarlo en vivo**. Una versión nueva del texto pide firmar de nuevo; hasta entonces el jugador no recibe pod.
- **Lo firma el adulto por sí mismo**, o el tutor si el jugador es menor.
- **Revocar borra**, que es más fuerte que en el ADR 0043 (donde revocar corta la recolección futura): un job del worker borra las trazas de posición y los archivos `pod_raw` del jugador, y deja constancia en el historial de cambios sin los datos borrados. Las métricas agregadas que no son posición (distancia total, HSR, aceleraciones) siguen la regla del consentimiento de datos.
- La exportación de los derechos del titular ([ADR 0051](0051-derechos-del-titular.md)) incluye las trazas.

### Grabación, ventana de la sesión y minimización

- **El pod graba cuando está puesto y en movimiento** (Hall del chaleco + IMU), en cualquier lugar, con o sin gateway. No hay geocerca ni condición de gateway (decisión del club).
- **Solo se vuelve dato lo que cae dentro de una sesión del staff** (`training_session`, partido o entrenamiento, con sus tramos; [ADR 0037](0037-sesiones-participacion-y-rpe.md), [ADR 0091](0091-datos-de-cancha-de-hockey.md)) **y** de una asignación válida del pod a ese jugador **y** con su consentimiento `location` vigente. Un tramo de uso sin las tres cosas **nunca se vuelve dato**.
- **Minimización en la base**: el pod indexa sus tramos de uso. La base le pide al servidor las ventanas de las sesiones del club y **sube solo los tramos que se superponen** con alguna. Los demás quedan cifrados en la NAND hasta un máximo de N días configurable por el club (por si el staff carga una sesión tarde) y después se borran.
- **Crudo pendiente en el servidor**: lo subido queda como `pod_raw` en estado **pendiente**, cifrado, hasta que la sesión está cerrada y las asignaciones confirmadas, con un máximo de N días configurable por el club. Mientras está pendiente se puede reprocesar si se corrige una asignación. Después **se recorta una sola vez y para siempre** a las ventanas válidas y se borra el resto.
- **Enmienda al [ADR 0005](0005-pod-crudo-en-storage.md)**: el crudo sigue siendo inmutable, pero **después del recorte**. El original pendiente es temporal.
- **Dónde vive lo no recortado y cuánto**: en la NAND del pod (cifrado), hasta N días o hasta que se descarga; en el servidor (cifrado, pendiente), hasta el cierre de la sesión y la confirmación, o N días.
- **Tramos de uso y sesión son cosas distintas**: el pod registra tramos (puesto/no puesto, quieto/en movimiento). La sesión del staff es la dueña de la ventana. El entretiempo, el banco y la entrada en calor dan varios tramos dentro de una misma sesión; las métricas se calculan por tramo de la sesión y se normalizan por minuto jugado.
- **El cierre del staff es un recorte del lado del servidor por hora**: es el que vale. El cierre en el pod (por la baliza del gateway) es de mejor esfuerzo.
- **Con una sesión abierta no se cierra por quietud**: la baliza avisa que hay sesión abierta y el pod no cierra por quietud larga (el suplente en el banco sigue grabando y no pierde el arranque). Sin gateway, el pod aplica la quietud configurada por el club, y el servidor une los tramos.
- **Riesgo aceptado**: un pod puesto fuera de una sesión (por ejemplo, el chaleco en un bolso en movimiento) graba localmente. Lo mitigan el cifrado en reposo, la minimización en la base, el recorte en el servidor y la revocación de un pod perdido.

### Flota y asignación

- **Identidad global del dispositivo**: una tabla global de dispositivos (sin `club_id`, solo para superadmin y la estación de programación) con el número de serie **único en todo el sistema**, el id del chip (FICR `DEVICEID`), la revisión de hardware y la clave del dispositivo cifrada.
- **Registro de pods por club** (tabla `pod`, con `club_id` y RLS; tests de RLS obligatorios): el dispositivo, el id corto en la red del club, versiones de firmware y del GNSS, estado (`active`, `lost`, `retired`, `lent`) y etiqueta.
- **Préstamo a otro club** (tabla `pod_loan`): crea una fila `pod` en el club que lo recibe, con rango de vigencia, y marca `lent` la del club dueño. Durante el préstamo el pod se vuelve a aprovisionar con las claves del club que lo recibe, y los datos generados son de ese club. Lo anterior queda en el club dueño.
- **Identificación física**: cada pod lleva grabado su número y un QR con el número de serie; el chaleco lleva el mismo número. La app asigna leyendo el QR con la cámara o eligiendo el número (los pines NFC se usan como GPIO, así que no hay "tocar para asignar").
- **Asignación pod → jugador con rangos de tiempo** (tabla `pod_assignment`): sin superposición por pod ni por jugador (restricción de exclusión), con quién la hizo y opcionalmente la sesión. Pasa por el historial de cambios ([ADR 0030](0030-historial-de-cambios.md)): corregir una asignación pide motivo.
- **Asignación sin conexión** (de visitante): `pod_assignment` es una colección sincronizada para el staff, así la tablet conoce las asignaciones sin señal. Las altas sin conexión van por la cola con `clientUuid`, pero **no se resuelven por "gana el último"**: el servidor acepta la primera y rechaza una que se superpone con un conflicto (`409`). La app muestra el conflicto para corregirlo con motivo, y los datos de esa sesión quedan pendientes hasta resolverlo.
- **Corrección de una asignación equivocada**: al cambiar un rango, el worker reprocesa las sesiones afectadas (mientras el crudo esté pendiente) y los derivados se recalculan por el outbox.
- **Pod encendido sin asignar**: la pantalla en vivo lo muestra como "pod 23 sin asignar" (solo staff), para asignarlo en el momento.
- **Pod perdido o robado**: se marca `lost`, se revocan sus claves (ver seguridad) y se muestra la última posición conocida (último paquete en vivo o última base) a quien administra la flota.
- **Salud de cada pod**: ciclos y capacidad estimada de la batería (MAX17048), bloques malos de la NAND, última vez visto, versiones. La base la informa en cada conexión.

### Protocolo LoRa

- **Identificador de red** de 16 bits por gateway, en claro en el encabezado, para filtrar.
- **Plan de canales por red**: cada gateway usa un juego de 8 canales de 125 kHz dentro de 915–928 MHz. Al arrancar escucha balizas de otras redes y elige un juego libre. Dos clubes en el mismo partido, o dos canchas del mismo club, usan juegos distintos.
- **Trama de 2 s** sincronizada por GNSS en el gateway, que lleva **GPS con PPS**:
  - **ventana de baliza** al principio: la baliza va en el **primer canal del plan de la red**. Lleva una parte fija (red, hora GNSS completa, época de clave, "sesión abierta", cierres del staff, modo partido del LED, versión de la configuración) y **solo asignaciones incrementales** de turnos (unas pocas por baliza). Con unos 48 B son unos 98 ms en el aire: la ventana es de 120 ms;
  - **un turno de contienda por canal** para pedir turno (unirse a la red);
  - el resto son **turnos de subida** asignados.
- **Asignación de turnos por la baliza**: el pod que escucha una red pide turno en la contienda; el gateway se lo asigna (canal, turno) en una baliza siguiente. Si deja de escuchar balizas, mantiene su turno durante el holdover y después se calla y vuelve a pedir. **Sin gateway, el pod no transmite**: solo graba.
- **Holdover y guarda**: con PPS la incertidumbre es de microsegundos; sin PPS ni baliza, el reloj de 32,768 kHz (±20 ppm) deriva 1,2 ms por minuto. Con una guarda de ±3 ms, el holdover es de **unos 2,5 minutos**; pasado ese tiempo el pod no transmite.
- **Paquete de subida** (SF7, 125 kHz, CR 4/5, encabezado explícito, CRC, preámbulo de 8 símbolos). El encabezado en claro es el dato asociado (AAD) de AES-CCM: va autenticado, no cifrado.

  | Bytes | Campo | En claro |
  |---|---|---|
  | 1 | Versión (4 bits) y tipo (4 bits) | Sí |
  | 2 | Id de red | Sí |
  | 2 | Id corto del pod | Sí |
  | 1 | Id de clave (época) | Sí |
  | 2 | Contador de arranques (16 bits bajos) | Sí |
  | 2 | Número de trama del arranque | Sí |
  | 2 | Estado: batería (7 bits), chaleco puesto (1), calidad del fix (3), reservado (5) | No |
  | 3 | Distancia acumulada de la sesión (dm) | No |
  | 8 | Distancia acumulada en 4 bandas de velocidad configuradas (m) | No |
  | 4 | Aceleraciones y desaceleraciones acumuladas | No |
  | 3 | `accel_load_au` acumulada | No |
  | 2 | Impactos acumulados (en hockey se ignora: no se guarda ni se muestra) | No |
  | 4 | Velocidad máxima de cada uno de los 2 segundos (cm/s) | No |
  | 2 | Distancia de cada uno de los 2 segundos (dm) | No |
  | 8 | Posición de los 2 segundos respecto del origen de la sesión (dm, x/y); opcional por club | No |
  | 1 | Versión de la configuración aplicada | No |
  | 4 | MIC de AES-CCM | — |

  Son unos **51 B: unos 103 ms** en el aire. Con turnos de 115 ms (paquete, guarda de ±3 ms y conmutación), una trama de 2 s menos la ventana de baliza de 120 ms deja 16 turnos por canal; menos uno de contienda por canal, son **15 turnos por canal: unos 120 pods en 8 canales, sin RTK**. Alcanza para los 100 pods de un club; dos categorías juntas en una cancha son menos de 60.
- **Contadores acumulados**: un paquete perdido solo atrasa los números; el siguiente los trae completos. El vivo no subcuenta por pérdidas.
- **El pod no decide umbrales**: las bandas de velocidad, el umbral de aceleración y los demás parámetros se los manda la base o la baliza como **configuración versionada** (del club, [ADR 0041](0041-configuracion-del-club.md)), y el paquete dice qué versión aplicó. El pod valida los rangos de la configuración, así una configuración falsificada no lo deja en un estado peligroso.
- **RTK en el mismo gateway no entra en la cuenta**: el SX1302 es half-duplex, así que cada turno de bajada bloquea los 8 canales de subida. Un fragmento RTCM de 255 B son unos 400 ms en el aire (cerca del límite de permanencia), y las correcciones MSM L1/L5 son varios cientos de bytes por segundo. **Los 120 pods suponen sin RTK.** Si se usa la EA con RTK, va con su propia radio de bajada, a 500 kHz o con una tasa menor (MSM4, menos constelaciones, cada 2–5 s), y se decide en B-914 y B-917.
- **Si ENACOM exige salto de frecuencia** (B-903): la rama alternativa es LoRa de **500 kHz** (modulación digital sin salto), con menos canales y paquetes de unos 25 ms. El SX1302 tiene un solo demodulador de 500 kHz, así que la capacidad se recalcula y puede hacer falta un segundo gateway.
- **Gateway de exterior**: el RAK7268V2 es de interior. Va un gateway de exterior con GPS (clase RAK7289) o un concentrador SX1302 con GPS y una computadora Linux en un gabinete estanco, con PoE o batería.
- **Servicio de borde en el gateway**: recibe los paquetes, los guarda y los sirve a las tablets por WebSocket en la red local, y los sube cuando hay internet. **No tiene las claves de los pods**: descifra la tablet.
- **Tablet en primer plano**: iOS suspende las conexiones con la pantalla bloqueada; la pantalla en vivo pide mantenerse encendida y, si se cae, se reconecta y pide al borde lo que perdió.

### Seguridad

- **Clave maestra por club** en el servidor (cifrada, nunca en un pod ni en un gateway). De ella salen, con el **id del chip** (FICR `DEVICEID`, no el id corto de la red):
  - la **clave de enlace de cada pod**: `KDF(maestra, "uplink" | DEVICEID | época)`;
  - la **clave de almacenamiento de cada pod** para la NAND: `KDF(maestra, "storage" | DEVICEID | época)`;
  - la **clave de baliza de cada gateway**: `KDF(maestra, "beacon" | id del gateway | época)`.
- **Clave del dispositivo** (simétrica, por pod): la genera la estación de programación, se graba en la flash protegida del pod y queda en el servidor; nunca la ve la base.
- **Clave de firma del servidor fijada en el pod**: el pod trae de fábrica la clave pública (P-256) del servidor. Los comandos que llegan por la base (aprovisionar, rotar, borrar, actualizar) van **firmados por el servidor**, y las claves de enlace, almacenamiento y baliza van **envueltas con la clave del dispositivo** (AES-KW). **La base solo pasa blobs opacos**: no ve ninguna clave.
- **Gateway y baliza**: el gateway tiene **su propia clave de baliza** y autentica con ella la baliza, la bajada y las correcciones RTCM.
  - **Un gateway robado** permite falsificar balizas, cierres, configuración y RTCM de su red hasta que se revoca. **No expone los datos de subida**: no tiene las claves de los pods.
  - **Un pod perdido** expone sus propias claves y las claves de baliza que guarda. Se revocan sus claves y se rotan **solo las claves de baliza** de los gateways del club en la próxima base. No hay rotación de todo el club.
  - **Firma asimétrica de la baliza, descartada por ahora**: 64 B de firma en cada baliza suman unos 90 ms por trama (un turno menos por canal) y una verificación ECDSA cada 2 s en el pod. Se puede revisar si la rotación de claves de baliza resulta engorrosa.
- **Rotación y revocación**: las claves tienen época (el id de clave del paquete). La base rota en cada conexión cuando hay época nueva, con una ventana de solapamiento.
- **Nonce de AES-CCM del enlace** = DEVICEID + id de clave + contador de arranques de 32 bits + número de trama + dirección.
  - El **contador de arranques** es persistente (en NVS/ZMS de la flash interna): se incrementa y se guarda antes de la primera transmisión de cada arranque, incluidos los despertares de System OFF y los reinicios. El paquete lleva los 16 bits bajos y el receptor reconstruye los altos siguiendo el último valor visto.
  - El **número de trama** es de 16 bits y empieza en cada arranque; antes de dar la vuelta (unas 36 h), el pod incrementa y guarda el contador de arranques y vuelve a empezar.
  - Si el contador de arranques da la vuelta dentro de una época, el pod no transmite hasta rotar en la base.
- **Nonce de la baliza** = id de red + hora GNSS completa de la trama.
- **Anti-repetición en la tablet**: guarda el último (arranque, trama) por pod y época en su base local cifrada; sobrevive a reinicios de la app.
- **Las claves de la sesión llegan a la tablet desde el servidor** antes de la sesión y quedan en la base local cifrada ([ADR 0069](0069-base-local-y-motor-de-sincronizacion-mobile.md)), así funciona de visitante sin internet.
- **APPROTECT**: el endurecido está solo en los nRF52840 de código de fabricación Fxx (revisión 3) en adelante; qué revisión trae el Raytac, **no verificado**. Se activa en la primera programación, junto con `NFCPINS` y `PSELRESET` en la UICR, y el firmware lo mantiene bloqueado (`CONFIG_NRF_APPROTECT_LOCK`).
- **Arranque seguro**: MCUboot con imágenes firmadas (ECDSA P-256), en modo de intercambio con prueba y confirmación y vuelta atrás automática.
  - **Contra versiones viejas**: la prevención de MCUboot solo existe en el modo de sobrescritura, y el contador de seguridad por hardware en NCS para el nRF52840 está **no verificado**. Por eso el servidor firma el comando de actualización con la versión y el pod rechaza una más vieja.
  - **Flash interna de 1 MB**: MCUboot, dos slots de unos 450 KB para la aplicación y una zona NVS/ZMS para contadores y ajustes. La NAND no sirve como segundo slot sin un driver propio.
- **Cifrado en reposo de la NAND**: AES-CTR (CryptoCell-310) con la clave de almacenamiento. El IV es **época de clave + número de secuencia de la página**, nunca la dirección física (que se reusa al borrar). El encabezado de cada página dice el id de clave. CTR da solo confidencialidad: cada página lleva además un **MAC (AES-CMAC truncado a 8 B)** con la misma clave, aparte del CRC.
- **USB autenticado**: la base habla con el pod solo con comandos autenticados; el pod no se monta como disco. Lleva su propio VID/PID (de pid.codes o del USB-IF, a definir), no el de pruebas de Nordic/Zephyr.
- **BLE**: dirección privada resoluble y sin id fijo en el anuncio. Anuncia solo a pedido (desde la base o un comando) o cerca de la base, nunca en espera dentro de un bolso.

### Actualización del firmware

- **Desde la base**, por USB con MCUmgr; BLE como respaldo. Nunca durante una sesión ni con la batería debajo de un umbral configurable.
- **Despliegue escalonado** en la flota: unos pocos pods primero, después el resto, con vuelta atrás si fallan.
- **La versión del firmware y la del GNSS** van en cada archivo y en el estado que informa la base. El firmware del LC29H se fija y se registra, y su configuración completa se manda en cada arranque (no persiste entre versiones de su firmware).

### Base de tiempo

- **Contador monotónico del RTC** (cristal de 32,768 kHz) mientras el nRF está encendido. Cada despertar de System OFF abre una época de tiempo nueva.
- **Anclas** (contador, hora GNSS del PPS) escritas en el log. La captura del PPS se hace con el RTC, y el oscilador de 32 MHz se enciende solo alrededor de los turnos de radio o si hace falta más resolución (EA con RTK).
- **IMU con marcas de tiempo en su FIFO**, correlacionadas con el contador en cada PPS; el barómetro se muestrea con la hora del nRF.
- **Ancla de la base**: al descargar, la base (con hora de red) deja una ancla, así una sesión sin fix (bajo techo) igual tiene hora absoluta. Lo grabado antes del primer fix se ubica hacia atrás con las anclas.
- **Arranque rápido del GNSS**: al sacar el pod de la base, la base le inyecta hora, última posición y efemérides predichas (EPO/AGNSS; soporte del LC29H **no verificado**).
- **El día de la sesión** se calcula en la zona horaria del club, aunque los archivos usen UTC.

### Log en la NAND y contrato de ingesta

- **Un formato versionado y compartido**: el paquete `packages/pod-protocol` (TypeScript) decodifica el paquete en vivo y el log, con archivos de ejemplo. El firmware (C) se prueba contra los mismos archivos en CI.
- **Páginas solo de agregado** de 2 KiB, cada una con encabezado (formato, pod, tramo, secuencia de página, época de tiempo, id de clave), registros con tipo (PVT a 10 Hz, crudo a 1 Hz, lotes de la FIFO de la IMU con marcas, ráfagas de impacto, barómetro, eventos de estado y del chaleco, anclas de tiempo, configuración aplicada), CRC32 y MAC. Un corte de energía a mitad de una escritura pierde como mucho esa página.
- **Bloques malos y ECC**: la tabla de bloques malos del W25N (LUT) y la marca de fábrica; el estado del ECC de cada lectura (incorregible → se marca la página y se sigue).
- **Índice de tramos** en bloques reservados, reconstruible recorriendo la memoria.
- **Memoria llena**: nunca se pisa lo que no se descargó. El pod deja de grabar, lo avisa con el LED y la app lo muestra.
- **Borrado solo con confirmación**: la base sube cada tramo con `PUT` firmado y confirmación ([ADR 0044](0044-archivos-urls-firmadas-y-retencion.md)); el pod borra solo cuando el servidor confirma el SHA-256.
- **Tipo de archivo nuevo `pod_raw`** con estado pendiente y retención propia configurable por club; las trazas de posición derivadas siguen la misma retención y el consentimiento `location`.
- **La base** guarda localmente y reintenta: 100 pods son unos 5 GB por día y un club puede tener poca subida.

### Variantes del método y precedencia

- El método sigue siendo `pod` (principio 4), con una **variante** guardada con cada valor:
  - `pod_live`: los resúmenes del vivo;
  - `pod_log`: el log completo de la NAND reprocesado después, sin PPK;
  - `pod_ppk`: con PPK;
  - `pod_rtk`: con RTK en vivo (EA);
  - `pod_uwb`: con UWB bajo techo.
- Cada valor guarda además la **versión del algoritmo**, la del firmware y la del firmware del GNSS.
- **Precedencia por familia de métrica**, no por sesión:
  - **velocidad, distancia, HSR, sprints, aceleraciones y `accel_load_au`** salen del Doppler y la IMU, que no dependen del PPK: vale `pod_log`;
  - **posición** (mapa de calor, distancias entre jugadores): `pod_rtk` en los tramos con solución fija, después `pod_ppk`, después `pod_log`. Se elige **por tramo**, no por sesión entera;
  - `pod_live` vale solo si el log nunca se descargó (pod perdido) y queda marcado.
- **La interfaz marca una serie que mezcla variantes o versiones del algoritmo**, y nunca las compara sin avisar.

### Definiciones de las métricas

- **Datos del club, copiados de la configuración de OpenField de primera** (B-002): filtro de velocidad, filtro de aceleración, tiempo mínimo de permanencia por banda y por esfuerzo, umbrales de HSR por sexo ([ADR 0088](0088-umbrales-y-referencias-femeninas.md)) y de aceleración.
- **Sprints**: no hay código canónico en el diccionario todavía; se define con el club (por ejemplo `sprints_n`, con su umbral y tiempo de permanencia) en B-919.
- **`accel_load_au`**: suma de la raíz de los cuadrados de los cambios de aceleración en los 3 ejes a 100 Hz, con escala y orientación definidas y versionadas (nunca se usa el nombre "PlayerLoad").
- **Vmax de referencia para las métricas relativas** (`hsr_rel_m`, `vmax_pct`): el máximo de la media móvil de 1 s de la velocidad del pod en las sesiones recientes, con filtro de plausibilidad, o la que fije el club. Queda registrada cuál se usó. La Vmax del `sprint_40` es la media del tramo 20–40 m y no se mezcla con un pico.
- **Filtro de plausibilidad** de velocidad y aceleración (picos por multicamino), con los rangos del dominio.
- **Hockey**: no se guarda ni se muestra ningún valor de contactos o impactos; los esfuerzos repetidos salen solo de corridas y aceleraciones ([ADR 0091](0091-datos-de-cancha-de-hockey.md)).
- **Ráfagas de impacto**: la tasa del canal de alto rango y la profundidad de pre-disparo de la FIFO se fijan en el banco; el algoritmo de contactos lleva versión.
- **El vivo es aproximado** y lo dice: se calcula con los resúmenes y la configuración versionada; el informe usa `pod_log`.

### Estación base y validación

- **La estación base de la cancha es un producto**: LG290P con su registrador, alimentación, subida del crudo, coordenadas relevadas una vez por cancha (no promediadas por sesión, que dan un desvío distinto en cada una) y, con la EA, las correcciones al gateway.
- **La validación contra Catapult** guarda por métrica el sesgo y los límites de acuerdo como datos, para avisar cuando se compara la historia del pod con datos de Catapult. Incluye cuerpos de M19, no solo de primera.

## Alternativas descartadas

- **Limitar la grabación a la cancha del club o a la presencia del gateway.** Protegía mejor la ubicación, pero el club usa el pod de visitante y en entrenamientos sin gateway. Se cubre con la minimización en la base, el recorte en el servidor, el consentimiento propio y el cifrado en reposo.
- **Recortar el crudo en la ingesta, sin estado pendiente.** Impedía reprocesar cuando se corrige una asignación.
- **Ubicación dentro del consentimiento de datos.** Una firma `outdated` sigue contando, así que se juntarían trazas sin un consentimiento explícito.
- **Una sola clave por club.** Un pod perdido expondría a todo el club.
- **Turnos fijos por número de pod.** Dos flotas sincronizadas por GNSS chocarían en todos los turnos.
- **Resúmenes por segundo sin acumulados.** Cada paquete perdido subcuenta el vivo.
- **Precedencia por sesión.** Mezcla variantes dentro de una serie y tira tramos buenos de RTK.
- **Descifrar en el gateway.** Un gateway robado en la cancha expondría los datos de todos los pods.
- **Resolver por "gana el último" las asignaciones sin conexión.** Rompe la restricción de no superposición y asigna en silencio los datos de un jugador a otro.

## Consecuencias

- Hay trabajo nuevo en la base y la API: `location` en `consent_type`, la tabla global de dispositivos, `pod`, `pod_loan` y `pod_assignment` con RLS y tests, `pod_raw` con estado pendiente en los tipos de archivo, la variante y las versiones en los valores del pod, las celdas nuevas de la matriz y la franja de adultos. Cada una con su migración.
- **Enmienda al ADR 0005**: el crudo es inmutable después del recorte, con un estado pendiente previo y temporal.
- El firmware crece: protocolo con baliza y turnos, claves derivadas, contador persistente, MCUboot, cifrado en reposo y el formato del log. Lo cubren B-904, B-905 y los ítems nuevos.
- El hardware suma un gateway de exterior con GPS y la estación base como productos, con costo propio.
- La capacidad por gateway queda en **unos 120 pods sin RTK**; con RTK o si ENACOM exige salto de frecuencia, se recalcula.
- La pantalla en vivo es aproximada y lo dice; los informes usan el log.
- Ítems nuevos del backlog: B-912 a B-920. El encabezado de este ADR apunta a B-912 porque `pnpm docs:check` exige un solo `B-xxx` en la línea del issue; el ADR cubre de B-912 a B-920.
- Este ADR queda **Propuesto** junto con el ADR 0105, hasta el banco y la cancha.
