# Hardware

Proyectos de KiCad del pod GNSS + IMU (Fase 3). El diseño está en [`docs/hardware/pod-v0.md`](../docs/hardware/pod-v0.md) y las decisiones en el [ADR 0105](../docs/adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md).

| Carpeta | Qué hay |
|---|---|
| `pod-v0/` | Proyecto de la v0 (B-909): esquemático jerárquico, placa de 4 capas con su apilado, clases de red (`pod-v0.kicad_pro`), reglas de diseño (`pod-v0.kicad_dru`) y salidas de KiBot (`kibot.yaml`) |
| `lib/` | Librería propia: símbolos, footprints y modelos 3D de los módulos (ver [`lib/README.md`](lib/README.md)) |

## Versión de KiCad

- Los archivos se crearon en el formato de KiCad 8, que abren KiCad 8, 9 y 10. Al guardarlos con una versión más nueva, se actualizan a su formato: a partir de ahí hay que usar esa versión o una posterior.
- El CI usa la imagen oficial `kicad/kicad:10.0.8`, fijada por digest en `.github/workflows/hardware.yml`. Lee los archivos de cualquiera de esas versiones.

## Cómo se trabaja

- **Ubicación y ruteo, a mano en KiCad**, en especial la RF: línea de 50 Ω, plano de tierra del patch GNSS (la antena principal: patch pasivo apilado L1 + L5 en la placa, con SAW y LNA montados; la Taoglas activa va por U.FL como rescate), separación de LoRa.
- **Claude Code** se encarga de:
  - generar y revisar los símbolos y footprints de los módulos a partir de las hojas;
  - correr ERC y DRC;
  - preparar las salidas de fabricación;
  - revisar cada cambio del esquemático o de la placa en el PR, contra `docs/hardware/pod-v0.md`.
- **El esquemático se genera** desde una netlist declarativa (ver abajo): siete hojas jerárquicas (`power`, `gnss_rf`, `mcu_radio`, `sensors`, `storage`, `usb_dock`, `uwb`) con todas las partes de `docs/hardware/pod-v0.md`, incluidos los lugares de rescate (marcados con el DNP nativo de KiCad). **La placa sigue vacía**: tiene el apilado de 4 capas, un contorno provisorio de 45 × 65 mm, las reglas de diseño y las zonas de las antenas (ver "Reglas de diseño de la placa"), y todavía no se actualizó desde el esquemático.

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

**Footprints**: todas las partes tienen uno (issue 278). Los que no venían bien de easyeda2kicad ni existen en las librerías oficiales de KiCad (LC29H, DWM3000, TPS22916C, TPS259470A, TPS63900, ADXL372, el SAW y el LNA de la cadena RF, el patch y los pads de la base) se dibujan con `tools/footprints_hoja.py` desde el land pattern de la hoja del fabricante (cada uno cita documento, página y figura en el código y en `lib/README.md`); el ICM-42688-P sigue con el LGA-14 genérico de KiCad, que coincide con el paquete de la hoja, y la tapa blindada usa el footprint oficial de Würth. `generar.py` falla si un pin de una parte no tiene pad en su footprint de `lib/pod.pretty`. Ninguno está verificado en KiCad todavía.

```sh
python3 hardware/tools/footprints_hoja.py          # reescribe los footprints dibujados desde la hoja
python3 hardware/tools/footprints_hoja.py --check  # falla si alguno quedó desactualizado (lo corre el CI)
```

**Lo que el generador no dibuja**: el lugar para una antena chip o SMA de LoRa y el área de la etiqueta (son de la placa). El puente USB-UART del GNSS salió del diseño: para hablar con QGNSS está el conector de 4 pines.

## Reglas de diseño de la placa

Lo que pide `docs/hardware/pod-v0.md` ("Reglas de diseño") escrito en el proyecto de KiCad, para que lo entiendan el ruteo a mano y un autorouter (Quilter lee las clases de red, las redes de impedancia controlada, los pares diferenciales y los keep-out de KiCad). Todo lo marcado **no verificado** se confirma con PCBWay antes de pedir.

### Apilado (`pod-v0.kicad_pcb`, Board Setup → Physical Stackup)

4 capas de 1,6 mm en FR4, impedancia controlada activada (`dielectric_constraints yes`). Es el apilado estándar de 4 capas que suelen ofrecer los fabricantes (prepreg 7628): **no verificado** contra el de PCBWay.

