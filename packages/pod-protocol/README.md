# @sport-performance/pod-protocol

Protocolo del pod ([ADR 0106](../../docs/adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md)):

- **LoRa** (B-905 y B-914): el formato byte a byte del paquete en vivo, de la baliza y de los fragmentos RTCM, los nonces, el sellado con AES-CCM, la derivación de claves, la reconstrucción del contador de arranques, la anti-repetición del receptor y la cuenta del tiempo en el aire.
- **Log en la NAND** (B-916): páginas de 2 KiB solo de agregado con AES-CTR y CMAC, registros con tipo, base de tiempo con anclas, índice reconstruible, reglas de borrado, el decodificador del worker, el codificador de referencia y el archivo `pod_raw` que sube la base.

También trae los **archivos de ejemplo** (`fixtures/v1/vectors.json`, `fixtures/v1/log-vectors.json` y `fixtures/v1/pod-raw-sample.bin`) que el firmware en C usa en CI para probar que codifica igual.

TypeScript sin dependencias de plataforma: el núcleo no usa `node:*`, ni `Buffer`, ni `TextEncoder`, ni WebCrypto (el build compila con `types: []`), así corre igual en la app (Expo), en el worker y en la API. La criptografía usa las primitivas AES y HKDF de `@noble/ciphers` y `@noble/hashes` (auditadas y ya presentes en el lockfile por Better Auth).

## Qué hay

| Módulo | Qué hace |
|---|---|
| `uplink` | Encabezado en claro, carga útil del resumen en vivo, `sealUplink` / `openUplink` y `receiveUplink` (lo que corre la tablet por paquete) |
| `downlink` | Baliza (`sealBeacon` / `openBeacon`) y fragmento RTCM (`sealRtcmFragment` / `openRtcmFragment`) |
| `nonce` | `linkNonce` y `downlinkNonce` |
| `counters` | `reconstructBootCounter` (16 bits bajos → 32 bits) y `nextLinkCounter` (regla de la vuelta del número de trama, referencia para el firmware) |
| `replay` | Estado de anti-repetición por pod y época, inmutable y serializable a JSON |
| `crypto` | Interfaz `CcmProvider`, proveedor `nobleCcmProvider`, `deriveLinkKey`, `deriveStorageKey`, `deriveBeaconKey` |
| `airtime` | Fórmula de Semtech, capacidad del TDMA y holdover |
| `errors` | `PodProtocolError` con un `code` estable (`authentication_failed`, `replay`, `invalid_length`, `mac_mismatch`…) |
| `log/page` | Encabezado de la página, `sealLogPage`, `inspectLogPage` (sin clave: borrada, cortada, CRC) y `openLogPage` (CMAC y descifrado) |
| `log/records` | Registros TLV con tipo: `encodeRecord`, `decodeRecord`, conversión de la IMU a unidades físicas |
| `log/writer` | `LogWriter`: codificador de referencia (registros → páginas selladas) |
| `log/decoder` | `decodeLog`: lo que corre el worker sobre un volcado o un `pod_raw` |
| `log/timeline` | Base de tiempo por arranque (`buildTimeBase`, `tickToGnssMs`) y reloj de la IMU (`buildSensorClock`) |
| `log/nand` | `scanNand` (índice sin clave), `nextWritableBlock`, comando de borrado (`encodeEraseCommand`), `eraseDecision`, `planErase`, `selectSegmentsToUpload` |
| `log/pod-raw` | Archivo `pod_raw` y su manifiesto (`buildPodRawFile`, `readPodRawFile`), `verifyUploadForErase` (lo que revisa el servidor antes de firmar el borrado) y `podRawIngestKey` |
| `log/capacity` | Cuentas de tamaño: páginas por hora, bloques por sesión, sesiones por memoria |

Los nombres llevan la unidad: `sessionDistanceDm`, `vmaxCmS`, `speedBandDistancesM`, `gnssTimeS`, `accelLoadCentiAu`. Los valores decodificados son enteros en la unidad del cable; la conversión a unidades del dominio (m, m/s, AU) la hace quien consume.

## Formato de la radio (versión 1)

Todos los enteros de más de un byte van en **little-endian** (el orden nativo del nRF52840 y del HAL del SX1302, igual que LoRaWAN). El byte 0 de toda trama es `versión (4 bits altos) | tipo (4 bits bajos)`; la versión 0 no es válida.

| Tipo | Código | Dirección | Largo |
|---|---|---|---|
| `live_summary` | `0x1` | pod → gateway | 51 B |
| `live_summary_no_position` | `0x2` | pod → gateway | 43 B |
| `slot_request` | `0x3` | pod → gateway | 14 B |
| `beacon` | `0x8` | gateway → pod | 21 + 3·N B (≤ 48 B) |
| `config` | `0x9` | gateway → pod | reservado (cuerpo sin definir) |
| `rtcm_fragment` | `0xA` | gateway → pod | 14 + datos (≤ 255 B) |

### Paquete de subida

Encabezado en claro (10 B), que es el **AAD** de AES-CCM:

| Bytes | Campo |
|---|---|
| 0 | Versión y tipo |
| 1–2 | Id de red (u16) |
| 3–4 | Id corto del pod (u16) |
| 5 | Id de clave (época, u8) |
| 6–7 | Contador de arranques, 16 bits bajos (u16) |
| 8–9 | Número de trama del arranque (u16) |

Carga útil cifrada del resumen en vivo (37 B; 29 B sin posiciones):

