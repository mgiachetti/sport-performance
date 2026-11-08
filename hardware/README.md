# Hardware

Proyectos de KiCad del pod GNSS + IMU (Fase 3). El diseño está en [`docs/hardware/pod-v0.md`](../docs/hardware/pod-v0.md) y las decisiones en el [ADR 0105](../docs/adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md).

| Carpeta | Qué hay |
|---|---|
| `pod-v0/` | Proyecto de la v0 (B-909): esquemático jerárquico, placa de 4 capas, reglas de PCBWay (`pod-v0.kicad_dru`) y salidas de KiBot (`kibot.yaml`) |
| `lib/` | Librería propia: símbolos, footprints y modelos 3D de los módulos (ver [`lib/README.md`](lib/README.md)) |

## Versión de KiCad

- Los archivos se crearon en el formato de KiCad 8, que abren KiCad 8, 9 y 10. Al guardarlos con una versión más nueva, se actualizan a su formato: a partir de ahí hay que usar esa versión o una posterior.
- El CI usa la imagen oficial `kicad/kicad:10.0.8`, fijada por digest en `.github/workflows/hardware.yml`. Lee los archivos de cualquiera de esas versiones.

## Cómo se trabaja

- **Ubicación y ruteo, a mano en KiCad**, en especial la RF: línea de 50 Ω, plano de tierra del patch GNSS, separación de LoRa.
- **Claude Code** se encarga de:
  - generar y revisar los símbolos y footprints de los módulos a partir de las hojas;
  - correr ERC y DRC;
  - preparar las salidas de fabricación;
  - revisar cada cambio del esquemático o de la placa en el PR, contra `docs/hardware/pod-v0.md`.
- **El esquemático está vacío**: hojas jerárquicas con su título (`power`, `gnss_rf`, `mcu_radio`, `sensors`, `storage`, `usb_dock`, `uwb`). La placa tiene el apilado de 4 capas y un contorno provisorio de 45 × 65 mm.
- El apilado de la placa (prepreg de 0,2 mm, núcleo de 1,065 mm, 1,59 mm en total) es un punto de partida: se ajusta al apilado de impedancia controlada que dé PCBWay (**no verificado**).

## Controles y salidas

- **CI** (`.github/workflows/hardware.yml`): en cada PR que toca `hardware/`, corre `kicad-cli sch erc` y `kicad-cli pcb drc` y falla si hay alguna violación. Los reportes quedan en el log y, si falla, como artefacto.
- **Salidas de fabricación** (PDF del esquemático, BOM con MPN, LCSC y sin montar, Gerbers, taladros y pick and place para PCBWay), con KiBot desde `hardware/pod-v0/`:

  ```sh
  kibot -c kibot.yaml -e pod-v0.kicad_sch -b pod-v0.kicad_pcb -d salidas
  ```

  Van a `salidas/`, que está en `.gitignore`: **no se commitean**. La configuración de KiBot todavía no se probó (el proyecto no tiene componentes).