| Capa | Uso | Espesor |
|---|---|---|
| L1 `F.Cu` | Señales y RF | 35 µm (1 oz terminado) |
| Prepreg 7628 | εr 4,4 | 0,2 mm |
| L2 `In1.Cu` | Tierra continua, sin cortes debajo de la RF ni de las señales rápidas | 17,5 µm |
| Núcleo | εr 4,6 | 1,065 mm |
| L3 `In2.Cu` | Alimentación y señales lentas | 17,5 µm |
| Prepreg 7628 | εr 4,4 | 0,2 mm |
| L4 `B.Cu` | Señales y tierra | 35 µm |

### Impedancia

`python3 hardware/tools/impedancia.py` imprime los valores y un barrido, sin máscara y con una estimación de la máscara (20 µm, εr 3,5, como una capa plana por capacitancias parciales; en la ranura la máscara es más gruesa, así que la baja real es probablemente algo mayor). Son fórmulas cuasiestáticas y los modelos difieren entre sí en unos ohm: **la geometría final y el εr salen del SI9000 de PCBWay** con su apilado, y recién ahí se congelan la clase y la regla.

| Línea | Geometría en L1, referida a L2 | Resultado | Modelo |
|---|---|---|---|
| **RF_50**: coplanar con tierra (CPWG), GNSS L1/L5 (1575/1176 MHz) y LoRa (915 MHz) | pista de **0,33 mm**, separación a la tierra de L1 de **0,20 mm** | 52,3 Ω sin máscara, unos 51 Ω con la máscara (estimación) | Mapeo conforme de Ghione y Naldi con la corrección por espesor de Wadell, el modelo de la calculadora de KiCad ("Coplanar wave guide with ground plane"); **no comparado** todavía contra esa calculadora |
| **USB_90D**: microstrip acoplada, D+ y D− | pista de **0,25 mm**, separación entre pistas de **0,15 mm** | 88,9 Ω | Hammerstad y Jensen para Z0, IPC-2141A para el par |

El objetivo sin máscara es de 52–53 Ω a propósito, para que con la máscara quede cerca de 50 Ω (0,35 mm daba 50,6 Ω sin máscara y unos 49,7 Ω con ella). La regla de ancho acepta de 0,31 a 0,35 mm mientras PCBWay no confirme. El nRF52840 es USB de velocidad completa (12 Mbit/s): los 90 Ω son buena práctica, no un requisito duro. El BLE y el UWB no tienen línea: los módulos traen su antena.

**A confirmar con PCBWay** (calculadora de impedancia o su ingeniería, al pedir con impedancia controlada): materiales, εr y espesores reales del apilado; ancho y separación de la CPWG de 50 Ω con la máscara; el par de 90 Ω; la tolerancia (±10 % es lo habitual); el cobre de las capas internas (17,5 µm, que fija el ancho de POWER_DOCK en L2/L3); los mínimos de la sección siguiente. Con los valores de PCBWay se corrigen el apilado, las clases y `pod-v0.kicad_dru`, y `impedancia.py` se ajusta a esos números.

### Clases de red (`pod-v0.kicad_pro`, Board Setup → Net Classes)

Asignadas por patrón sobre el nombre de la red (`*NOMBRE`, para que valgan con o sin la ruta de hoja `/gnss_rf/…`). Los nombres salen de `tools/esquematico/diseno.py`; cada red cae en una sola clase. D+ y D− se llaman `USB_D_P`/`USB_D_N` (y `DOCK_D_P`/`DOCK_D_N` del lado de la base) para que KiCad los reconozca como par diferencial (sufijos `_P`/`_N`).