| Bytes | Campo | Unidad |
|---|---|---|
| 0–1 | Estado (u16): batería [15..9], chaleco puesto [8], calidad del fix [7..5], reservado [4..0] = 0 | % (127 = desconocida) |
| 2–4 | Distancia acumulada de la sesión (u24) | dm |
| 5–12 | Distancia acumulada en las 4 bandas de velocidad (4 × u16) | m |
| 13–14 | Aceleraciones acumuladas (u16) | n |
| 15–16 | Desaceleraciones acumuladas (u16) | n |
| 17–19 | `accel_load_au` acumulada (u24) | 0,01 AU |
| 20–21 | Impactos acumulados (u16; en hockey se ignoran) | n |
| 22–25 | Vmax del segundo t−1 y del segundo t (2 × u16; 0xFFFF = sin dato) | cm/s |
| 26–27 | Distancia del segundo t−1 y del segundo t (2 × u8; 0xFF = sin dato) | dm |
| 28–35 | Solo `live_summary`: x, y de t−1 y x, y de t respecto del origen de la sesión (4 × i16; −32768 = sin posición) | dm |
| 36 (28) | Versión de la configuración aplicada (u8, módulo 256) | — |

Después van los **4 B del MIC**. Total: 10 + 37 + 4 = **51 B**, unos **102,7 ms** en SF7 / 125 kHz / CR 4/5.

Calidad del fix (3 bits): 0 `no_fix`, 1 `dead_reckoning`, 2 `fix_2d`, 3 `fix_3d`, 4 `dgnss`, 5 `rtk_float`, 6 `rtk_fixed`; 7 reservado.

Los contadores acumulados **saturan** en su máximo, nunca dan la vuelta. Un paquete perdido solo atrasa los números.

El pedido de turno (`slot_request`) es el encabezado con una carga útil vacía y el MIC: el gateway lo usa para asignar sin poder verificarlo (no tiene las claves de los pods); la tablet sí lo verifica.

### Baliza

Encabezado en claro (8 B, AAD): versión y tipo, id de red (u16), **hora GNSS de la trama** (u32, segundos GPS desde el 06/01/1980, sin segundos intercalares, siempre par porque la trama es de 2 s), id de clave de baliza (u8).

Cuerpo cifrado:

| Bytes | Campo |
|---|---|
| 0 | Banderas: sesión abierta [0], modo del LED [2..1] (`normal`, `match`, `off`; 3 reservado), reservado [7..3] = 0 |
| 1 | Id del plan de canales de la red (u8) |
| 2 | Versión de la configuración (u8) |
| 3 | Secuencia de sesión (u8; sube en cada apertura o cierre del staff) |
| 4–7 | Hora GNSS de la última apertura o cierre (u32; 0 = ninguna) |
| 8 | Cantidad de asignaciones N (0..9) |
| 9… | N × { id corto del pod (u16), liberar [7] · canal [6..4] · turno [3..0] } |

El turno 0 de cada canal es el de **contienda** y nunca se asigna; los turnos asignables son del 1 al 15. Con 9 asignaciones la baliza mide **48 B, unos 97,5 ms**: entra en la ventana de 120 ms.

### Fragmento RTCM

Encabezado en claro (10 B, AAD): versión y tipo, id de red, hora GNSS de la trama, id de clave, índice del fragmento (u8), cantidad de fragmentos (u8). Cuerpo cifrado: de 1 a 241 B del flujo RTCM. Un fragmento lleno (255 B) son unos 400 ms en el aire.

### Nonces

- **Enlace** (13 B): contador de arranques completo (u32) ‖ número de trama (u16) ‖ dirección (`0x00` subida, `0x01` bajada) ‖ seis ceros.
- **Baliza y bajada** (13 B): id de red (u16) ‖ hora GNSS de la trama (u32) ‖ **byte 0 de la trama** (versión y tipo) ‖ índice de fragmento (u8; 0 en la baliza) ‖ cinco ceros.

AES-CCM con nonce de 13 B (L = 2) y MIC de 4 B.

### Contador de arranques y número de trama

- El número de trama cuenta las **tramas de 2 s desde el arranque**: sube aunque el pod no transmita en esa trama. El pod manda **como mucho una subida por (arranque, trama)**, sea del tipo que sea: ese par es el nonce entero.
- El número de trama empieza en 0 en cada arranque. Antes de pasar de 0xFFFF (unas 36 h), el pod incrementa y **guarda** el contador de arranques y vuelve a 0 (`nextLinkCounter`, con `persistBootCounter`). Si el contador de arranques llegaría a dar la vuelta, el pod no transmite hasta rotar la clave en la base (`boot_counter_exhausted`).
- El receptor reconstruye los 32 bits con el valor **más cercano** a la referencia, dentro de ±32 768 arranques (`reconstructBootCounter`). La referencia es el **mayor** entre lo último aceptado para el pod (en cualquier época) y la pista del servidor (`bootCounterHint`, el último contador que vio en la base), así la pista también hace avanzar a un pod. Sin ninguna de las dos toma los bits altos en 0. Una reconstrucción equivocada solo hace fallar el MIC.
- **Tope de salto**: `receiveUplink` rechaza con `counter_jump` un contador de arranques más de `maxBootCounterAhead` (1024 por defecto) por encima de la referencia, así un paquete falso que pase el MIC de 4 B por suerte no puede llevar la ventana al final del espacio de 32 bits. Quien llama puede escalar el tope con el tiempo desde que vio al pod.
- Anti-repetición: se acepta solo un (arranque, trama) **estrictamente mayor** que el último aceptado para ese pod y esa época, y el estado se actualiza **después** de verificar el MIC.
- Los paquetes de un mismo pod se procesan **de a uno**: se espera cada `receiveUplink` y se pasa su `replay` al siguiente. Un paquete que llega después de uno más nuevo (por ejemplo, lo que reenvía el borde al reconectar) vuelve como `replay`; los acumulados del más nuevo ya lo incluyen.

