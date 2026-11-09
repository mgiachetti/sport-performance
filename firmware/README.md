# firmware

Firmware propio del pod GNSS + IMU por jugador (Fase 3, B-904), en C sobre **Zephyr con el nRF Connect SDK** ([ADR 0109](../docs/adr/0109-firmware-del-pod-zephyr-ncs-y-tests-de-host.md)). Es la única parte del repo que no es TypeScript ([ADR 0002](../docs/adr/0002-typescript-estricto.md)) y no forma parte del workspace de pnpm.

Hardware: [`pod-v0.md`](../docs/hardware/pod-v0.md) (placa, pines, estados de energía, LED). GNSS: [`lc29h-protocolo.md`](../docs/hardware/lc29h-protocolo.md). Formatos de la radio y del log: [`packages/pod-protocol`](../packages/pod-protocol/README.md). Decisiones del sistema: [ADR 0105](../docs/adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md) y [ADR 0106](../docs/adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md).

**Estado: esqueleto.** Los formatos (paquete de subida, baliza, RTCM, log en la NAND) están implementados y probados byte a byte contra los archivos de ejemplo de TypeScript; el resto son módulos con su interfaz, cableados a los periféricos y con los `TODO(B-904)` de lo que falta. Nada de esto corrió todavía en hardware: el banco ([`banco-gnss.md`](../docs/hardware/banco-gnss.md), B-901) y la v0 lo validan.

## Estructura

```text
firmware/
├── west.yml                  manifiesto de west: NCS v3.4.1, solo los proyectos que usa el pod
├── lib/                      C portable, sin Zephyr: se prueba en la compu
│   ├── include/pod/*.h
│   └── src/
│       ├── radio.c           subida, baliza, RTCM, nonces, KDF, contador de enlace
│       ├── log.c             registros TLV, página (encabezado, CTR, CMAC, CRC) y escritor
│       ├── gnss.c            checksum NMEA, comandos, PQTMPVT/VEL/EPE, separador NMEA/RTCM3, secuencias
│       ├── power.c           máquina de estados de energía, plan del BQ25180, MAX17048
│       ├── led.c             tabla de patrones del LED y atenuación por SYS
│       ├── time_base.c       RTC de 48 bits, anclas del PPS, turnos del TDMA
│       ├── crypto_psa.c      AES-CTR/CMAC/CCM y HKDF sobre PSA (CryptoCell-310), en el pod
│       ├── crypto_soft.c     lo mismo en C de referencia, solo para los tests de host
│       └── crypto_selftest.c vectores conocidos que corren en cada arranque
├── app/                      aplicación de Zephyr
│   ├── CMakeLists.txt, Kconfig, prj.conf, VERSION
│   ├── sysbuild.conf, Kconfig.sysbuild, sysbuild.cmake   MCUboot y la guarda de la clave
│   ├── boards/pod/pod_v0/    placa propia: devicetree con todos los pines de pod-v0.md
│   ├── boards/nrf52840dk_nrf52840.overlay                 banco con el DK y placas sueltas
│   ├── dts/bindings/         binding de la W25N02KV (sirve para la W25N04KV)
│   └── src/                  pegamento con Zephyr, un archivo por módulo
├── tests/host/               tests en C plano con CMake (ASan + UBSan)
└── tools/gen_fixtures.py     JSON de pod-protocol → header de C para los tests
```

## Compilar

Hace falta el toolchain del NCS v3.4.1. Lo más simple es la imagen oficial de Nordic, la misma que usa el CI (`.github/workflows/firmware.yml`, fijada por digest):

```sh
docker pull ghcr.io/nrfconnect/sdk-nrf-toolchain:v3.4.1
```

O instalar el toolchain con `nrfutil toolchain-manager install --ncs-version v3.4.1`.

El repo es el **repositorio del manifiesto** de west y el workspace es la carpeta que lo contiene (west baja `nrf/`, `zephyr/`, `modules/`… al lado del repo, nunca adentro):

```sh
mkdir ~/pod-ws && cd ~/pod-ws
git clone https://github.com/mgiachetti/sport-performance.git
west init -l sport-performance --mf firmware/west.yml
west update --narrow -o=--depth=1
```

Para compilar (con sysbuild: MCUboot + la aplicación firmada):

```sh
# DK de banco
west build -b nrf52840dk/nrf52840 -d build/dk sport-performance/firmware/app

# Placa del pod. La placa vive en app/boards: BOARD_ROOT relativo a la aplicación.
west build -b pod_v0/nrf52840 -d build/pod sport-performance/firmware/app -- -DBOARD_ROOT=.
```