| Clase | Redes | Pista / separación | Por qué |
|---|---|---|---|
| `RF_50` | `GNSS_ANT`, `GNSS_ANT_UFL`, `GNSS_ANT_PATCH`, `GNSS_RF_*` (A a E, LNA e IN), `GNSS_LNA_IN`, `GNSS_LNA_OUT`, `LORA_ANT`, `LORA_RF` | 0,33 / 0,50 mm | CPWG de 50 Ω. La separación de la clase (0,5 mm) es la de las otras redes; contra GND la fija una regla propia en 0,20 mm (la ranura coplanar) |
| `USB_90D` | `USB_D_P`/`USB_D_N`, `DOCK_D_P`/`DOCK_D_N` | 0,25 mm, par a 0,15 mm; vía 0,5/0,2 | Par de 90 Ω |
| `POWER_DOCK` | `VBUS`, `VBUS_PAD`, `SYS`, `BAT` | 0,5 / 0,20 mm | Hasta 1 A desde la base: el switch de entrada limita a 0,85–1,15 A (R_ILM de 3,32 kΩ). Para 10 °C de aumento, IPC-2221 da 0,30 mm en una capa externa de 35 µm y 1,5 mm en una interna de 17,5 µm; IPC-2152, que cuenta los planos cercanos, da cerca de 1,0 mm en la interna. Los 1,5 mm en capas internas son una política de ruteo con margen, no el mínimo térmico |
| `POWER` | `VREG`, `VREG_BB`, `VREG_LORA`, `VCC_LORA`, `VCC_GNSS`, `VGNSS_LDO`, `VGNSS_SW`, `V_BCKP`, `V_BCKP_LDO`, `VDD_EXT`, `VCC_NAND`, `VCC_UWB`, `UWB_VDD1` | 0,3 / 0,15 mm | VREG con un pico de unos 250 mA: 0,23 mm en una capa interna según IPC-2221 |
| `SW_NODE` | `BB_LX1`, `BB_LX2` (inductor del TPS63900) | 0,4 / 0,20 mm | Nodo de conmutación: corto, ancho, lejos de la RF |
| `GNSS_SENSITIVE` | `GNSS_PPS`, `GNSS_PPS_28`, `GNSS_TX`/`GNSS_TXD`/`GNSS_TXD_T`, `GNSS_RX`/`GNSS_RXD`/`GNSS_RXD_T`, `GNSS_VDD_RF`, `GNSS_BIAS`, `GNSS_BIAS_L`, `XL1`, `XL2` | 0,2 / 0,30 mm | PPS y UART del GNSS, alimentación de la antena y el cristal de 32,768 kHz |
| `Default` | El resto, incluida `GND` | 0,2 / 0,15 mm; vía 0,6/0,3 | — |

Mínimos de la placa (Board Setup → Constraints, todos **no verificados** contra PCBWay): separación 0,1 mm, pista 0,1 mm, vía 0,45 mm con agujero de 0,2 mm y anillo de 0,15 mm (la vía chica que cumple todo es 0,5/0,2), agujero a agujero 0,25 mm, cobre al borde 0,3 mm. Anchos predefinidos: 0,2, 0,25, 0,3, 0,33, 0,4, 0,5 y 1,5 mm; vías de 0,5/0,2 y 0,6/0,3; par de 0,25/0,15 mm.

### Reglas propias (`pod-v0.kicad_dru`)

- **L2 solo GND**, en toda la placa: en `In1.Cu` no puede haber pistas ni zonas de otras redes (las vías lo cruzan con su antipad).
- **RF_50**: ancho entre 0,31 y 0,35 mm en L1, prohibida en L2, L3 y L4, sin vías propias (**salvo `GNSS_ANT_PATCH`**: la alimentación del patch sale por L4 desde el pad de Ø2,2 mm del pin, porque la cerámica tapa L1, y sube a L1 por una vía de RF; debajo de ese tramo, L3 en GND y vías de GND alrededor, a mano), separación a GND de al menos 0,20 mm y a pistas, vías y zonas de otras redes de al menos 0,5 mm (lo mismo que la clase).
- **Entre pads**: un pad de RF_50 o GNSS_SENSITIVE contra otro pad usa el mínimo de Default (0,15 mm), para que el 0 Ω entre dos tramos de RF, el bias-T o los pines de un SOT-23 no choquen con los 0,5 y 0,3 mm de las clases. KiCad no tiene una condición confiable de "mismo componente", así que vale para cualquier par de pads: dos pads de componentes distintos se revisan a ojo. Contra GND sigue valiendo 0,20 mm; si el footprint de un SAW trae los pads más cerca de su tierra, se le pone una separación local en el footprint.
- **USB_90D**: pista de 0,23 a 0,27 mm, separación del par de 0,14 a 0,2 mm, hasta 5 mm sin acoplar (la entrada a los pads de la base y al ESD) y diferencia de largo de 0,5 mm como máximo.
- **POWER_DOCK** en L2 o L3: al menos 1,5 mm (mejor por L1/L4 o con una zona).
- **SW_NODE** a 5 mm o más de RF_50 y GNSS_SENSITIVE, y fuera de las tres zonas de antena (criterio propio; ajustarlo con la ubicación).
- **GNSS_SENSITIVE** a 0,3 mm o más de pistas, vías y zonas de otras redes (salvo GND), y fuera de la zona de LoRa.
- **Zona GNSS_ANTENA**: en L1 solo GND y RF (L2 ya es solo GND en toda la placa). Como las vías pasan por L1, **adentro solo hay vías de GND** (y la de RF del patch): una señal de L3 o L4 puede pasar por debajo, pero sin cambiar de capa ahí. Ningún componente en la cara de arriba salvo el patch en la placa (`AE201`, montado); abajo sí se puede.
- **Zona PATCH_FEED** (rule area solo en `In2.Cu`, sobre el tramo de L4 de la alimentación del patch y su vía): en L3 solo GND, sin pistas ni zonas de otras redes. Ahí L3 es una isla de GND maciza, cosida a L2 con vías de GND, que es la referencia del tramo de L4. Provisoria: se mueve con el patch.
- **Despejes del pin del patch** (keep-outs del footprint `Taoglas_GVLB208.A_20x20mm`, sección 4.3 de la hoja): Ø3,0 mm en L1, L2 y L3 sin relleno, pistas ni vías; Ø3,5 mm en L4 sin relleno ni vías. En L4 se dejan pasar pistas porque ahí sale la alimentación del patch y un keep-out de KiCad no filtra por red: que ninguna otra red entre en ese círculo lo cuida la regla "RF_50: otras redes lejos" (0,5 mm del pad de Ø2,2, unos 1,6 mm del centro) y la revisión a mano.
- **Mínimos de PCBWay**: los mismos de antes, salvo la separación mínima, que pasó al Board Setup. En KiCad una regla propia gana sobre las clases de red, y una regla de separación sin condición pisaba los 0,20 mm de RF_50; el mínimo del Board Setup, en cambio, es un piso.

