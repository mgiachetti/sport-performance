# 0109. Firmware del pod: Zephyr sobre el nRF Connect SDK, workspace de west en el repo, biblioteca portable con tests de host contra los vectores de TypeScript y CI en la imagen oficial

- Estado: Aceptado
- Fecha: 2026-11-08
- Issue: #273 (B-904)

## Contexto

El [ADR 0105](0105-pod-gnss-imu-con-telemetria-en-vivo.md) eligió el nRF52840 (en un Raytac MDBT50Q en la v0, [`pod-v0.md`](../hardware/pod-v0.md)) en parte por los drivers de Zephyr para el SX126x, la IMU y el barómetro, y el [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md) pidió MCUboot con imágenes firmadas, NVS para los contadores y AES en el CryptoCell-310. `firmware/README.md` decía que la toolchain "se define cuando arranque la Fase 3". Los formatos de la radio y del log ya existen en `packages/pod-protocol` con archivos de ejemplo pensados para que el firmware en C pruebe que codifica igual. Faltaba decidir el SDK, cómo se arma el workspace dentro de un monorepo de TypeScript, cómo se prueba sin hardware y cómo corre en el CI.

## Decisión

- **Zephyr sobre el nRF Connect SDK** (NCS) en una versión fijada (`firmware/west.yml`: v3.4.1, la última de la rama 3.4 con más de dos semanas al arrancar), con sysbuild: MCUboot y la aplicación. NCS y no Zephyr solo: trae `nrf_security` (PSA Crypto sobre el CryptoCell-310 con Oberon de respaldo), el MCUboot de Nordic y el soporte del nRF52840 que se usa en producción.
- **El repo es el repositorio del manifiesto de west** (topología T2) con el manifiesto en `firmware/west.yml` (`west init -l sport-performance --mf firmware/west.yml`): el workspace es la carpeta que contiene el repo y los proyectos del NCS quedan al lado, nunca dentro del monorepo. El manifiesto importa el NCS con una `name-allowlist` de los proyectos que usa el pod, así `west update` baja poco.
- **Dos placas desde el día uno**: `nrf52840dk/nrf52840` con un overlay para el banco (breakouts del LC29H, E22, LSM6DSV320X y W25N en los headers del DK, cableado en `firmware/README.md`) y la placa propia `pod_v0/nrf52840` en `firmware/app/boards/pod/pod_v0`, con un devicetree que tiene todos los pines de `pod-v0.md`, la UICR (`nfct-pins-as-gpios`, `gpio-as-nreset`) y el cristal de 32,768 kHz. La placa propia se encuentra con `-DBOARD_ROOT=.` (relativo a la aplicación), que sysbuild propaga a MCUboot: sin un `zephyr/module.yml` en la raíz del monorepo.
- **Biblioteca portable en `firmware/lib`**, C sin Zephyr: los formatos (radio, log, GNSS) y las decisiones puras (máquina de energía, patrones del LED, base de tiempo, plan del BQ25180) con una interfaz de crypto de dos implementaciones: **PSA** en el pod y una **referencia en C** solo para los tests. La aplicación (`firmware/app/src`) es el pegamento con Zephyr, un archivo por módulo.
- **Tests de host en C plano con CMake** (`firmware/tests/host`, con AddressSanitizer y UBSan), no ztest en `native_sim`: corren en cualquier compu sin el NCS. Un script de Python sin dependencias convierte los JSON de `packages/pod-protocol/fixtures/v1` en un header al compilar, y los tests comparan byte a byte cada paquete, cada registro y cada página del log con lo que genera TypeScript. Si el formato cambia en TypeScript, el firmware falla en el mismo PR.
- **La implementación PSA se prueba en el arranque**: el autotest de arranque (`crypto_selftest.c`) corre los mismos vectores (RFC 3610, RFC 4493, SP 800-38A, RFC 5869 y un paquete de los vectores) en el pod y en los tests de host; si falla, el LED muestra el código y el pod no graba ni transmite.
- **Driver propio de la W25N** sobre la API de SPI (binding `winbond,w25n04kv`), no el de flash genérico: el formato necesita el estado del ECC por página y la marca de bloque malo.
- **CI** (`.github/workflows/firmware.yml`, solo si cambia `firmware/**` o los archivos de ejemplo): tests de host en el runner y build de las dos placas en un contenedor con la **imagen oficial de Nordic** `ghcr.io/nrfconnect/sdk-nrf-toolchain` de la misma versión, **fijada por digest**, con las acciones fijadas por SHA, permisos de solo lectura y sin secretos. Las imágenes del CI quedan como artefactos de 7 días.
- **Firma**: MCUboot con ECDSA P-256 e intercambio con prueba y confirmación. **Ninguna clave en el repo**; los builds de desarrollo y del CI firman con la clave pública de desarrollo de MCUboot, que nunca va a un pod de la cancha, y un build de producción (`SB_CONFIG_POD_RELEASE_BUILD`) se corta si la clave sigue siendo esa.

## Consecuencias

- El firmware se compila y se prueba en cada PR que lo toca sin instalar nada: los formatos ya están atados a TypeScript y los módulos de hardware compilan para las dos placas.
- Lo que depende del banco (orden de los campos de `$PQTMPVT`, dirección de página de la W25N04KV, TCXO del E22, consumos, canales de GPIOTE y PPI con el BLE) queda como `TODO(B-904)` en el código y en la tabla de `firmware/README.md`.
- Subir la versión del NCS es cambiar `firmware/west.yml` y el digest de la imagen en el workflow en el mismo PR.
- El build en el CI baja el NCS (con caché por el hash del manifiesto) y tarda más que el resto de los checks; por eso corre solo cuando cambia el firmware y no es parte del check `ci` requerido, como el de `hardware/`.
