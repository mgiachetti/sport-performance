# Hardware

Proyectos de KiCad del pod GNSS + IMU (Fase 3). El diseño está en [`docs/hardware/pod-v0.md`](../docs/hardware/pod-v0.md) y las decisiones en el [ADR 0105](../docs/adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md).

| Carpeta | Qué hay |
|---|---|
| `pod-v0/` | Proyecto de la v0 (B-909): esquemático jerárquico, placa de 4 capas con su apilado, clases de red (`pod-v0.kicad_pro`), reglas de diseño (`pod-v0.kicad_dru`) y salidas de KiBot (`kibot.yaml`) |
| `lib/` | Librería propia: símbolos, footprints y modelos 3D de los módulos (ver [`lib/README.md`](lib/README.md)) |

## Versión de KiCad

- Los archivos se crearon en el formato de KiCad 8, que abren KiCad 8, 9 y 10. Al guardarlos con una versión más nueva, se actualizan a su formato: a partir de ahí hay que usar esa versión o una posterior. **La placa (`pod-v0.kicad_pcb`) ya está en el formato de KiCad 10** desde el 14/11/2026 (contorno, tornillos y zonas guardados con el pcbnew 10.0.8 de la imagen del CI): se abre con KiCad 10 o posterior. El esquemático sigue en el de KiCad 8.
- El CI usa la imagen oficial `kicad/kicad:10.0.8`, fijada por digest en `.github/workflows/hardware.yml`. Lee los archivos de cualquiera de esas versiones.

## Cómo se trabaja

- **Ubicación y ruteo, a mano en KiCad** desde el arranque de `ubicar.py` y `rutear.py` (15/11/2026), en especial la RF: línea de 50 Ω, plano de tierra del patch GNSS (la antena principal: patch pasivo apilado L1 + L5 en la placa, con SAW y LNA montados; la Taoglas activa va por U.FL como rescate), separación de LoRa.
- **Claude Code** se encarga de:
  - generar y revisar los símbolos y footprints de los módulos a partir de las hojas;
  - correr ERC y DRC;
  - preparar las salidas de fabricación;
  - revisar cada cambio del esquemático o de la placa en el PR, contra `docs/hardware/pod-v0.md`.
- **El esquemático se genera** desde una netlist declarativa (ver abajo): siete hojas jerárquicas (`power`, `gnss_rf`, `mcu_radio`, `sensors`, `storage`, `usb_dock`, `uwb`) con todas las partes de `docs/hardware/pod-v0.md`, incluidos los lugares de rescate (marcados con el DNP nativo de KiCad). **La placa tiene todas las partes ubicadas y está ruteada en parte desde el 16/11/2026** (las redes críticas completas; quedan 55 redes de señal y potencia para terminar a mano) (ver "Ubicación inicial" y "Ruteo"), además del apilado de 4 capas, el contorno de 50 × 70 mm, las reglas de diseño y las zonas de las antenas (ver "Reglas de diseño de la placa").

## Ubicación inicial (`tools/ubicar.py`)

Las partes entraron a la placa el 15/11/2026 con `tools/ubicar.py`, una herramienta **de una sola vez** (bootstrap): desde ahí **la ubicación y el ruteo siguen a mano en KiCad** y la fuente es la placa, no la tabla. Corre dentro de la imagen de KiCad del CI (usa el módulo `pcbnew` y `kicad-cli`):

```sh
docker run --rm -e HOME=/tmp -v "$PWD:/work" -w /work kicad/kicad:10.0.8@sha256:3f4a… python3 hardware/tools/ubicar.py
```

1. Exporta la netlist del esquemático con `kicad-cli sch export netlist` (lo mismo que lee "Tools → Update PCB from Schematic").
2. Agrega cada footprint que falta con lo que escribe la actualización desde el esquemático: referencia, valor, los campos del símbolo (MPN, LCSC, Fabricante, Verificado, Nota), el camino de la hoja (así una actualización posterior desde KiCad y `--schematic-parity` los reconocen), DNP, si va a la BOM y la red de cada pad. Los pines sin conectar quedan en redes `unconnected-(…)`, como las crea KiCad.
3. Ubica cada parte según [`tools/datos/ubicacion_pod_v0.csv`](tools/datos/ubicacion_pod_v0.csv) (`ref`, `x`, `y` en mm del documento, origen (0; 0) = (100; 100) en KiCad; `rot` como la muestra KiCad; `cara` F o B; `fijo` = bloqueado; `nota`), pone las referencias en 0,8 mm en un lugar libre al lado de cada parte (o las oculta en la serigrafía si no hay; siguen en F.Fab/B.Fab), rellena las zonas y guarda. No rutea nada. No toca `pod-v0.kicad_pro` (guardar desde Python lo reescribe entero).