El **cerco de vías** de la RF (vías de GND a los dos lados cada 2 mm o menos, cada 1 mm cerca del UWB) y la **costura de tierra** entre L1 y L2 no se pueden escribir como regla: se dibujan a mano (o con la herramienta de cerco de vías de KiCad 9+). **La zona de GND de L1 tiene que quedar a exactamente 0,20 mm de la RF**: el relleno usa la separación que resuelven las reglas para ese par, que es la regla "RF_50: separación coplanar a GND" (0,20 mm, gana sobre los 0,5 mm de la clase). La separación propia de la zona va en 0,20 mm o menos para no agrandar la ranura. La prueba del CI lo comprueba con una pista de GND a 0,20 mm.

### Zonas con nombre (rule areas, provisorias)

En el contorno provisorio de 45 × 65 mm (origen arriba a la izquierda en 100, 100; arriba queda la nuca y el GNSS). **Son lugares, no ubicaciones**: se mueven con la ubicación real y con la envolvente mecánica, manteniendo los nombres porque las reglas los usan.

| Zona | Dónde | Tamaño | Qué impone |
|---|---|---|---|
| `BLE_ANTENA` | Borde izquierdo, debajo de la zona GNSS | 3,5 × 11 mm, contra el borde | Keep-out nativo en las 4 capas: sin pistas, vías, pads ni zonas. Es la antena PCB del MDBT50Q-P1MV2 con la punta hacia afuera, según la sección 2.3 de la hoja de Raytac: **las medidas no están verificadas** (salen de una figura de la hoja). En el footprint de EasyEDA (el de la -1MV2) los primeros pads empiezan a 3,8 mm del extremo de la antena (borde del courtyard), así que con el módulo al ras del borde un keep-out de 5 mm los tapaba: va de 3,5 mm. Si Raytac pide más profundidad, el módulo no puede ir al ras: se corre hacia adentro o el keep-out se recorta con la hoja |
| `GNSS_ANTENA` | Arriba, centrada | 30 × 30 mm | El patch pasivo en la placa: 25 × 25 mm (el más grande de los candidatos; el GVLB208.A es de 20 × 20) más 2,5 mm por lado. Era de 35 × 35 mm por la carcasa de la Taoglas, que ahora va por U.FL fuera de la placa. Reglas propias de arriba |
| `PATCH_FEED` | Dentro de `GNSS_ANTENA`, sobre la alimentación del patch (solo `In2.Cu`) | 16 × 4 mm | L3 solo GND debajo del tramo de L4 (regla propia de arriba) |
| `LORA_ANTENA` | Abajo a la derecha, en el borde opuesto | 20 × 15 mm | Salida de RF del E22, pasabajos y U.FL; sin GNSS_SENSITIVE ni SW_NODE. La FPC va pegada en la carcasa |