### Del lado del gateway

- **Persiste la última hora GNSS que usó** para sellar y nunca sella dos mensajes distintos para el mismo (red, hora, tipo, fragmento): después de un reinicio, de perder el GPS o ante una hora sospechosa, no transmite hasta tener una hora posterior a la guardada.
- No puede verificar el pedido de turno (no tiene las claves de los pods): solo asigna turnos a ids cortos de la lista de pods del club.
- La época (u8) nunca da la vuelta: antes de la 255 el club rota la clave maestra.

### Claves

`KDF(maestra, etiqueta | id | época)` = **HKDF-SHA256** (RFC 5869), sal vacía, 16 B de salida (AES-128, lo que hace el CryptoCell-310), con

```
info = ASCII("sport-performance/pod-kdf/v1/" + etiqueta) ‖ 0x00 ‖ u8(largo del id) ‖ id ‖ u8(época)
```

- `uplink` y `storage`: id = FICR `DEVICEID[0]` ‖ `DEVICEID[1]` tal como están en memoria (8 B, 0x10000060..0x10000067).
- `beacon`: id = EUI-64 del concentrador del gateway (8 B).
- La clave maestra del club es de 32 B.

## Versionado

- La **versión del protocolo** (el nibble alto del byte 0) cambia solo si cambia el formato de algo que ya existe. Un tipo nuevo se suma sin cambiar la versión.
- Los archivos de ejemplo viven en `fixtures/v<versión>/`. Una versión nueva agrega su carpeta y deja la anterior mientras haya pods en la cancha con ese firmware.
- El ADR 0106 está **Propuesto**: hasta el banco y la cancha, el formato de la versión 1 todavía puede cambiar; si cambia, cambian los archivos de ejemplo en el mismo PR que el firmware.

## Archivos de ejemplo para el firmware

`fixtures/v1/vectors.json` tiene, con claves de prueba fijas (nunca de un club):

- `keys` y `kdf`: clave maestra, DEVICEID, id del gateway, `info` y claves derivadas;
- `uplink`: por caso, los campos, el nonce, el encabezado, la carga útil en claro y el paquete sellado;
- `beacon` y `rtcm`: igual para la bajada;
- `rejections`: paquetes que hay que rechazar y el código esperado (MIC alterado, encabezado alterado, bits altos del contador equivocados, versión, largo, bits reservados);
- `receiveSequence`: una secuencia de paquetes de un pod, desde un estado vacío, con el resultado esperado de cada uno (aceptado o repetido, incluida la vuelta de los 16 bits bajos);
- `bootCounterReconstruction` y `airtime`.

El firmware los consume así en su CI:

1. Lee el JSON desde `packages/pod-protocol/fixtures/v1/vectors.json` (un script del build del firmware lo convierte en un `.h` o lo lee el test de host con un parser de JSON).
2. **Codifica** cada caso de `uplink` a partir de sus campos y compara el `plaintextHex`, el `nonceHex` y el `packetHex` byte a byte.
3. **Deriva** las claves de `kdf` y compara.
4. **Abre** cada caso de `beacon` y `rtcm` con la clave de baliza y compara los campos.
5. Para `rejections` y `receiveSequence`, verifica que el receptor de prueba (si lo hay en el firmware) dé el mismo resultado.

Del lado de TypeScript, `src/fixtures.test.ts` (y `src/log/fixtures.test.ts` para el log) regenera los vectores desde las definiciones y falla si el archivo del repo no coincide. Para cambiarlos a propósito:

```sh
pnpm --filter @sport-performance/pod-protocol fixtures:update
```

## Proveedor de AES-CCM

`CcmProvider` es una interfaz con `seal` y `open` asíncronos. `nobleCcmProvider` arma CCM (RFC 3610 / NIST SP 800-38C) sobre los bloques AES de `@noble/ciphers` (ECB, CBC y CTR; noble no trae CCM). Los tests lo comparan con el vector 1 de RFC 3610 y con `aes-*-ccm` de Node/OpenSSL (`src/testing/node-ccm.ts`, solo para tests). La app puede inyectar un módulo nativo con la misma interfaz.

## Decisiones propias (resumidas en el ADR 0106, "Formato v1 del protocolo")

El ADR no fijaba estos puntos; se eligieron acá y el ADR los resume:

