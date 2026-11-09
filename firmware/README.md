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
│   ├── dts/bindings/         binding de la W25N
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

Banco antes de la placa: DK nRF52840 (PCA10056) con un breakout del LC29H, un E22-900M22S, la placa de evaluación de la LSM6DSV320X y un breakout de W25N. Todo en los headers del DK (los nombres Arduino están serigrafiados). **Los niveles**: el LC29H es de 2,8 V (traductor 3,3 V ↔ 2,8 V en TXD, RXD y 1PPS, como en la v0); el E22, la IMU y la W25N andan a 3,3 V.

| Señal | Pin del DK | Header | A dónde va |
|---|---|---|---|
| GNSS RX (del GNSS) | P1.01 | D0 | LC29H TXD, por el traductor |
| GNSS TX (al GNSS) | P1.02 | D1 | LC29H RXD, por el traductor |
| GNSS 1PPS | P1.03 | D2 | LC29H 1PPS, por el traductor |
| GNSS EN | P1.04 | D3 | EN del regulador del breakout (si lo tiene) |
| GNSS RESET | P1.05 | D4 | gate de un NMOS a RESET_N (drenador abierto) |
| GNSS WAKEUP | P1.06 | D5 | WAKEUP (alto de 3,0–3,6 V) |
| LoRa SCK / MISO / MOSI | P1.15 / P1.14 / P1.13 | D13 / D12 / D11 | E22 SCK / MISO / MOSI |
| LoRa NSS | P1.12 | D10 | E22 NSS |
| LoRa BUSY | P1.11 | D9 | E22 BUSY |
| LoRa DIO1 | P1.10 | D8 | E22 DIO1 |
| LoRa NRST | P0.03 | A0 | E22 NRST |
| LoRa RXEN | P0.04 | A1 | E22 RXEN (TXEN a DIO2, como en la v0) |
| IMU CS | P0.28 | A2 | LSM6DSV320X CS |
| IMU MISO / MOSI / SCK | P0.29 / P0.30 / P0.31 | A3 / A4 / A5 | LSM6DSV320X SDO / SDA / SCL |
| IMU INT1 | P0.02 | AREF | LSM6DSV320X INT1 |
| I2C SDA / SCL | P0.26 / P0.27 | D14 / D15 | BMP581 (0x47), y MAX17048 o BQ25180 si se suman |
| NAND SCK / MOSI | P1.07 / P1.08 | D6 / D7 | W25N CLK / DI |
| NAND MISO | P1.09 | P24 | W25N DO |
| NAND CS | P1.00 | P24 | W25N /CS |
| Hall (chaleco) | P0.11 | Botón 1 | apretado = pod en el chaleco |
| Botón de banco | P0.12 | Botón 2 | — |
| LED rojo / verde / azul | P0.13 / P0.14 / P0.15 | LED 1 / 2 / 3 | LED del DK (PWM0) |

El E22 y los breakouts se alimentan del VDD del DK (sin load switch: `LORA_EN` no existe en el DK). La NAND del DK (MX25R64 por QSPI) queda sin usar. Los pines del header P24 (P1.00 y P1.09) se confirman con la serigrafía del DK antes de soldar.

## Qué está hecho y qué es stub