Las zonas `GNSS_ANTENA` y `LORA_ANTENA` quedan a unos 19 mm borde a borde en la placa. Los ≥ 40 mm de `pod-v0.md` son entre las antenas (el patch o la Taoglas y la FPC pegada en la carcasa), no entre estas zonas: se verifican con la envolvente mecánica. Falta el keep-out de la antena del DWM3000 (sin montar, borde derecho): se agrega con su footprint.

### Ubicación a mano y autorouter

1. **A mano y bloqueado** (Lock en KiCad; que Quilter tome lo bloqueado como fijo está **no verificado**): el contorno, las tres zonas de antena, el patch en su zona, el MDBT50Q en su borde, la LC29H con toda la cadena RF y su LDO, el E22 con el pasabajos y el U.FL, el U.FL del GNSS, la tapa blindada, los pads de la base, los agujeros de herramienta, los fiduciales y el Tag-Connect.
2. **Rutear a mano y bloquear antes de usar el autorouter**: las pistas de RF_50 con su cerco de vías, la zona de GND de L1 alrededor de la RF y el plano de GND de L2 (sin cortes), el nodo SW_NODE del buck-boost y el cristal.
3. **El autorouter rutea el resto** con las clases, los pares y las zonas: USB_90D como par diferencial, POWER_DOCK y POWER con sus anchos, GNSS_SENSITIVE con su separación. Revisar después que no haya cortado la tierra de L2 debajo de la RF y que el DRC siga en cero.
4. Si el autorouter no lee las reglas propias de `pod-v0.kicad_dru` (solo las clases y los keep-out nativos; **no verificado** para Quilter), el DRC de KiCad sobre su resultado es el control: se corre igual en el CI.

Las reglas propias y el keep-out del BLE se prueban en el CI con `tools/sonda_drc.py` (ver "Controles y salidas"). **El DRC del CI todavía no compara la placa con el esquemático** (`--schematic-parity`): se agrega cuando la placa tenga los footprints.

## Controles y salidas

- **CI** (`.github/workflows/hardware.yml`): en cada PR que toca `hardware/`, corre `generar.py --check`, `footprints_hoja.py --check`, exporta cada footprint de `lib/pod.pretty` con `kicad-cli fp export svg` (falla si alguno no carga), `kicad-cli sch erc` y `kicad-cli pcb drc` y falla si hay alguna violación (errores o advertencias). Después corre la **prueba de las reglas propias** (`tools/sonda_drc.py`): kicad-cli ignora sin avisar una regla de `pod-v0.kicad_dru` que no se lee, así que arma dos placas de prueba con el proyecto, las reglas y las zonas del pod: una con un objeto que rompe cada regla a propósito, que falla si el reporte no nombra cada una, y un control negativo que cumple todo (CPWG de 0,33 mm con GND a 0,20 mm, otra red a 0,6 mm, el par USB con su geometría, SYS de 1,5 mm en L3, pads de RF a 0,4 mm entre sí, una vía de GND y el patch en la zona GNSS, la alimentación del patch por L4 con su vía de RF y una zona de GND en L3 debajo, un componente abajo; en la placa mala, además, una pista de VREG en L3 debajo de la alimentación del patch y la alimentación del patch en L3, que tiene que seguir prohibida), que falla si tiene alguna violación de reglas. El DRC de las pruebas corre con `--all-track-errors` (sin eso KiCad informa un solo error por pista). Al agregar una regla, se agregan sus dos casos ahí. Los reportes quedan en el log y, si falla, como artefacto.
- **Salidas de fabricación** (PDF del esquemático, BOM con MPN, LCSC y sin montar, Gerbers, taladros y pick and place para PCBWay), con KiBot desde `hardware/pod-v0/`:

  ```sh
  kibot -c kibot.yaml -e pod-v0.kicad_sch -b pod-v0.kicad_pcb -d salidas
  ```

  Van a `salidas/`, que está en `.gitignore`: **no se commitean**. La configuración de KiBot todavía no se probó.
- **Notas de fabricación para PCBWay** (van con el pedido; también en `pod-v0/kibot.yaml` y en `docs/hardware/pod-mecanica-produccion.md`, sección 9):
  - **Pads de la base** (`Pod_Dock_Pads_5P_D2.0mm_P3.0mm_Keyed`): **oro duro electrolítico selectivo de ≥ 0,5 µm** solo en esos 5 pads; el resto, el acabado normal.
  - **Patch GVLB208.A**: de un pin por agujero metalizado de Ø1,0 mm, se suelda abajo después del SMT; lo compran afuera de LCSC.
  - Impedancia controlada de RF_50 y USB_90D con su apilado (ver arriba).
