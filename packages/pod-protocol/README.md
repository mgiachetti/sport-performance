# @sport-performance/pod-protocol

Protocolo LoRa del pod ([ADR 0106](../../docs/adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), B-905 y B-914): el formato byte a byte del paquete en vivo, de la baliza y de los fragmentos RTCM, los nonces, el sellado con AES-CCM, la derivación de claves, la reconstrucción del contador de arranques, la anti-repetición del receptor y la cuenta del tiempo en el aire. También trae los **archivos de ejemplo** (`fixtures/v1/vectors.json`) que el firmware en C usa en CI para probar que codifica igual.

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
| `errors` | `PodProtocolError` con un `code` estable (`authentication_failed`, `replay`, `invalid_length`…) |

Los nombres llevan la unidad: `sessionDistanceDm`, `vmaxCmS`, `speedBandDistancesM`, `gnssTimeS`, `accelLoadCentiAu`. Los valores decodificados son enteros en la unidad del cable; la conversión a unidades del dominio (m, m/s, AU) la hace quien consume.

## Formato (versión 1)

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

- El pod manda **una sola subida por (arranque, trama)**, sea del tipo que sea: ese par es el nonce entero.
- El número de trama empieza en 0 en cada arranque. Antes de pasar de 0xFFFF (unas 36 h), el pod incrementa y **guarda** el contador de arranques y vuelve a 0 (`nextLinkCounter`, con `persistBootCounter`). Si el contador de arranques llegaría a dar la vuelta, el pod no transmite hasta rotar la clave en la base (`boot_counter_exhausted`).
- El receptor reconstruye los 32 bits con el valor **más cercano** al último visto, dentro de ±32 768 arranques (`reconstructBootCounter`). Sin referencia toma los bits altos en 0; el servidor le pasa a la tablet el último contador que vio en la base (`bootCounterHint`). Una reconstrucción equivocada solo hace fallar el MIC.
- Anti-repetición: se acepta solo un (arranque, trama) **estrictamente mayor** que el último aceptado para ese pod y esa época, y el estado se actualiza **después** de verificar el MIC.

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

Del lado de TypeScript, `src/fixtures.test.ts` regenera los vectores desde las definiciones y falla si el archivo del repo no coincide. Para cambiarlos a propósito:

```sh
pnpm --filter @sport-performance/pod-protocol fixtures:update
```

## Proveedor de AES-CCM

`CcmProvider` es una interfaz con `seal` y `open` asíncronos. `nobleCcmProvider` arma CCM (RFC 3610 / NIST SP 800-38C) sobre los bloques AES de `@noble/ciphers` (ECB, CBC y CTR; noble no trae CCM). Los tests lo comparan con el vector 1 de RFC 3610 y con `aes-*-ccm` de Node/OpenSSL (`src/testing/node-ccm.ts`, solo para tests). La app puede inyectar un módulo nativo con la misma interfaz.

## Decisiones propias (a llevar al ADR 0106)

El ADR no fija estos puntos; se eligieron acá y se proponen para el ADR:

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

## Fuera de este paquete

- El cuerpo del mensaje de configuración (`0x9`) y el formato del log en la NAND (páginas, registros, CTR + CMAC): mismo paquete, en un PR siguiente.
- La tabla de planes de canales (frecuencias por `channelPlanId`), el envoltorio de claves con AES-KW y los comandos firmados de la base.
- La anti-repetición de la baliza en el pod (la hace el firmware contra su hora GNSS).