Por defecto **solo agrega y ubica las partes que faltan** (por ejemplo, después de sumar una parte en `diseno.py`) y no mueve ni retoca las que ya están: sobre la placa del repositorio no cambia nada (verificado: correrla de nuevo deja el archivo igual). `--reubicar-todo` vuelve a poner cada parte en su lugar de la tabla, bloqueadas incluidas, y no corre si la placa ya tiene pistas o vías. Todas las partes del esquemático van en la placa: la tapa blindada `SH201`, la única que había quedado afuera ("excluir de la placa"), salió del diseño el 15/11/2026 (`docs/hardware/pod-v0-ubicacion-y-carcasa.md`, sección 9). La prueba de ruteo que respalda la ubicación está en la misma sección.

## Ruteo (`tools/rutear.py`)

La placa se ruteó el 15 y 16/11/2026 por script, **en parte**: las redes críticas completas y la mayoría del resto; 147 conexiones en 55 redes quedan para rutear a mano (lista y corredores sugeridos en [`pod-v0-ubicacion-y-carcasa.md`](../docs/hardware/pod-v0-ubicacion-y-carcasa.md), sección 9, "Ruteo"). Como `ubicar.py`, es un procedimiento **de una sola vez**: desde ahí la fuente es la placa y los cambios siguen a mano en KiCad (las pistas de `criticas` quedan bloqueadas). **No hay que volver a correrlo sobre la placa**: los retoques de la revisión del 16/11/2026 (vías de GND y de VREG, pistas sacadas de L3, vías movidas fuera de los pads; sección 9 de `pod-v0-ubicacion-y-carcasa.md`) se hicieron sobre la placa ruteada y `rutear.py` no los reproduce. Cada paso corre en la imagen de KiCad del CI, sobre la placa ubicada y sin pistas:

```sh
K="docker run --rm -e HOME=/tmp -v $PWD:/work -w /work kicad/kicad:10.0.8@sha256:3f4a…"
$K python3 hardware/tools/rutear.py criticas   # 1. pasivas movidas y redes críticas, bloqueadas
$K python3 hardware/tools/rutear.py resto      # 2. todo lo demás salvo GND (tools/laberinto.py)
$K python3 hardware/tools/rutear.py planos --sin-grilla  # 3. planos, costura y vías de GND y VREG; rellena
$K python3 hardware/tools/rutear.py podar      # 4. saca lo que el DRC marca del router y el cobre colgado
```

1. **`criticas`** mueve las pasivas de `MOVES` (cada una con su motivo; la tabla de ubicación las anota) y rutea por script, bloqueado: las dos cadenas de RF (CPWG de 0,33 mm en L1, la alimentación del patch por L4 con su vía de RF) con su cerco de vías de GND, el control y la alimentación del LNA, el par USB (L4, vías en x ≥ 14,5), el abanico del BMD-340 (las dos filas de arriba por L1 a dos filas de vías arriba del módulo; el resto con una vía en el pad, rellena y tapada), el cristal, VBUS del resorte al TVS, el eFuse, el BMD-340 y el cargador, BAT y SYS alrededor del cargador con el sensado de la celda del MAX17048 en su propia pista desde el pad de `J101`, el buck-boost (nodo de conmutación y lazos de entrada y salida) y DETECT. No corre sobre una placa que ya tiene pistas.
2. **`resto`** rutea las redes que quedan, menos GND, con `tools/laberinto.py`: un router de grilla (0,05 mm, L1, L3 y L4, A* a 45°) que conoce las reglas de `pod-v0.kicad_dru` y las clases (separaciones, anchos, rule areas, cristal, nodo de conmutación, borde, L3 solo de través debajo del par USB entre y = 33 y 55) con negociación de congestión (PathFinder): rutea todo dejando compartir celdas a un costo, y en cada vuelta vuelve a rutear las redes que comparten cobre con un costo más alto (presente e histórico) en esas celdas. Con 8 vueltas no convergió en esta placa (unas 90 redes seguían compartiendo, unos 8 minutos por vuelta): al final saca lo compartido, lo vuelve a intentar solo por lugar libre y lo que no entra queda como ratsnest. Pistas de 0,15 mm (Default y GNSS_SENSITIVE), 0,25 mm (POWER) y 0,3 mm solo en L1 y L4 (las ramas de POWER_DOCK); vías de 0,5/0,2 mm.
3. **`planos`**: GND en L1 y L4 sobre toda la placa, GND en L3 en el tercio de arriba y debajo del par USB, VREG en el resto de L3 (la capa de alimentación de `pod-v0.md`); vías de costura de GND a los dos lados de cada pista de RF, a los dos lados del par USB donde L3 deja de ser GND, a lo largo del borde y en una grilla de 2,5 mm (`--sin-grilla` la deja afuera mientras queden redes para rutear a mano: tomaría sus corredores); después, mientras el DRC informe algo de GND sin conectar, una vía al lado de cada pad de GND que los planos no alcanzan y una en cada trozo de plano que no tiene ninguna; y una vía de VREG al plano de L3 al lado de cada pad de VREG que no llega.
4. **`podar`** deja la placa limpia para el DRC mientras haya redes sin terminar: saca las pistas y vías del router (no bloqueadas) que el DRC marca (la grilla del router no modela todo: una vía GNSS_SENSITIVE contra un pad de la otra cara, los 0,2 mm de POWER_DOCK contra pistas de 0,15, la máscara de un fiducial) y las vías de escape y los tramos que quedan colgados en las redes sin terminar, y vuelve a rellenar.