1. **Little-endian** en todo el cable y en los nonces.
2. **Códigos de tipo**: subida 0x1–0x7 y bajada 0x8–0xF; `live_summary` 0x1, sin posiciones 0x2 (la posición es opcional por club: se elige por tipo y largo, no por una bandera cifrada), pedido de turno 0x3, baliza 0x8, configuración 0x9, RTCM 0xA. Versión del protocolo = 1.
3. **Orden de bits del estado**: batería en los 7 bits altos, después el chaleco, después la calidad del fix, y los 5 reservados abajo (en cero; si no, se rechaza). Batería en % de 0 a 100, con 127 = desconocida. Tabla de valores de la calidad del fix.
4. **Anchos**: 4 bandas × u16 en m, aceleraciones y desaceleraciones u16 cada una, `accel_load_au` u24 en centésimas de AU, Vmax por segundo u16 en cm/s, distancia por segundo u8 en dm, posición i16 en dm (±3,2 km), con centinelas de "sin dato".
5. **Contadores que saturan** en vez de dar la vuelta.
6. **El nonce de bajada usa el byte 0 completo** (versión y tipo) como "tipo de mensaje".
7. **Hora GNSS** = segundos GPS (u32), siempre par.
8. **Baliza**: plan de canales (u8), secuencia de sesión (u8) y hora de la última apertura o cierre (u32) como forma de los "cierres del staff"; hasta 9 asignaciones de 3 B, que dan los 48 B del ADR; turno 0 = contienda.
9. **Pedido de turno** de 14 B (encabezado + MIC, sin carga útil).
10. **KDF**: HKDF-SHA256 con la `info` de arriba, sal vacía, AES-128; id del gateway = EUI-64.
11. **Ventana de reconstrucción** del contador de arranques de ±32 768.
12. **Número de trama** por trama de 2 s desde el arranque, con una sola subida por (arranque, trama).
13. **Referencia** = máximo entre lo aceptado y la pista del servidor, con **tope de salto** (`counter_jump`).
14. **Anti-repetición** por (id corto, época), sin el id de red.

## Log en la NAND (formato v1)

El pod graba todo en la W25N04KV (4 Gbit; la W25N02KV de 2 Gbit tiene la misma geometría con la mitad de bloques): **páginas de 2048 B** más un área de repuesto (la usan el ECC interno y la marca de bloque malo de fábrica; el formato no la toca) y **64 páginas por bloque**. Se borra por bloque. Todo entero va en **little-endian**, como en la radio.

### Página (2048 B)

| Bytes | Campo |
|---|---|
| 0–3 | Magia `SPLG` (`53 50 4c 47`) |
| 4 | Versión del formato (1; la 0 no vale) |
| 5 | Época de la clave de almacenamiento (id de clave) |
| 6 | Banderas: comienzo del tramo [0], fin del tramo [1], el último registro sigue en la página siguiente [2], cierre de recuperación [3] (página vacía con fin del tramo), reservados [7..4] = 0 |
| 7 | Reservado = 0 |
| 8–15 | DEVICEID (FICR, 8 B como en memoria) |
| 16–19 | Contador de arranques (u32): la época de tiempo de los ticks |
| 20–23 | Id del tramo de grabación (u32, monótono por pod) |
| 24–27 | Secuencia de página (u32, monótona por pod, nunca se reusa) |
| 28–31 | Posición de la carga útil en el flujo del tramo (u32, bytes) |
| 32–33 | Largo de la carga útil (u16, ≤ 1996) |
| 34–35 | Posición del primer registro que empieza en la página (u16; `0xFFFF` = ninguno, la página solo continúa uno) |
| 36–37 | Registros que empiezan en la página (u16) |
| 38–39 | Reservado = 0 |
| 40–2035 | Carga útil cifrada con **AES-128-CTR** con la clave de cifrado (relleno con ceros después del largo) |
| 2036–2043 | **AES-CMAC** (RFC 4493) de los bytes 0–2035 con la clave de MAC, truncado a 8 B |
| 2044–2047 | **CRC-32** (IEEE 802.3, el de zlib) de los bytes 0–2043 |

- **El encabezado va en claro y autenticado** (entra en el CMAC): la base y el escaneo del pod lo leen sin clave.
- **IV del CTR** (16 B): dominio `0x4C` ‖ época (u8) ‖ secuencia de página (u32 LE) ‖ seis ceros ‖ contador de bloque (u32 BE desde 0; una página son 125 bloques). Nunca la dirección física, que se reusa al borrar, y nunca un bloque de contador todo en cero (el byte de dominio).
- **Cifrar y después autenticar**: el CMAC va sobre el texto cifrado. El CRC va aparte, para que la base (sin clave) y el escaneo detecten páginas cortadas o dañadas.
- **Claves**: `deriveStorageKey` = `KDF(maestra, "storage" | DEVICEID | época)`, y de ella **dos claves separadas** (`deriveLogPageKeys`): HKDF-SHA256 con la clave de almacenamiento de entrada, sal vacía e `info` = `ASCII("sport-performance/pod-log/v1/ctr")` para el CTR y `.../cmac` para el CMAC, 16 B cada una. El pod las deriva una vez por época; CTR y CMAC nunca comparten clave.
- **Secuencia de página**: el pod guarda en la NVS una reserva de secuencias (por ejemplo de a 1024) y en cada arranque empieza por encima de la reserva y de lo que encuentra en la memoria. Es la mitad del IV: nunca se repite con la misma clave. Sigue contando aunque cambie la época; si llegara a dar la vuelta, el pod no graba hasta rotar la clave en la base.

### Flujo de registros

Cada tramo de grabación es **un flujo de bytes** de registros que se corta en cargas útiles de 1996 B: un registro puede cruzar páginas (el crudo GNSS, de unos 2 kB, siempre cruza). La posición en el flujo (bytes 28–31) dice exactamente cuánto se perdió entre dos páginas legibles, y la posición del primer registro (34–35) permite **resincronizar** después de una página perdida. `LogWriter.flush()` cierra una página corta (antes de dormir) y el flujo sigue en la siguiente; `close()` escribe la página con la bandera de fin (vacía si el flujo terminó justo en el borde). Si un corte de energía dejó un tramo abierto, en el arranque siguiente, antes de volver a grabar, el pod escribe un **cierre de recuperación** (`sealRecoveryPage`): una página vacía con las banderas de fin y de recuperación en la próxima página borrada del **último bloque del propio tramo** (`planRecoveryPage`), con una secuencia nueva y la clave actual; solo si ese bloque está lleno va al primer bloque libre (cuesta un bloque de 128 KiB por corte, por eso es el respaldo). Así el tramo queda final, autenticado por el propio pod. Antes de dar un tramo por cerrado, el pod verifica el CMAC de su página de fin con su clave (`segmentNeedsRecovery`): un encabezado con CRC válido no alcanza.