Con Docker, montando el workspace:

```sh
docker run --rm -v ~/pod-ws:/ws -w /ws ghcr.io/nrfconnect/sdk-nrf-toolchain:v3.4.1 \
  "west build -b nrf52840dk/nrf52840 -d build/dk sport-performance/firmware/app"
```

Salen `build/dk/mcuboot/zephyr/zephyr.hex` (MCUboot), `build/dk/app/zephyr/zephyr.signed.hex` (la aplicación firmada, para grabar) y `build/dk/app/zephyr/zephyr.signed.bin` (la imagen para DFU). `west flash -d build/dk` graba las dos.

## Grabar el DK

Con el J-Link del DK por USB (`nrfutil device` o `nrfjprog`):

```sh
west flash -d build/dk
```

La consola queda en el UART del J-Link (VCOM, 115200). En el pod la consola principal es RTT por el Tag-Connect y el UARTE1 es el pad de respaldo.

La **primera grabación del pod** (paso de producción, B-909) escribe además la UICR: `NFCPINS` (P0.09 y P0.10 como GPIO: WAKEUP del GNSS y Hall) y `PSELRESET` (P0.18 como reset), que salen del devicetree de `pod_v0` (`nfct-pins-as-gpios`, `gpio-as-nreset`). Después, APPROTECT.

## Tests de host

Prueban la biblioteca portable sin hardware ni Zephyr, con el gcc o el clang de la compu:

```sh
cmake -S firmware/tests/host -B build/host
cmake --build build/host
ctest --test-dir build/host --output-on-failure
```

Qué cubren:

- **Radio contra `packages/pod-protocol/fixtures/v1/vectors.json`**: KDF (`info` y claves), cada caso de subida (nonce, encabezado, carga útil en claro y paquete sellado byte a byte), apertura de las balizas y del fragmento RTCM con sus campos, MIC y encabezado alterados, versión, largo y la regla del contador de enlace.
- **Log contra `log-vectors.json`**: claves de almacenamiento y de página (CTR y CMAC) de las dos épocas, cada registro del catálogo y **cada página de los dos tramos** (`segment` y `epochChange`, con la rotación de clave) idéntica a la de TypeScript; cierre de recuperación, CRC-32 y `pagesSealedBy`.
- **Crypto contra los estándares**: FIPS-197, SP 800-38A, RFC 4493, RFC 5869 y RFC 3610, más el autotest de arranque.
- **GNSS**: el checksum de cada comando escrito en `lc29h-protocolo.md`, la secuencia de arranque de la AA en orden (con los 2 s entre `$PAIR003` y `$PAIR002`), el WAKEUP de 10 ms, los parsers de `$PQTMPVT`, `$PQTMVEL`, `$PQTMEPE` y `$PAIR001`, y el separador de NMEA y RTCM3 (CRC-24Q).
- **LED**: que ningún estado repita el patrón de otro, los tiempos y la atenuación por SYS.
- **Energía**: la tabla de estados y la precedencia de cierre de pod-v0.md (la sesión termina a la hora del evento, no del tiempo que lo confirma), System OFF, modo envío esperando a la NAND, el plan de despertares y los registros del BQ25180.
- **Base de tiempo**: extensión del RTC, anclas del PPS (con vuelta del TIMER y lectura tardía), ritmo del cristal y turnos del TDMA.

`tools/gen_fixtures.py` convierte los JSON en un header al compilar: si cambia el formato en TypeScript (`fixtures:update`), los tests del firmware fallan hasta que el C cambie igual.

## Cableado del DK

Banco antes de la placa: DK nRF52840 (PCA10056) con un breakout del LC29H, un Ai-Thinker Ra-01SH, la placa de evaluación de la LSM6DSV32X y un breakout de W25N02KV (con uno de W25N04KV, cambiar `blocks` y `jedec-device-id` en el overlay). Todo en los headers del DK (los nombres Arduino están serigrafiados). **Los niveles**: el LC29H es de 2,8 V (traductor 3,3 V ↔ 2,8 V en TXD, RXD y 1PPS, como en la v0); el Ra-01SH, la IMU y la W25N andan a 3,3 V.