**Freerouting se probó y no alcanzó.** Freerouting 2.5.0 (el `.jar` oficial de [GitHub](https://github.com/freerouting/freerouting/releases/tag/v2.5.0), SHA-256 `f6f51bb0…5de3c7`, con Java 25, sin commitear) por `rutear.py dsn` (exporta con `pcbnew.ExportSpecctraDSN` y reescribe las rule areas, que KiCad exporta como keep-outs completos) y `rutear.py ses` (importa con `pcbnew.ImportSpecctraSES`) quedó en 150 a 190 conexiones sin rutear después de 40 pasadas: no entiende los 0,5 mm de RF_50 alrededor del LNA, las zonas con reglas por capa ni el campo de vías del BMD-340. Los dos pasos quedan en la herramienta para reproducir la prueba:

```sh
$K python3 hardware/tools/rutear.py dsn /work/pod.dsn
docker run --rm -v "$PWD/fr:/fr:ro" -v "$PWD:/w" eclipse-temurin:25-jre \
  java -Xmx1500m -jar /fr/freerouting-2.5.0.jar -de /w/pod.dsn -do /w/pod.ses -mp 40 --gui.enabled=false
$K python3 hardware/tools/rutear.py ses /work/pod.ses
```

El control es el DRC del CI: 0 violaciones y 0 diferencias con el esquemático; mientras queden redes para rutear a mano deja pasar las conexiones sin rutear (cuando se terminen, se agrega `--fallar-sin-rutear` en `.github/workflows/hardware.yml`).

## Esquemático generado

`tools/esquematico/` es un generador en Python (solo la biblioteca estándar, Python 3.9 o más nuevo) que escribe las hojas `pod-v0/<hoja>.kicad_sch` y `lib/pod.kicad_sym`:

| Archivo | Qué tiene |
|---|---|
| `diseno.py` | **La netlist**: por hoja, grupos de partes con referencia automática (R101…, R201…), valor, footprint, MPN, LCSC, fabricante, sin montar y la red de cada pin (`NC` = sin conectar) |
| `simbolos.py` | Símbolos genéricos (R, C, L, diodos, cristal, pads de prueba, conectores, MOSFET, fiduciales, agujeros), los de los integrados sin símbolo de easyeda2kicad (dibujados desde la tabla de pines de `pod-v0.md` o de la hoja citada), los de alimentación y el tipo eléctrico de cada pin de los símbolos de easyeda2kicad |
| `catalogo.py` | La parte que se compra (MPN, fabricante y LCSC) de cada resistencia, capacitor y bobina genérica de la netlist, por valor y footprint; `diseno.py` la aplica al final, así el esquemático y las listas de materiales dicen lo mismo |
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

**Footprints**: todas las partes tienen uno (issue 278). Los que no venían bien de easyeda2kicad ni existen en las librerías oficiales de KiCad (LC29H, BMD-340, DWM3000 (fuera de la v0 desde el 15/11/2026), TPS259470A, TPS63900, ADXL372 (fuera de la v0 desde el 14/11/2026, queda para una v2), el SAW y el LNA de la cadena RF, el patch GVLB258.A, la antena chip LoRa M620720 (desde la imagen de su hoja: a verificar contra el CAD de AVX) y los pads de la base) se dibujan con `tools/footprints_hoja.py` desde el land pattern de la hoja del fabricante (cada uno cita documento, página y figura en el código y en `lib/README.md`); el ICM-42688-P sigue con el LGA-14 genérico de KiCad, que coincide con el paquete de la hoja, y el ESD del par USB (TPD2E2U06) usa el oficial `Package_TO_SOT_SMD:Texas_R-PDSO-N5_DRL-5`. La LC29H sale del footprint oficial de Quectel (Footprint&Part V1.4) por una tabla numérica extraída con `tools/altium_pads.py` y está verificada contra él. `generar.py` falla si un pin de una parte no tiene pad en su footprint de `lib/pod.pretty`. Los demás no están verificados en KiCad todavía.

```sh
python3 hardware/tools/footprints_hoja.py          # reescribe los footprints dibujados desde la hoja
python3 hardware/tools/footprints_hoja.py --check  # falla si alguno quedó desactualizado (lo corre el CI)
```

**Lo que el generador no dibuja**: el área de la etiqueta (es de la placa). La antena chip de LoRa (`AE301`) está en el esquemático desde el 15/11/2026, con su despeje en el footprint y en la zona `LORA_ANTENA` de la placa. El puente USB-UART del GNSS salió del diseño: para hablar con QGNSS está el conector de 4 pines.

## Paquete de cotización

Para pedir a PCBWay (y comparar con JLCPCB) y a los demás proveedores, en [`docs/hardware/cotizacion/`](../docs/hardware/cotizacion/costos.md):

| Archivo | Qué hay |
|---|---|
| [`costos.md`](../docs/hardware/cotizacion/costos.md) | Costo por parte a 5, 10 y 100 placas, placa, armado, envío, NRE y costo por pod |
| [`pedido-pcbway.md`](../docs/hardware/cotizacion/pedido-pcbway.md) | Lo que necesita PCBWay (placa, apilado e impedancia, oro duro, vías en el pad, armado), las preguntas y el mail; la versión corta para JLCPCB |
| [`consultas.md`](../docs/hardware/cotizacion/consultas.md) | Mails para Raytac (ya no hace falta: el MCU es el BMD-340), el proveedor de baterías, ENACOM, el despachante, Quectel y Taoglas |
| `bom-pod-v0.csv`, `bom-pod-v0-sin-montar.csv`, `bom-pod-v0-jlcpcb.csv`, `bom-pod-v0-extras.csv`, `costo-partes-pod-v0.csv` | Listas de materiales (formato de PCBWay y de JLCPCB, montadas y sin montar, lo que no se suelda) y costo por parte, **generadas** |

Las listas las genera `tools/bom_pcbway.py` (biblioteca estándar) desde la netlist y [`tools/datos/partes_pod_v0.csv`](tools/datos/partes_pod_v0.csv), que tiene por MPN el número de LCSC y de DigiKey, el stock por fuente con el plazo y su estado (OK, LIMITADO, SIN STOCK), la alternativa aprobada y las otras, los escalones de precio con su fuente y fecha, si la mandamos nosotros y las instrucciones para el armador. También escribe la tabla de [`stock.md`](../docs/hardware/cotizacion/stock.md):

```sh
python3 hardware/tools/bom_pcbway.py          # reescribe las listas y muestra el costo de partes por placa
python3 hardware/tools/bom_pcbway.py --check  # falla si una parte no tiene datos o una lista quedó vieja (lo corre el CI)
```

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
- **RF_50**: ancho entre 0,31 y 0,35 mm en L1 (y en L4 para la alimentación del patch), prohibida en L2, L3 y L4, sin vías propias (**salvo `GNSS_ANT_PATCH`**: la alimentación del patch sale por L4 desde el pad de Ø2,2 mm del pin, porque la cerámica tapa L1, y sube a L1 por una vía de RF; debajo de ese tramo, L3 en GND y vías de GND alrededor, a mano), separación a GND de al menos 0,20 mm y a pistas, vías y zonas de otras redes de al menos 0,5 mm (lo mismo que la clase).
- **Entre pads**: un pad de RF_50 o GNSS_SENSITIVE contra otro pad usa el mínimo de Default (0,15 mm), para que el 0 Ω entre dos tramos de RF, el bias-T o los pines de un SOT-23 no choquen con los 0,5 y 0,3 mm de las clases. KiCad no tiene una condición confiable de "mismo componente", así que vale para cualquier par de pads: dos pads de componentes distintos se revisan a ojo. Contra GND sigue valiendo 0,20 mm; si el footprint de un SAW trae los pads más cerca de su tierra, se le pone una separación local en el footprint.
- **USB_90D**: pista de 0,23 a 0,27 mm, separación del par de 0,14 a 0,2 mm, hasta 8 mm sin acoplar (la entrada a los resortes de la base, al ESD, a los 0 Ω y a los pads 67 y 68 del BMD-340: unos 6–7 mm en la prueba de ruteo) y diferencia de largo de 4 mm como máximo (desde el 15/11/2026; eran 5 y 0,5 mm). A 12 Mbit/s (83 ns por bit) los 3 mm de diferencia que deja la prueba son unos 20 ps: no hace falta serpentín.
- **POWER_DOCK** en L2 o L3: al menos 1,5 mm (mejor por L1/L4 o con una zona).
- **SW_NODE** a 5 mm o más de RF_50 y GNSS_SENSITIVE, y fuera de las zonas `GNSS_ANTENA`, `LORA_ANTENA` y `BLE_ANTENA` (criterio propio; ajustarlo con la ubicación).
- **GNSS_SENSITIVE** a 0,3 mm o más de pistas, vías y zonas de otras redes (salvo GND). De la zona de LoRa la sacan las reglas de `LORA_ANTENA`.
- **Zona LORA_ANTENA** (despeje de la antena chip M620720, desde el 15/11/2026): la rule area prohíbe vías y rellenos en las 4 capas (también el plano de L2), "LORA_ANTENA: solo la alimentación en L1" no deja entrar más pistas que las de LORA_FEED y LORA_ANT_TUNE, y solo en L1 (ni otra RF, como la del GNSS), y "LORA_ANTENA: solo la antena y sus capacitores" no deja entrar footprints salvo `AE301` (la antena), `C313` (P2) y `C314` (P1), que en la hoja de AVX quedan con un pad sobre el borde del despeje (en las dos caras), y "LORA_ANTENA: sin dibujos ni textos de cobre" no deja ningún dibujo ni texto en una capa de cobre. Las referencias y los nombres de red salen del generador: si cambian, se cambian en las reglas.
- **Zona GNSS_ANTENA**: en L1 solo GND y RF (L2 ya es solo GND en toda la placa). Como las vías pasan por L1, **adentro solo hay vías de GND** (y la de RF del patch): una señal de L3 o L4 puede pasar por debajo, pero sin cambiar de capa ahí. Ningún componente en la cara de arriba salvo el patch en la placa (`AE201`, montado); abajo sí se puede.
- **Zonas L3_GND** (dos rule areas con ese nombre, solo en `In2.Cu`; desde el 22/11/2026, ADR 0105): la franja de la **alimentación del patch** (x de 22 a 28, y de 16 a 33) y la del **par USB** (`DOCK_D_*` desde los resortes, x de 17 a 22,5 e y de 6 a 17,5, y `USB_D_*` por x de 14,5 a 17 hasta y = 33). Ahí L3 es GND macizo cosido a L2, sin pistas ni zonas de otras redes, porque es la referencia de lo que corre por L4: la alimentación del patch lleva la señal antes del LNA. Antes era todo el tercio de arriba (y < 33) y la placa no cerraba en 4 capas; en el resto del tercio de arriba L3 sigue con el plano de GND (`L3_GND_PLANO`), que las señales pueden cortar, y lo demás de L4 (VBUS, el eFuse, señales lentas) se refiere a L2. Hasta el ruteo del 15/11/2026 la franja del par seguía hasta y = 55; de y = 33 hasta los pads del BMD-340 las señales de L3 cruzan por debajo del par, de través, y debajo del par L3 sigue en GND salvo los huecos de los cruces (ver `docs/hardware/pod-v0-ubicacion-y-carcasa.md`, sección 9). A 12 Mbit/s (velocidad completa) L2 sigue siendo un plano macizo a dos capas y la impedancia del par no es crítica. Reemplaza a la franja `PATCH_FEED` de 4 mm (revisión del 14/11/2026).
- **Alimentación del patch por L4**: la regla "RF_50: ancho de 50 ohm en L4" le pide a `GNSS_ANT_PATCH` en `B.Cu` el mismo 0,31–0,35 mm que en L1. L4 se refiere a L3 por el prepreg de 0,2 mm, igual que L1 a L2 (apilado simétrico), así que la CPWG de 0,33/0,20 mm da los mismos 51–52 ohm. A mano: GND coplanar en L4 a los dos lados, vías de GND de L1 a L4 cada 2–3 mm a los dos lados del tramo, al menos 4 vías de GND alrededor del despeje de Ø3,5 mm del pin y 2 a 4 alrededor de la vía de RF (cerca de (25; 31)).
- **Despejes del pin del patch** (keep-outs del footprint `Taoglas_GVLB258.A_25x25mm`, sección 4.3 de SPE-21-8-082-H): Ø3,0 mm en L1, L2 y L3 sin relleno, pistas ni vías; Ø3,5 mm en L4 sin relleno ni vías. En L4 se dejan pasar pistas porque ahí sale la alimentación del patch y un keep-out de KiCad no filtra por red: que ninguna otra red entre en ese círculo lo cuida la regla "RF_50: otras redes lejos" (0,5 mm del pad de Ø2,2, unos 1,6 mm del centro) y la revisión a mano.
- **RF_50 contra los pads del LNA** (15/11/2026, por la prueba de ruteo): el BGA525N6 (`U205`) tiene los pads a 0,4 mm y la entrada y la salida de RF pasan a 0,1 mm de los pads vecinos de control y de VCC (continua); con los 0,5 mm de la clase no se podía entrar al LNA. La regla "RF_50: pistas contra los pads del LNA" baja a 0,1 mm solo para pistas de RF contra pads de `U205` que no son GND (contra GND sigue la coplanar de 0,20 mm).
- **Excepción del buzzer** (15/11/2026): "BZ301: pads mecánicos a 0,2 mm del borde". El buzzer sin montar entra entre `GNSS_ANTENA` y el borde derecho solo con sus dos pads mecánicos (sin red) a 0,2 mm del borde; la regla vale solo para los pads sin red de `BZ301` y todo el resto (también sus pads eléctricos) sigue en 0,3 mm. A confirmar con PCBWay.
- **Mínimos de PCBWay**: los mismos de antes, salvo la separación mínima, que pasó al Board Setup. En KiCad una regla propia gana sobre las clases de red, y una regla de separación sin condición pisaba los 0,20 mm de RF_50; el mínimo del Board Setup, en cambio, es un piso.

El **cerco de vías** de la RF (vías de GND a los dos lados cada 2 mm o menos) y la **costura de tierra** entre L1 y L2 no se pueden escribir como regla: se dibujan a mano (o con la herramienta de cerco de vías de KiCad 9+). **La zona de GND de L1 tiene que quedar a exactamente 0,20 mm de la RF**: el relleno usa la separación que resuelven las reglas para ese par, que es la regla "RF_50: separación coplanar a GND" (0,20 mm, gana sobre los 0,5 mm de la clase). La separación propia de la zona va en 0,20 mm o menos para no agrandar la ranura. La prueba del CI lo comprueba con una pista de GND a 0,20 mm.

### Contorno, tornillos y zonas con nombre (rule areas)

Desde el 14/11/2026 la placa sigue a [`pod-v0-ubicacion-y-carcasa.md`](../docs/hardware/pod-v0-ubicacion-y-carcasa.md) (secciones 3 a 5). Origen del documento (0; 0) = (100; 100) en KiCad, arriba a la izquierda, vista desde el lado del patch; arriba queda la nuca.

- **Contorno de 50 × 70 mm** con esquinas de radio 5 mm y una **muesca cóncava de radio 2,7 mm** en cada esquina, centrada a 2,6 mm de cada borde (pasa el tetón del tornillo de cierre de la carcasa).
- **Tres tornillos M2** de la placa (`H303`, `H304` y `H305`, `MountingHole_2.2mm_M2_Pad_Via`, metalizados a GND y bloqueados) en (6; 8), (44; 8) y (24; 66) (`H305` se corrió 1 mm a la izquierda el 15/11/2026 por el despeje de la antena LoRa). Están en el esquemático (hoja `mcu_radio`, "Fijación de la placa") con el mismo camino, así que actualizar la placa desde el esquemático no los duplica.
- **`L2_GND`**: zona de GND en `In1.Cu` sobre toda la placa (el plano de L2 de la regla "L2 solo GND"), rellena; une los tres tornillos y es la base del plano que se termina de dibujar con la ubicación.

| Zona | Dónde (mm del documento) | Qué impone |
|---|---|---|
| `BLE_ANTENA` | x de 0 a 4,35; y de 47,6 a 62,6 (borde izquierdo, al lado del BMD-340) | Keep-out nativo en las 4 capas: sin pistas, vías, pads ni zonas. Es la antena PCB del **u-blox BMD-340** con el módulo al ras del borde y la antena hacia afuera: el "RF KEEPOUT" de la figura 12 de su hoja (UBX-19033353 R13) va del borde del módulo hasta 3,1 mm del centro (4,40 mm; la zona y el keep-out del footprint paran en 4,35 mm, a 0,05 mm de los pads de GND 1, 45, 46 y 47 del módulo, que caen justo en el borde del rayado), y 2,4 mm más arriba y abajo del módulo (15 mm de alto); el footprint lleva el mismo keep-out (`BMD340_ANTENA`) |
| `GNSS_ANTENA` | x de 10 a 40; y de 2 a 32 (30 × 30, patch centrado en (25; 17)) | El patch pasivo en la placa: el **GVLB258.A** de 25 × 25 mm más 2,5 mm por lado. Reglas propias de arriba |
| `L3_GND` | Dos franjas, solo `In2.Cu` (desde el 22/11/2026): alimentación del patch, x de 22 a 28 e y de 16 a 33; par USB, x de 17 a 22,5 e y de 6 a 17,5 más x de 14,5 a 17 e y de 15 a 33 (antes todo el tercio de arriba, y < 33; hasta el 15/11/2026 también la franja del par hasta y = 55) | L3 solo GND (regla propia de arriba). El pin del patch va **hacia abajo**, en (25; 19,5), 2,5 mm debajo del centro: el footprint con rotación 0 (su origen es el pin y el cuerpo queda 2,5 mm arriba). Así la alimentación sale por L4 el tramo más corto hasta fuera de la cerámica (borde en y = 29,5), sube a L1 por su vía de RF cerca de y = 31 y sigue a la cadena RF (desde y = 35). El par USB va por L4 de punta a punta: hasta y = 33 sobre GND de L3; después, con cruces de L3 por debajo |
| `LORA_ANTENA` | x de 26,7 a 42,7; y de 59,05 a 70 (borde de abajo) | Despeje de la antena chip **M620720** (15/11/2026): los 16,0 × 10,65 mm de la hoja de AVX (TDS-ANT-0048 rev. 4, p.5) más 0,2 mm porque el cobre va a 0,3 mm del borde. Vías y rellenos prohibidos en las 4 capas; solo la alimentación de RF en L1 y los footprints `AE301`, `C313` y `C314` (reglas propias de arriba). El footprint trae el mismo despeje (`M620720_DESPEJE`). Por qué ahí, en `pod-v0-ubicacion-y-carcasa.md`, sección 4 |

`UWB_ANTENA` salió el 15/11/2026 con el DWM3000 (ADR 0105): ese lugar quedó en tierra. Los ≥ 40 mm de `pod-v0.md` son entre las antenas (el patch y la antena chip de LoRa): unos 53 mm entre centros.

### Ubicación a mano y autorouter

La ubicación inicial ya está hecha (15/11/2026, ver arriba) y bloquea los módulos, las antenas con P1 y P2, los resortes, el Tag-Connect y los tornillos; lo que sigue se ajusta a mano sobre ella.

1. **A mano y bloqueado** (Lock en KiCad; que Quilter tome lo bloqueado como fijo está **no verificado**): el contorno, los tornillos, las zonas de antena, el patch en su zona, el BMD-340 en su borde, la LC29H con toda la cadena RF y su LDO, el Ra-01SH con su cadena RF (pasabajos, selector, U.FL de prueba y adaptación), la antena chip de LoRa con P1 y P2, el U.FL del GNSS, los pads de la base, los agujeros de herramienta, los fiduciales y el Tag-Connect.
2. **Rutear a mano y bloquear antes de usar el autorouter**: las pistas de RF_50 con su cerco de vías, la zona de GND de L1 alrededor de la RF y el plano de GND de L2 (sin cortes), el nodo SW_NODE del buck-boost y el cristal.
3. **El autorouter rutea el resto** con las clases, los pares y las zonas: USB_90D como par diferencial, POWER_DOCK y POWER con sus anchos, GNSS_SENSITIVE con su separación. Revisar después que no haya cortado la tierra de L2 debajo de la RF y que el DRC siga en cero.
4. Si el autorouter no lee las reglas propias de `pod-v0.kicad_dru` (solo las clases y los keep-out nativos; **no verificado** para Quilter), el DRC de KiCad sobre su resultado es el control: se corre igual en el CI.

Las reglas propias, el keep-out del BLE y el de vías de `LORA_ANTENA` se prueban en el CI con `tools/sonda_drc.py` (ver "Controles y salidas"). Desde el 15/11/2026 el DRC del CI también compara la placa con el esquemático (`--schematic-parity`).

## Controles y salidas

- **CI** (`.github/workflows/hardware.yml`): en cada PR que toca `hardware/` o `docs/hardware/cotizacion/`, corre `generar.py --check`, `footprints_hoja.py --check`, `bom_pcbway.py --check`, exporta cada footprint de `lib/pod.pretty` con `kicad-cli fp export svg` (falla si alguno no carga), `kicad-cli sch erc` (falla si hay alguna violación, errores o advertencias) y `kicad-cli pcb drc --schematic-parity` en JSON, que lee `tools/drc_placa.py`: falla con cualquier violación (errores o advertencias: separaciones, courtyards, zonas, reglas propias, serigrafía…) o diferencia con el esquemático, y deja pasar las conexiones sin rutear (las de las redes que quedan para rutear a mano), contándolas; cuando la placa esté ruteada entera se agrega `--fallar-sin-rutear` y falla también con ellas. También falla si la comparación con el esquemático no corrió: `kicad-cli` sale con 0 y deja la lista vacía cuando no puede armar la netlist, así que el CI guarda su salida (`drc.log`, con `pipefail`) y el script exige "Found N schematic parity issues" y las tres listas del reporte, porque `kicad-cli` puede salir con 0 sin haberla hecho. Después corre la **prueba de las reglas propias** (`tools/sonda_drc.py`): kicad-cli ignora sin avisar una regla de `pod-v0.kicad_dru` que no se lee, así que arma dos placas de prueba con el proyecto, las reglas y las zonas del pod: una con un objeto que rompe cada regla a propósito, que falla si el reporte no nombra cada una, y un control negativo que cumple todo (CPWG de 0,33 mm con GND a 0,20 mm, otra red a 0,6 mm, el par USB con su geometría, SYS de 1,5 mm en L3, pads de RF a 0,4 mm entre sí, una vía de GND y el patch en la zona GNSS, la alimentación del patch por L4 con su vía de RF y una zona de GND en L3 debajo, un componente abajo; la alimentación de LoRa por L1 dentro de `LORA_ANTENA` con la antena, P1 y P2; en la placa mala, además, una pista de VREG en L3 debajo de la alimentación del patch, la alimentación del patch en L3, que tiene que seguir prohibida, y en `LORA_ANTENA` una pista de otra red en L1, la alimentación en L3, la RF del GNSS en L1, una vía de GND, un dibujo de cobre y un componente que no es de la antena en cada cara, un pad del buzzer a 0,1 mm del borde y una pista de RF a 0,03 mm de un pad de control del LNA (en la de control, a 0,2 y 0,11 mm); en la de control, la antena es el footprint real de la librería, girado 180° como en el pod, con P1 y P2 en sus lugares de la hoja y sus courtyards reales), que falla si tiene alguna violación de reglas. Las placas de prueba salen de la del pod sin sus footprints (solo quedan los tornillos), porque las pruebas caen donde están las partes. El DRC de las pruebas corre con `--all-track-errors` (sin eso KiCad informa un solo error por pista). Al agregar una regla, se agregan sus dos casos ahí. Los reportes quedan en el log y, si falla, como artefacto.
- **Salidas de fabricación** (PDF del esquemático, BOM con MPN, LCSC y sin montar, Gerbers, taladros y pick and place para PCBWay), con KiBot desde `hardware/pod-v0/`:

  ```sh
  kibot -c kibot.yaml -e pod-v0.kicad_sch -b pod-v0.kicad_pcb -d salidas
  ```

  Van a `salidas/`, que está en `.gitignore`: **no se commitean**. La configuración de KiBot todavía no se probó.
- **Notas de fabricación para PCBWay** (van con el pedido; también en `pod-v0/kibot.yaml` y en `docs/hardware/pod-mecanica-produccion.md`, sección 9):
  - **Resortes del inserto de contactos** (`Pod_Insert_Springs_5P_D2.0mm_P3.5mm`, cara de abajo): ENIG como el resto. Desde el 14/11/2026 el oro duro va en los pines del inserto de la tapa inferior, no en la placa: el pedido a PCBWay ya no pide oro duro (debajo de una soldadura, oro duro grueso fragiliza la junta). Sin pasta ni BOM hasta elegir el resorte.
  - **Patch GVLB258.A**: de un pin por agujero metalizado de Ø1,0 mm, se suelda abajo después del SMT; lo compran afuera de LCSC.
  - **Una sola variante de armado**: las 5 placas salen de `bom-pod-v0.csv` (el ADXL372 y la variante `pod-v0-highg` salieron de la v0 el 14/11/2026, ADR 0105).
  - Impedancia controlada de RF_50 y USB_90D con su apilado (ver arriba).