Registro (TLV):

| Bytes | Campo |
|---|---|
| 0 | Tipo (u8; 0x00 y 0xFF nunca empiezan un registro, 0xE0–0xFE son experimentales) |
| 1–2 | Largo del cuerpo (u16) |
| 3–8 | Tick (u48): contador del RTC a 32,768 kHz desde el arranque, cuando se produjo el registro |
| 9… | Cuerpo |

Un decodificador **saltea por el largo** un tipo que no conoce, así un tipo nuevo se suma sin cambiar la versión del formato. Los valores 0 de las enumeraciones no valen.

| Tipo | Código | Cuerpo | Notas |
|---|---|---|---|
| `firmware_info` | 0x01 | versión del firmware (u8, u8, u16), id del build (u32), revisión de hardware (u8), versión del algoritmo (u16), versión de la radio (u8), versión del log (u8), largo (u8) y firmware del GNSS (ASCII, ≤ 64) | al empezar cada tramo |
| `config_applied` | 0x02 | versión de la configuración (u32, completa), hash (8 B del SHA-256), PVT (u8 Hz), crudo (u8 Hz; 0 = apagado), constelaciones (máscara: GPS, GLONASS, Galileo, BeiDou, QZSS, NavIC), bandas (máscara: L1, L5) | 16 B |
| `gnss_pvt` | 0x10 | hora GPS (u48 ms), lat y lon (i32, 1e-7°), altura elipsoidal (i32 mm), velocidad norte, este y abajo por Doppler (3 × i16 mm/s), velocidad horizontal (u16 mm/s), rumbo (u16, centésimas de grado), hAcc y vAcc (u16 mm), sAcc (u16 mm/s), calidad del fix (u8, la tabla de la radio), satélites (u8) | 36 B, a 10 Hz. −32768 y 0xFFFF = sin dato; las precisiones saturan en 65 534 |
| `gnss_raw` | 0x11 | formato (u8: 1 RTCM3 MSM7, 2 RTCM3 MSM4, 3 crudo de Quectel), hora GPS (u48 ms; 0xFFFF_FFFF_FFFF = desconocida), datos opacos | a 1 Hz |
| `imu_batch` | 0x20 | sensor (u8: LSM6DSV320X, ICM-42688-P, ADXL372), canal (u8: 1 acelerómetro y giróscopo, 2 alto rango), banderas (desborde de la FIFO [0], ráfaga de impacto [1]), rango del acelerómetro (u16 g), del giróscopo (u16 °/s; 0 en alto rango), ODR (u32 mHz), período del reloj del sensor (u32 ns; 21 750 en el LSM6DSV), marcas del primer y del último dato (2 × u32, reloj del sensor), cantidad (u16), datos (i16 LSB, 6 ejes o 3) | el tick es la lectura de la FIFO; los datos van parejos entre las dos marcas |
| `baro_batch` | 0x30 | sensor (u8: BMP581, DPS368), ODR (u32 mHz), ticks del primer al último dato (u32), cantidad (u16) y, por dato, presión (u24, centésimas de Pa) y temperatura (i16, centésimas de °C) | el tick es el primer dato (hora del nRF) |
| `time_anchor` | 0x40 | fuente (u8: PPS del GNSS, baliza, base), ns después del tick (u16; la captura es más fina que un tick), hora GPS (u48 ms), incertidumbre (u32 µs; 0xFFFF_FFFF = desconocida), GPS − UTC (u8 s; 0xFF = desconocido) | 14 B |
| `sensor_sync` | 0x41 | sensor (u8), ns después del tick (u16), marca del sensor (u32) | en cada PPS |
| `segment_marker` | 0x50 | tipo (u8: inicio y fin de grabación, chaleco puesto y sacado, empieza y termina el movimiento, apertura y cierre del staff), detalle (u8: el motivo, o la secuencia de sesión de la baliza), hora GPS de la apertura o el cierre (u32 s; 0 si no aplica) | 6 B |
| `health` | 0x60 | batería (u8 %; 127 = desconocida), tensión (u16 mV; 0 = desconocida), temperatura de la celda y del MCU (2 × i16, centésimas de °C), ciclos de carga, bloques malos, bloques libres y lecturas corregidas por ECC (4 × u16) | 15 B |
| `radio_tx` | 0x70 | número de trama (u16), duración (u32 µs), potencia (i8 dBm), byte 0 de la trama (u8) | el tick es el comienzo de la TX |
| `event` | 0x71 | código (u16: desborde de la FIFO, reinicio del GNSS, configuración rechazada, falla al programar o al borrar la NAND, caída de tensión, watchdog), valor (u32) | 6 B |

### Base de tiempo

