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
- **El esquemático se genera** desde una netlist declarativa (ver abajo): siete hojas jerárquicas (`power`, `gnss_rf`, `mcu_radio`, `sensors`, `storage`, `usb_dock`, `uwb`) con todas las partes de `docs/hardware/pod-v0.md`, incluidos los lugares de rescate (marcados con el DNP nativo de KiCad). **La placa sigue vacía**: tiene el apilado de 4 capas y un contorno provisorio de 45 × 65 mm, y todavía no se actualizó desde el esquemático.
- El apilado de la placa (prepreg de 0,2 mm, núcleo de 1,065 mm, 1,59 mm en total) es un punto de partida: se ajusta al apilado de impedancia controlada que dé PCBWay (**no verificado**).

## Esquemático generado

`tools/esquematico/` es un generador en Python (solo la biblioteca estándar, Python 3.9 o más nuevo) que escribe las hojas `pod-v0/<hoja>.kicad_sch` y `lib/pod.kicad_sym`:

| Archivo | Qué tiene |
|---|---|
| `diseno.py` | **La netlist**: por hoja, grupos de partes con referencia automática (R101…, R201…), valor, footprint, MPN, LCSC, fabricante, sin montar y la red de cada pin (`NC` = sin conectar) |
| `simbolos.py` | Símbolos genéricos (R, C, L, diodos, cristal, pads de prueba, conectores, MOSFET, fiduciales, agujeros), los de los integrados sin símbolo de easyeda2kicad (dibujados desde la tabla de pines de `pod-v0.md` o de la hoja citada), los de alimentación y el tipo eléctrico de cada pin de los símbolos de easyeda2kicad |
| `modelo.py` | Las clases y atajos de la netlist (`R`, `R0`, `C`, `TP`, `FLAG`…) y los nombres de los footprints oficiales de KiCad que se usan (verificados contra la etiqueta 10.0.8 de `kicad-footprints`) |
| `generar.py` | Valida la netlist (pines sin asignar, redes de un solo pin, rieles sin fuente o con dos), ubica las partes en una grilla por grupos, escribe los archivos y **los vuelve a leer** para verificar la conectividad contra la netlist |

```sh
python3 hardware/tools/esquematico/generar.py          # regenera la librería y las hojas
python3 hardware/tools/esquematico/generar.py --check  # falla si algo quedó desactualizado (lo corre el CI)
```

- **Cada pin termina en un tramo corto de cable** con una etiqueta local, una etiqueta global (si la red cruza hojas), un símbolo de alimentación (`VBUS`, `SYS`, `BAT`, `VREG`, `VCC_GNSS`, `V_BCKP`, `VDD_EXT`, `GND`) o una marca de sin conectar. Los rieles que salen de un 0 Ω, un conector o un load switch llevan `PWR_FLAG`.
- **Campos**: `MPN`, `LCSC`, `Fabricante`, `Nota` y `Verificado` (en "no" en todas las partes hasta compararlas con su hoja).
- **Los UUID salen del contenido**: regenerar sin cambios da los mismos archivos, y el diff de un cambio en `diseno.py` queda acotado.
- **El generador es la fuente de verdad mientras la ubicación y el ruteo no empiecen.** No editar las hojas a mano: el CI falla. Cuando el esquemático se empiece a editar en KiCad, se decide si se deja el generador: si se deja, todo cambio entra por `diseno.py`; si no, se borra `tools/esquematico/`, el paso del CI que corre `--check` y el comentario 3 del rótulo de cada hoja, y desde ahí se edita en KiCad.
- **Después de correr `lib/generar.sh`** (easyeda2kicad reescribe los símbolos con los pines en "unspecified") hay que correr `generar.py`, que les vuelve a poner el tipo eléctrico.

**Partes sin footprint todavía** (el campo queda vacío hasta dibujarlo desde el paquete del fabricante): LC29H (Quectel), TPS22916C (DSBGA-4, tres lugares), TPS259470A (VQFN-10 RPW), ADXL372 (LGA-16), DWM3000 (Qorvo), los 5 pads de la base (patrón con llave a definir con la base), el patch cerámico, la tapa blindada y los SAW y el LNA de la cadena RF (partes por elegir). El TPS63900 usa el WSON-10 genérico de KiCad y el ICM-42688-P el LGA-14 genérico: comparar con el paquete de la hoja.

**Lo que el generador no dibuja**: el puente USB-UART del GNSS (sin montar, sin parte elegida; los 0 Ω de D± quedan montados hacia el nRF), el lugar para una antena chip o SMA de LoRa y el área de la etiqueta (son de la placa).

## Controles y salidas

- **CI** (`.github/workflows/hardware.yml`): en cada PR que toca `hardware/`, corre `generar.py --check`, `kicad-cli sch erc` y `kicad-cli pcb drc` y falla si hay alguna violación (errores o advertencias). Los reportes quedan en el log y, si falla, como artefacto.
- **Salidas de fabricación** (PDF del esquemático, BOM con MPN, LCSC y sin montar, Gerbers, taladros y pick and place para PCBWay), con KiBot desde `hardware/pod-v0/`:

  ```sh
  kibot -c kibot.yaml -e pod-v0.kicad_sch -b pod-v0.kicad_pcb -d salidas
  ```

  Van a `salidas/`, que está en `.gitignore`: **no se commitean**. La configuración de KiBot todavía no se probó.