| Señal | Pin del DK | Header | A dónde va |
|---|---|---|---|
| GNSS RX (del GNSS) | P1.01 | D0 | LC29H TXD, por el traductor |
| GNSS TX (al GNSS) | P1.02 | D1 | LC29H RXD, por el traductor |
| GNSS 1PPS | P1.03 | D2 | LC29H 1PPS, por el traductor |
| GNSS EN | P1.04 | D3 | EN del regulador del breakout (si lo tiene) |
| GNSS RESET | P1.05 | D4 | gate de un NMOS a RESET_N (drenador abierto) |
| GNSS WAKEUP | P1.06 | D5 | WAKEUP (alto de 3,0–3,6 V) |
| LoRa SCK / MISO / MOSI | P1.15 / P1.14 / P1.13 | D13 / D12 / D11 | Ra-01SH SCK / MISO / MOSI |
| LoRa NSS | P1.12 | D10 | Ra-01SH NSS |
| LoRa BUSY | P1.11 | D9 | Ra-01SH BUSY |
| LoRa DIO1 | P1.10 | D8 | Ra-01SH DIO1 |
| LoRa NRST | P0.03 | A0 | Ra-01SH RESET |
| LoRa RXEN | P0.04 | A1 | Ra-01SH RXEN (TXEN unido a DIO2 dentro del módulo) |
| IMU CS | P0.28 | A2 | LSM6DSV32X CS |
| IMU MISO / MOSI / SCK | P0.29 / P0.30 / P0.31 | A3 / A4 / A5 | LSM6DSV32X SDO / SDA / SCL |
| IMU INT1 | P0.02 | AREF | LSM6DSV32X INT1 |
| I2C SDA / SCL | P0.26 / P0.27 | D14 / D15 | BMP581 (0x47), y MAX17048 o BQ25180 si se suman |
| NAND SCK / MOSI | P1.07 / P1.08 | D6 / D7 | W25N CLK / DI |
| NAND MISO | P1.09 | P24 | W25N DO |
| NAND CS | P1.00 | P24 | W25N /CS |
| Hall (chaleco) | P0.11 | Botón 1 | apretado = pod en el chaleco |
| Botón de banco | P0.12 | Botón 2 | — |
| LED rojo / verde / azul | P0.13 / P0.14 / P0.15 | LED 1 / 2 / 3 | LED del DK (PWM0) |

El Ra-01SH y los breakouts se alimentan del VDD del DK (sin load switch: `LORA_EN` no existe en el DK). La NAND del DK (MX25R64 por QSPI) queda sin usar. Los pines del header P24 (P1.00 y P1.09) se confirman con la serigrafía del DK antes de soldar.

## Placa `pod_v0` (rediseño en stock del 09/11/2026)

La placa `app/boards/pod/pod_v0` sigue a [`pod-v0.md`](../docs/hardware/pod-v0.md) ("Pines del nRF52840") y al ADR 0105 ("Registro de decisiones"):