- Los ticks son del **RTC a 32,768 kHz** y empiezan en cada arranque: el contador de arranques del encabezado es la época de tiempo.
- `buildTimeBase` arma, por arranque, una función **lineal por tramos** que pasa por las anclas (tick ↔ hora GPS). Primero las mejores: un ancla de una fuente peor (base < baliza < PPS) entre dos mejores a menos de 60 s se descarta. Después, **consenso**: se quedan las anclas de la **cadena más larga** en orden de tick en la que cada par consecutivo es consistente (ritmo a menos de **100 ppm** del nominal, más las dos incertidumbres: el cristal es de ±20 ppm y queda margen para temperatura y envejecimiento, y un salto de 1 s se detecta entre anclas de hasta 10 000 s), buscada por programación dinámica en O(n · K): cada eslabón saltea **como mucho 64 anclas**, así que un hueco sin anclas se sigue uniendo pero nunca se puentea un salto de la hora GNSS. Entre cadenas del mismo largo gana la de mejores fuentes; las anclas dentro del tramo de la cadena que no entran se rechazan. Así las anclas malas, sean una al principio, periódicas (por ejemplo una de cada tres corrida 1 s) o alternadas al azar, pierden contra las buenas.
- **Saltos de la hora GNSS**: las anclas antes o después de esa cadena que concuerdan entre sí (10 o más, o 3 que cubran 30 s) forman su propio **tramo de tiempo** (`stretches`) y el salto entre tramos se informa (`steps`, con su tamaño en ms). Hay como mucho 16 tramos por arranque (`MAX_TIME_STRETCHES`); el resto se rechaza con `too_many_stretches`. Se arma con una lista de trabajo, sin recursión: como mucho 33 pasadas de O(n · K). Cada tick se ubica con el tramo que lo contiene o el más cercano: nunca se interpola a través de un salto.
- `gnssMsToTick` usa el tramo cuyas horas GPS contienen el valor, o el más cercano. Después de un salto **hacia atrás**, dos tramos pueden cubrir las mismas horas GPS: entonces gana el **primero en orden de tick** (la hora GPS sola no alcanza para elegir).
- Antes de la primera ancla y después de la última se **extrapola** con la pendiente del tramo más cercano (con una sola ancla, al ritmo nominal): así lo grabado antes del primer fix se ubica hacia atrás. Bajo techo, las anclas de la base al salir y al volver (en el mismo arranque) dan la pendiente.
- `tickUncertaintyMs`: la incertidumbre del ancla más cercana más ±20 ppm por la distancia a ella.
- **IMU**: `buildSensorClock` correlaciona la marca del sensor (u32, que da la vuelta) con el RTC por los `sensor_sync`; cada lote queda con el tick de su primer y su último dato. Entre dos sincronizaciones la marca tiene que avanzar lo que dice el RTC (5 % de tolerancia, módulo 2³²): si no, el sensor se reinició y empieza un tramo nuevo del reloj (no se confunde con una vuelta). Con un período del sensor de 0 no hay reloj. Sin sincronización, se cuenta hacia atrás desde la lectura de la FIFO, al ODR.
- Las épocas del GNSS que se superponen con una TX de LoRa salen marcadas (`duringRadioTx`).
- La conversión a UTC (`gnssMsToUnixMs`) usa el GPS − UTC que trajo el ancla (18 s por defecto).

### Memoria, índice y borrado