| Módulo | Hecho | Stub / TODO |
|---|---|---|
| `lora_link` (`lib/radio.c`, `app/src/lora_link.c`) | Formato v1 completo: encabezado, carga útil del resumen en vivo (con y sin posiciones), pedido de turno, nonces, AES-CCM de 4 B, apertura de baliza y fragmento RTCM, KDF, regla del contador; probado contra los vectores. Configuración de la radio (SF7, 125 kHz, CR 4/5) y envío de una subida | Plan de canales por `channelPlanId`, recepción de la baliza en su ventana de 120 ms, turnos, contienda, TX en el tick del turno, holdover, registro `radio_tx`, secuencia para cortar el E22. Las claves llegan de la base (aprovisionamiento): hasta entonces son cero |
| `log_nand` (`lib/log.c`, `app/src/log_nand.c`) | Formato v1 completo: los 12 registros, encabezado, IV, CTR, CMAC truncado, CRC-32, escritor con páginas que cruzan registros, rotación de clave, cierre y cierre de recuperación; probado contra las páginas de TypeScript. Comandos de la W25N (reset, JEDEC, lectura a caché, carga y programa, borrado, estado) | Tabla de bloques malos, estado del ECC por lectura, índice de tramos en los bloques reservados, `scanNand` al arrancar, reserva de un bloque, `mayAppend`, buffers del SPIM3 en su bloque de RAM (errata 198), bajo consumo profundo. Formato de la dirección de página de la W25N04KV **no verificado** |
| `gnss_lc29h` (`lib/gnss.c`, `app/src/gnss_lc29h.c`) | Checksum y armado de comandos, secuencia de arranque de la AA (pasos 2–4) y de backup como datos, espera de `$PAIR001` / `,OK` con reintento en "ocupado", parsers de `$PQTMPVT` (+ VEL, EPE) a enteros, separador NMEA / RTCM3 con CRC-24Q, UART por interrupciones en su hilo | Orden de los campos de `$PQTMPVT` **a confirmar en el banco**, renegociación a 115200, comparar las consultas antes de escribir la NVM, registro `gnss_pvt` y crudo a 1 Hz en `gnss_raw`, emparejar el PPS con la época, variante EA |
| `power` (`lib/power.c`, `app/src/power.c`) | Máquina de estados (base, activo, espera, System OFF, envío) con la precedencia y las horas de cierre de pod-v0.md, plan de despertares (Hall en el nivel opuesto), plan del BQ25180 (EN_PUSH en 0, watchdog de 15 s, 300 mA), modo envío, lectura del MAX17048, VBUS, `sys_poweroff` | Hablarle al BQ25180 dentro de los 15 s de cada VIN, watchdog de 160 s del modo host, MAX17048 en sleep antes del envío, tiempos de la configuración del club (hoy valores de relleno), pedido de cierre y de envío desde la app |
| `time_base` (`lib/time_base.c`, `app/src/time_base.c`) | RTC2 de 48 bits, captura del PPS por GPIOTE → PPI → TIMER2 y del TICK del RTC, ancla con resolución de 62,5 ns, ritmo del cristal, tick de cada turno | Mantener el HFXO prendido, canales de GPIOTE y PPI desde nrfx (hoy fijos por Kconfig), registros `time_anchor` y `sensor_sync`, baliza como fuente bajo techo |
| `sensors` (`app/src/sensors.c`) | LSM6DSV320X y BMP581 con los drivers de Zephyr, autotest de presencia, movimiento simple | FIFO en `imu_batch` (dos canales, marcas del sensor), ráfagas de impacto, despertar retenido en INT1, actividad e inactividad, lotes del barómetro |
| `led` (`lib/led.c`, `app/src/led.c`) | Tabla de pod-v0.md con un patrón único por estado, PWM0, atenuación por SYS, código de error del autotest | Modo partido desde la baliza, buzzer |
| `hall` (`app/src/hall.c`) | Lectura del DRV5032FB y SENSE en el nivel opuesto | — |
| `wdt` (`app/src/wdt.c`) | WDT del nRF obligatorio, alimentado en el lazo principal | — |
| Contadores (`app/src/boot_counter.c`) | Contador de arranques en NVS, subido y guardado antes de transmitir; reserva de secuencias de página de a 1024; id de tramo | Arrancar también por encima de lo que encuentre el escaneo de la NAND |

## Firma y MCUboot

- `sysbuild.conf` arma **MCUboot** con imágenes firmadas **ECDSA P-256**, intercambio con prueba y confirmación (swap using move) y vuelta atrás automática ([ADR 0106](../docs/adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), "Arranque seguro").
- **No hay ninguna clave en el repo.** Sin `SB_CONFIG_BOOT_SIGNATURE_KEY_FILE`, el build firma con la **clave de desarrollo pública de MCUboot** (`bootloader/mcuboot/root-ec-p256.pem`): sirve para el banco y el CI, y **nunca se usa para un pod en la cancha** (cualquiera puede firmar con ella).
- Un build de producción pasa `-DSB_CONFIG_POD_RELEASE_BUILD=y -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE=<clave fuera del repo>`; `sysbuild.cmake` corta el build si la clave sigue siendo la de desarrollo. Dónde vive la clave de producción y quién firma se define con el flujo de producción (B-909).
- Contra versiones viejas, el pod compara la versión del comando de actualización firmado por el servidor (ADR 0106): queda para la DFU por la base.