- **u-blox BMD-340** (nRF52840) en lugar del Raytac MDBT50Q: **los mismos P0.x/P1.x** para cada señal, así el `pinctrl` no cambió; solo los números de pad de los comentarios (tabla 2 de la hoja del BMD-340). VCC y VCCH a VREG (modo LV): `&reg1` en DC/DC como antes.
- **Ai-Thinker Ra-01SH** (SX1262) en lugar del E22: nodo `semtech,sx1262` **sin `dio3-tcxo-voltage`** (cristal común, sin TCXO), con `dio2-tx-enable` (dentro del módulo TXEN ya va a DIO2) y `rx-enable-gpios` en P0.30; BUSY en P0.02, DIO1 en P0.29, RESET en P0.31. El corte de la radio es el load switch **TPS22919** por `lora-en-gpios` (P1.01).
- **LSM6DSV32X** en lugar de la LSM6DSV320X: `compatible = "st,lsm6dsv32x"` (binding del NCS v3.4.1, lo maneja el driver `lsm6dsv16x`, que acepta el WHO_AM_I **0x70**), `accel-range = <16>` para la carrera. El segundo canal (fijo en ±32 g) lo va a leer `imu_batch`; que entre en la FIFO a 1,6 kHz o más está **no verificado** (DS13511; [#322](https://github.com/mgiachetti/sport-performance/issues/322)).
- **ADXL372** (`hg_accel`, CS en P0.26, INT1 en P1.03): en el devicetree con `status = "disabled"`; solo las 2 placas de la variante de armado `pod-v0-highg` lo tienen montado. Para esas: `west build -b pod_v0/nrf52840 sport-performance/firmware/app -- -DBOARD_ROOT=. -DEXTRA_DTC_OVERLAY_FILE=boards/pod_v0_highg.overlay` (el overlay solo lo habilita; el CI lo compila en el job de `pod_v0`).
- **Pendiente (otro PR, [#321](https://github.com/mgiachetti/sport-performance/issues/321))**: el código de sensor del log (`IMU_SENSORS` de `packages/pod-protocol`, `lsm6dsv320x` / `icm42688p` / `adxl372`) no tiene un valor para la LSM6DSV32X. Hay que agregar `lsm6dsv32x` al final de la lista (para no mover los códigos que ya existen), regenerar los vectores y `tools/gen_fixtures.py`, antes de que `imu_batch` grabe.

## Qué está hecho y qué es stub

| Módulo | Hecho | Stub / TODO |
|---|---|---|
| `lora_link` (`lib/radio.c`, `app/src/lora_link.c`) | Formato v1 completo: encabezado, carga útil del resumen en vivo (con y sin posiciones), pedido de turno, nonces, AES-CCM de 4 B, apertura de baliza y fragmento RTCM, KDF, regla del contador; probado contra los vectores. Configuración de la radio (SF7, 125 kHz, CR 4/5) y envío de una subida, que se niega sin contador de arranques guardado o con la clave en cero (pod sin aprovisionar) | Plan de canales por `channelPlanId`, recepción de la baliza en su ventana de 120 ms, turnos, contienda, TX en el tick del turno, holdover, registro `radio_tx`, secuencia para cortar el LoRa. Las claves llegan de la base (aprovisionamiento): hasta entonces son cero y no se sella nada |
| `log_nand` (`lib/log.c`, `app/src/log_nand.c`) | Formato v1 completo: los 12 registros, encabezado, IV, CTR, CMAC truncado, CRC-32, escritor con páginas que cruzan registros, rotación de clave, cierre y cierre de recuperación; probado contra las páginas de TypeScript (también el `recovery_close`). La secuencia de página la entrega el módulo de contadores página por página; sin secuencia o con la clave en cero no se sella nada y el tramo se detiene. Comandos de la W25N (reset, JEDEC con el ID del devicetree, lectura a caché, carga y programa, borrado, estado), con la dirección de página de 24 bits de la hoja de Winbond (W25N02KV: 2048 bloques; W25N04KV: 4096) | Tabla de bloques malos (también dentro de los 8 bloques reservados: solo el bloque 0 viene garantizado), estado del ECC por lectura (el 3 es legible, aviso de desgaste: refrescar/reubicar, nunca como el 2), índice de tramos en los bloques reservados, `scanNand` al arrancar, reserva de un bloque, `mayAppend`, buffers del SPIM3 en su bloque de RAM (errata 198), bajo consumo profundo (B9h/ABh) |
| `gnss_lc29h` (`lib/gnss.c`, `app/src/gnss_lc29h.c`) | Checksum y armado de comandos, secuencia de arranque de la AA (pasos 2–4) y de backup como datos, espera de `$PAIR001` / `,OK` con reintento en "ocupado", parsers de `$PQTMPVT` (+ VEL, EPE) a enteros, separador NMEA / RTCM3 con CRC-24Q, UART por interrupciones; un hilo propio es el único que maneja el módulo (el lazo principal solo pide prender o apagar, nunca en la base); la parte que escribe la NVM (`$PAIR513`) corre solo si las consultas no coinciden con la configuración esperada | Orden de los campos de `$PQTMPVT` y formato de las respuestas de las consultas **a confirmar en el banco** (si no coinciden, se escribe la NVM una vez), renegociación a 115200, registro `gnss_pvt` y crudo a 1 Hz en `gnss_raw`, emparejar el PPS con la época, variante EA |
| `power` (`lib/power.c`, `app/src/power.c`) | Máquina de estados (base, activo, espera, System OFF, envío) con la precedencia y las horas de cierre de pod-v0.md, plan de despertares (Hall en el nivel opuesto), plan del BQ25180 (EN_PUSH en 0, watchdog de 15 s, 300 mA), modo envío, lectura del MAX17048, VBUS, servicio del BQ25180 desde el lazo (STAT0 cada 30 s como mucho, y cada 1 s hasta 20 s después de entrar en la base, hasta que VIN_PGOOD lee 1, plan de nuevo si cambia VIN_PGOOD o se reinician los registros), guarda contra el lazo de despertares antes de System OFF | Leer y limpiar el despertar retenido de la IMU antes de dormir, MAX17048 en sleep antes del envío, tiempos de la configuración del club (hoy valores de relleno), pedido de cierre y de envío desde la app |
| `time_base` (`lib/time_base.c`, `app/src/time_base.c`) | RTC2 de 48 bits, captura del PPS por GPIOTE → PPI → TIMER2 y del TICK del RTC, ancla con resolución de 62,5 ns, ritmo del cristal, tick de cada turno; canales de GPIOTE y PPI de los asignadores de nrfx; HFXO pedido mientras el GNSS está prendido | Medir el consumo en el banco, registros `time_anchor` y `sensor_sync`, baliza como fuente bajo techo |
| `sensors` (`app/src/sensors.c`) | LSM6DSV32X (compatible `st,lsm6dsv32x`, driver de la familia LSM6DSV16X, WHO_AM_I 0x70) y BMP581 con los drivers de Zephyr, autotest de presencia, movimiento simple | FIFO en `imu_batch` (dos canales, marcas del sensor), ráfagas de impacto, despertar retenido en INT1, actividad e inactividad, lotes del barómetro |
| `led` (`lib/led.c`, `app/src/led.c`) | Tabla de pod-v0.md con un patrón único por estado, PWM0, atenuación por SYS, código de error del autotest | Modo partido desde la baliza, buzzer |
| `hall` (`app/src/hall.c`) | Lectura del DRV5032FA (o la FB) y SENSE en el nivel opuesto | — |
| `wdt` (`app/src/wdt.c`) | WDT del nRF obligatorio, alimentado en el lazo principal | — |
| Contadores (`lib/counters.c`, `app/src/boot_counter.c`) | Contador de arranques que se confirma recién después de guardarlo (sin eso el pod no transmite ni graba); secuencia de página entregada de a una, reservando de a 1024 antes de usar el bloque, compartida por todos los tramos del arranque; id de tramo; probado con un almacén falso (mismo arranque, más de una reserva, reinicio a mitad, falla al guardar) | Pasar al contador la secuencia más alta que encuentre el escaneo de la NAND (`pod_counters_observe_page_seq`) |

## Firma y MCUboot

- `sysbuild.conf` arma **MCUboot** con imágenes firmadas **ECDSA P-256**, intercambio con prueba y confirmación (swap using move) y vuelta atrás automática ([ADR 0106](../docs/adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), "Arranque seguro").
- **No hay ninguna clave en el repo.** Sin `SB_CONFIG_BOOT_SIGNATURE_KEY_FILE`, el build firma con la **clave de desarrollo pública de MCUboot** (`bootloader/mcuboot/root-ec-p256.pem`): sirve para el banco y el CI, y **nunca se usa para un pod en la cancha** (cualquiera puede firmar con ella).
- Un build de producción pasa `-DSB_CONFIG_POD_RELEASE_BUILD=y '-DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE="<clave fuera del repo>"'` (las comillas son parte del valor: es un string de Kconfig); `sysbuild.cmake` corta el build si la clave es igual (por SHA-256, no por la ruta) a alguna `root-*.pem` de MCUboot, y prende `CONFIG_NRF_APPROTECT_LOCK` en MCUboot y en la aplicación. Dónde vive la clave de producción y quién firma se define con el flujo de producción (B-909).
- **Contra versiones viejas**: MCUboot rechaza una imagen de versión menor (`CONFIG_MCUBOOT_DOWNGRADE_PREVENTION`, en `app/sysbuild/mcuboot.conf`), y además el pod compara la versión del comando de actualización firmado por el servidor (ADR 0106), que queda para la DFU por la base.
- La aplicación **confirma su imagen** (`boot_write_img_confirmed`) recién después de pasar el autotest de arranque: una imagen nueva que falla el autotest vuelve a la anterior en el próximo reinicio.

## Memoria interna y borrado del chip

- La partición de la flash está fijada en el devicetree de `pod_v0` (sin el Partition Manager, `SB_CONFIG_PARTITION_MANAGER=n`): MCUboot, dos slots de 472 KB y la NVS de los contadores en `storage_partition` (0xF8000, 32 KB). **Nunca se mueve** en una actualización: se perderían el contador de arranques y la reserva de secuencias.
- Un **borrado del chip o un recover** (por ejemplo para sacar APPROTECT) borra la NVS: los contadores vuelven a cero y, con las mismas claves, se repetirían nonces de la radio e IV de la NAND. Después de un borrado, el pod **se vuelve a aprovisionar con una época de clave nueva** en la base antes de transmitir o grabar (ADR 0106: recuperar un pod sube la época).