- **Un tramo empieza siempre en un bloque borrado** y es dueño de sus bloques: borrar un tramo nunca toca otro. Se pierden como mucho 63 páginas por tramo.
- **Nunca se pisa lo que no se descargó**: los bloques salen solo de los libres (`nextWritableBlock`), y un bloque es libre solo si **se leyeron todas sus páginas y están borradas**; una página que no se leyó nunca se supone borrada. Un bloque del que no se leyeron las 64 páginas, programado o no, queda como **desconocido** (`unknownBlocks`): no se escribe ni se borra, y un tramo con un bloque así no es `fullyRead`, así que la base no arma su `pod_raw` y el pod no lo borra.
- **Memoria llena, siempre con lugar para el cierre**: el pod guarda **un bloque de reserva** borrado (`DEFAULT_RESERVE_BLOCKS`) que la grabación nunca usa: un tramo nuevo empieza solo con un bloque libre más allá de la reserva (`canStartSegment`) y `nextWritableBlock` no entrega la reserva. Antes de cada registro, el pod compara las páginas que sellaría (`LogWriter.pagesSealedBy`) con las que le quedan al tramo (`remainingSegmentPages`: lo que queda del bloque actual más los bloques libres después de la reserva) y solo agrega si **queda una página para el cierre** (`mayAppend`). Si no, deja de grabar, escribe el fin del tramo en esa página, lo avisa con el LED y la app lo muestra. La reserva queda para el cierre de recuperación de un tramo cuyo último bloque se llenó (un corte justo en la última página); hasta que se borre algo, no se graba otro tramo. **`mayAppend` vale también antes de `flush()`**: si el buffer no está vacío, `flush()` sella una página, así que el firmware solo la llama si después sigue quedando la página del cierre (si no, llama a `close()` directamente).
- **Dónde va el cierre de recuperación** (`planRecoveryPage`), siempre después de la última página programada del bloque: primero la página siguiente del último bloque del propio tramo; si está lleno, la próxima página borrada de un **bloque huérfano cuyas páginas programadas son todas cortadas o con CRC malo** (restos ilegibles; la página de recuperación válida lo une al tramo, así un cierre de recuperación cortado en la reserva se reintenta ahí y la memoria nunca queda trabada); y solo como último recurso un bloque libre (la reserva, 128 KiB por corte).
- **Bloques malos**: la marca de fábrica (byte 0 del repuesto de la página 0 del bloque), la LUT del W25N y los que fallan al programar o borrar. El firmware no los usa; si falla un programa, marca el bloque y reescribe la página en el siguiente bloque bueno con una secuencia nueva (el decodificador descarta la copia repetida por su posición en el flujo).
- **ECC**: el estado de cada lectura viaja con la página (`ok`, `corrected`, `uncorrectable`). Una página incorregible se marca, se saltea y se informa, y el flujo sigue en la próxima.
- **Índice de tramos**: el pod lo guarda en los 8 bloques reservados del principio, pero es una caché: `scanNand` lo reconstruye sin clave (tramos, páginas, bloques, si se cerraron, bloques libres, huérfanos y mezclados) y `decodeLog`, con las claves, agrega el rango de tiempo.
- **Borrado atado a lo subido y verificado**:
  1. La base sube el `pod_raw` del tramo con su manifiesto.
  2. El servidor lo lee (`readPodRawFile` con el manifiesto), lo decodifica **con la clave** y revisa con `verifyUploadForErase` que tenga exactamente ese tramo, que todas las páginas que el escaneo del pod contó como válidas pasen el CMAC (`validPagesN` = `authenticPagesN`), que coincida el rango de páginas, que las direcciones físicas de las páginas del archivo estén en los bloques del manifiesto y que el tramo esté **cerrado**, por su última página o por el cierre de recuperación del pod. Nunca por lo que diga la base. La ingesta es idempotente por (DEVICEID, arranque, tramo) (`podRawIngestKey`).
  3. Recién ahí firma (P-256, con la clave fijada en el pod) un **comando de borrado** que nombra el tramo: DEVICEID, arranque, tramo, primera y última secuencia, páginas válidas, bloques y SHA-256 (`encodeEraseCommand`, magia `SPER`).
  4. El pod verifica la firma y `eraseDecision` borra solo si el SHA-256 es el del archivo que subió y su propio escaneo coincide **exactamente** con el comando (`command_mismatch` si no). `planErase` borra solo los bloques que nombra el comando, y nunca uno mezclado, desconocido o de un tramo que no se puede borrar; los huérfanos (restos de una escritura cortada), solo a pedido.

  La **única excepción**: un tramo que no se superpone con ninguna sesión se borra sin subir a los N días (configurable por el club). Si la base no pudo preguntar las sesiones (sin conexión), nada se borra por edad.
- **Minimización en la base**: `selectSegmentsToUpload` elige los tramos que se superponen con alguna ventana de sesión (con margen).

### Archivo `pod_raw`

Lo que sube la base por cada tramo: las páginas **tal como están en la NAND** (cifradas y con su CMAC), así la base nunca ve una clave y el servidor guarda el archivo cifrado mientras está pendiente.

| Bytes | Campo |
|---|---|
| 0–3 | Magia `SPRW` |
| 4 | Versión del contenedor (1) |
| 5 | Versión del formato de las páginas (1) |
| 6–7 | Tamaño de página (u16, 2048) |
| 8–15 | DEVICEID |
| 16–23 | Contador de arranques e id del tramo (2 × u32) |
| 24–31 | Primera y última secuencia de página (2 × u32) |
| 32–35 | Cantidad de páginas N (u32) |
| 36–63 | Reservado = 0 |
| 64… | N × { página física (u32), estado del ECC (u8: 0 bien, 1 corregido, 2 incorregible), 3 B reservados, los 2048 B de la página } |

Van todas las páginas programadas de los bloques del tramo, válidas o no, en orden físico, para que el worker informe lo que se perdió. El **manifiesto** (`PodRawManifest`, los metadatos del archivo) lleva el DEVICEID, el número de serie del pod, el arranque, el tramo, el rango de páginas, las entradas del archivo (`pagesN`) y las páginas válidas del escaneo (`validPagesN`), los bloques, las épocas de clave, si se cerró, el rango de tiempo en UTC (del índice del pod), el tamaño y el **SHA-256**. `readPodRawFile` lo verifica antes de confirmar, y `verifyUploadForErase` decide si el servidor puede firmar el borrado.

### Lo que hace el worker

`decodeLog` recibe las páginas (un volcado con `pagesFromDump` o un `pod_raw` con `readPodRawFile`) y el **DEVICEID obligatorio** del pod (el del manifiesto, revisado contra la tabla de dispositivos): el worker nunca decodifica páginas sin saber de quién son. Nunca falla por datos malos: todo se informa. Si las anclas o las marcas de los sensores son hostiles y algo de la temporización falla, el error va a `timeIssues` y el tramo se decodifica igual, sin hora absoluta: un trabajo del worker nunca se cae en cada reintento.

1. Saltea las páginas de bloques malos y las de ECC incorregible y descarta las borradas; verifica el CRC (cortada si la cola lee borrada), el encabezado, el pod y el CMAC con la clave de su época; descifra.
2. Agrupa por (DEVICEID, arranque, tramo), ordena por posición en el flujo y descarta copias repetidas.
3. Arma los tramos contiguos del flujo, informa los huecos (`stream`: bytes perdidos; `stream_end`: falta la página de cierre; `stream_overlap`: dos páginas auténticas cubren los mismos bytes, se queda la primera) y parsea los registros, con resincronización en el primer registro de la página siguiente.
4. Separa los flujos con tipo (`pvt`, `raw`, `imu`, `baro`, `anchors`, `markers`, `health`, `radioTx`, `events`, `firmware`, `config`, `unknown`), arma la base de tiempo de cada arranque, ubica la IMU, marca las épocas con TX y detecta los huecos de PVT, IMU y barómetro.
5. Devuelve los **intervalos de uso** (grabando, chaleco puesto, en movimiento) según los marcadores; la sesión del staff es la dueña de la ventana.

### Tamaño

La carga útil es el 97,5 % de la página. Se reservan 8 bloques para el índice y unos 82 (2 %) para bloques malos, cifra **no verificada** contra la hoja de Winbond.

| Flujo | Páginas por hora | Bloques por sesión de 3 h | Sesiones de 3 h en 4 Gbit | En 2 Gbit |
|---|---|---|---|---|
| 2,5 kB/s (sensores, pod-f3.md) | 4510 | 212 | 18 | 9 |
| 4,5 kB/s (con crudo GNSS a 1 Hz) | 8117 | 381 | 10 | 5 |
| 2,86 kB/s (registros v1, perfil por defecto) | 5159 | 242 | 16 | 8 |
| 4,88 kB/s (registros v1, con crudo) | 8795 | 413 | 9 | 4 |

Los encabezados y las marcas de tiempo de los registros suman un 14 % a la estimación de pod-f3.md (`profileStreamRateBps`). Las ráfagas de impacto del canal de alto rango suben la tasa mientras duran, así que en rugby el margen real es algo menor.

### Archivos de ejemplo del log

`fixtures/v1/log-vectors.json` y `fixtures/v1/pod-raw-sample.bin`, con las mismas claves de prueba:

- `keys`: clave maestra, DEVICEID, claves de almacenamiento de las épocas 2 y 3 (con la `info` del HKDF) y sus claves de CTR y de CMAC;
- `records`: un registro de cada tipo, con sus campos y sus bytes;
- `segment`: los registros de un tramo de 2 s (con crudo) y, por página, el encabezado, el IV, la carga útil en claro, el CMAC, el CRC y la página entera, más el resultado esperado de decodificarlo;
- `epochChange`: un tramo con cambio de época a mitad;
- `damaged`: lecturas dañadas (CRC, CMAC con el CRC recalculado, escritura cortada, ECC incorregible, bloque malo, páginas desordenadas entre borradas) y lo que se espera de cada una;
- `podRaw`: el manifiesto de `pod-raw-sample.bin`;
- `timeline` (con `consensus`: un PPS 5 s corrido y 600 buenos, malos periódicos consistentes, malos alternados al azar, una ráfaga corta y un salto de la hora GNSS de 5 s, como pares [tick, hora GPS], con los tramos, los saltos y la hora verdadera de cada consulta) y `capacity`;
- en `damaged`, `recovery_close`: la última página cortada y el cierre de recuperación.

El firmware codifica los registros de `segment.records` y `epochChange.records` con su escritor, compara cada `pageHex` byte a byte y deriva las claves; si tiene decodificador, compara también los casos de `damaged`. `src/log/fixtures.test.ts` regenera los dos archivos con el mismo `fixtures:update`.

### Decisiones del log (resumidas en el ADR 0106, "Formato v1 del log")

1. Página de 40 B de encabezado en claro y autenticado, 1996 B de carga útil, CMAC de 8 B y CRC-32 al final; magia `SPLG`.
2. IV = dominio ‖ época ‖ secuencia de página, con la secuencia monótona por pod en toda su vida (no por época) y reservada en la NVS.
3. CMAC sobre el texto cifrado, con claves de CTR y de CMAC separadas (HKDF desde la clave de almacenamiento); CRC aparte para revisar sin clave.
4. Registros TLV con un tick u48 del RTC en cada uno, en un flujo continuo por tramo que cruza páginas, con la posición en el flujo y la del primer registro para medir huecos y resincronizar.
5. El tramo de grabación es la unidad de subida y de borrado, y empieza en un bloque borrado.
6. Hora GPS en ms (u48) en el PVT y en las anclas, en la misma escala que la radio (sin segundos intercalares).
7. Base de tiempo lineal por tramos con prioridad PPS > baliza > base: cadena consistente más larga a 100 ppm, con eslabones de hasta 64 anclas salteadas, y tramos de tiempo separados por los saltos de la hora GNSS.
8. `pod_raw` = las páginas cifradas tal cual, con su dirección física y su estado de ECC, más un manifiesto con el SHA-256.
9. Borrado solo con un comando firmado que nombra exactamente el tramo (rango de páginas, páginas válidas, bloques, SHA-256), emitido después de decodificar con la clave, y que el pod compara con su propio escaneo.
10. Un bloque solo es libre, o se puede borrar, si se leyeron sus 64 páginas; la base de tiempo es la cadena consistente más larga.
11. Un tramo cortado por un corte de energía lo cierra el propio pod con un cierre de recuperación autenticado; el servidor confirma solo tramos cerrados.

## Fuera de este paquete

- El cuerpo del mensaje de configuración (`0x9`).
- La ingesta del `pod_raw` en la base y el worker (tipo de archivo, estado pendiente, recorte único, variantes del método): B-912 y lo que sigue de B-916.
- El formato del índice de tramos dentro de los bloques reservados (es del firmware y se reconstruye con `scanNand`), los comandos USB de la base y los algoritmos de métricas sobre los flujos decodificados.
- La tabla de planes de canales (frecuencias por `channelPlanId`), el envoltorio de claves con AES-KW y los comandos firmados de la base.
- La anti-repetición de la baliza en el pod (la hace el firmware contra su hora GNSS).
