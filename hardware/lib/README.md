# Librería propia del pod

`pod.kicad_sym` (símbolos), `pod.pretty/` (footprints) y `pod.3dshapes/` (modelos 3D). El proyecto `../pod-v0/` las carga por su `sym-lib-table` y `fp-lib-table`, con rutas relativas a `${KIPRJMOD}`.

Los símbolos y footprints no se dibujan a mano a partir de una tabla de pines inventada. Se generan desde la base de LCSC/EasyEDA con [`easyeda2kicad`](https://github.com/uPesy/easyeda2kicad.py), o se toman de las librerías oficiales de KiCad o del fabricante.

**Generada el 2026-11-08** con `generar.sh` (easyeda2kicad 1.0.1): 10 partes con símbolo, footprint y modelo 3D, ninguna verificada todavía contra su hoja, y 7 modelos 3D solos para los footprints dibujados desde la hoja (ver más abajo).

| Parte | Footprint generado | Pads | A revisar en especial |
|---|---|---|---|
| MDBT50Q-P1MV2 (C5119772) | `COMM-SMD_MDBT50Q-1MV2` | 61 | **EasyEDA usa el footprint de la -1MV2 (antena chip) para la -P1MV2 (antena PCB).** Los pads coinciden en número, pero el keep-out de la antena es distinto: compararlo con la sección 2.3 de la hoja de Raytac y dibujarlo a mano en el footprint. |
| XL-1615RGBC-RF (C965840) | `LED-ARRAY-SMD_4P-L1.6-W1.5-BR_XL-1615RGBC-RF` | 4 | Ánodo común y orden R/G/B de los pines. |
| E22-900M22S (C411293) | `WIRELM-SMD_E22-900M22S` | 22 | Numeración contra la tabla de Ebyte (6 RXEN, 7 TXEN, 21 ANT…). |
| LSM6DSV320X (C26633007) | `LGA-14_L3.0-W2.5-P0.50-TL` | 14 | Orientación (el modelo 3D se llama L2.5-W3.0) y pin 1. |
| BMP581 (C5362283) | `LGA-10_L2.0-W2.0-P0.50-TL_BMP581` | 10 | Pin 1 y que el agujero de presión quede del lado correcto. |
| DPS368 (C3232508, sin montar) | `LGA-8_L2.5-W2.0-P0.65-TR_DPS368` | 8 | — |
| W25N02KVZEIR (C3010298) | `WSON-8_L8.0-W6.0-P1.27-TL-EP-1` | 9 | Pad expuesto y que la W25N04KV use el mismo. |
| BQ25180 (C3682423) | `DSBGA-8_L1.6-W0.9-R2-C4-P0.40-BL` | 8 | Mapa de bolas contra la hoja de TI (A1 /INT … D2 GND). |
| MAX17048G+T10 (C2682616) | `TDFN-8_L2.0-W2.0-P0.50-BL-EP1.2` | 9 | Pad expuesto. |
| DRV5032FBDBZR (C2655033) | `SOT-23_L2.9-W1.3-P1.90-LS2.4-BR` | 3 | — |

## Footprints dibujados desde la hoja (issue 278)

`../tools/footprints_hoja.py` escribe estos footprints desde el land pattern recomendado de la hoja del fabricante (las medidas y la página están en el código). Los modelos 3D son los de LCSC/EasyEDA (`generar.sh` los baja solos, sin el footprint). Antes se buscaron en las librerías oficiales de KiCad 10.0.8 y en LCSC/EasyEDA: donde EasyEDA tenía uno, se comparó pad por pad con la hoja y la diferencia se anota. **Ninguno está verificado en KiCad todavía** ("dibujado desde la hoja, verificar").

| Parte | Footprint | Fuente (pública, sin cuenta) | Por qué no el de EasyEDA o el oficial | Verificado |
|---|---|---|---|---|
| Quectel LC29H (AA y EA, C22403415 / C28453488) | `Quectel_LC29H_LCC-24_12.2x16.0mm_P1.1mm` | [Hardware Design V1.3](https://forums.quectel.com/uploads/short-url/u7fE3GaEAynRmZ3J7ihhjXrwxTF.pdf), sección 5.3, figura 19 (p.47) y figura 20 (p.52): pads de 2,5 × 0,8 mm centrados en el borde, paso 1,1, hueco de 3 mm entre 7/8 y 17/18, área segura de 15,1 × 16,3 mm; la misma medida para toda la serie | EasyEDA (`GPSM-SMD_24P-L16.0-W12.2-P1.10-TL`) tiene los centros bien, pero pads de 1,8 mm y el courtyard del cuerpo. La librería oficial no tiene la LC29H | no |
| Qorvo DWM3000 (sin montar, C5299931) | `Qorvo_DWM3000` | [Hoja Rev B](https://farnell.com/datasheets/4509027.pdf), figuras 13 y 14 (p.21-22) y sección 6.1, figura 10 (p.19); la fila de abajo a 2,30 mm del pin 8 según el [land pattern del foro de Qorvo](https://forum.qorvo.com/uploads/default/original/2X/d/deee4cc632c63211b3e5565bdfe8852defba2659.png). Lleva el keep-out de la antena (los 9,775 mm por encima del límite de tierra) en todas las capas; Qorvo pide además unos 10 mm sin metal a cada lado, que dependen de dónde se ubique | EasyEDA (`WIRELM-SMD_DWM3000TR13`) tiene la fila 9-16 0,20 mm hacia afuera y ningún keep-out. La librería oficial solo tiene la DWM1000 | no |
| TI TPS22916C (tres lugares, C2680319) | `Texas_YFP0004_DSBGA-4_0.78x0.78mm_Layout2x2_P0.4mm` | [SLVSDO5F](https://www.ti.com/lit/ds/symlink/tps22916.pdf) p.25-26 (4223507/A): bolas de Ø0,23 NSMD, pasta de 0,25 cuadrada | EasyEDA tiene pads de Ø0,18, más chicos que la bola. La librería oficial no tiene el YFP0004 (el PicoStar de 4 bolas es otro paquete) | no |
| TI TPS259470A (C3662799) | `Texas_RPW0010A_VQFN-HR-10_2x2mm_P0.45mm` | [SLVSFC9C](https://www.ti.com/lit/ds/symlink/tps25947.pdf), PDF p.73-74 (4225183/A), con la pasta de TI (82 % en IN/OUT, 93 % en las esquinas) | EasyEDA tiene el brazo de las esquinas 0,05 mm hacia afuera y pasta al 100 %. La librería oficial no tiene el RPW | no |
| TI TPS63900 (C1518762) | `Texas_DSK0010A_WSON-10-1EP_2.5x2.5mm_P0.5mm_EP1.2x2mm_ThermalVias` | [SLVSET3D](https://www.ti.com/lit/ds/symlink/tps63900.pdf), PDF p.38-39 (4218903/C): pads de 0,60 × 0,25 a ±1,15, pad expuesto de 1,2 × 2,0 con 4 vías de Ø0,2 y pasta en dos ventanas | Reemplaza al genérico `Package_SON:WSON-10-1EP_2.5x2.5mm_P0.5mm_EP1.2x2mm` (pads 0,225 mm más largos, sin vías). EasyEDA estaba más cerca, pero sin vías | no |
| Analog Devices ADXL372 (sin montar, C579465) | `Analog_CC-16-4_LGA-16_3.25x3mm_P0.5mm` | Hoja Rev. B, figura 54 (p.55) y figura 55 (p.56), copia pública enlazada desde [LCSC C579465](https://www.lcsc.com/product-detail/C579465.html) (analog.com no respondió) | EasyEDA tiene los pads laterales 0,24 mm hacia afuera: cubren solo el 61 % del pad del paquete | no |
| Qualcomm RF360 B39162B8389P810 (SAW L1 + L5, candidato, C5556161) | `Qualcomm_B39162B8389P810_1.4x1.1mm` | [Hoja](https://datasheet.lcsc.com/datasheet/pdf/eab07ffddc7092a73be1e657f827b881.pdf) p.5, figura 2: cinco pads de 0,30 × 0,375 (la vista "thru" ya está numerada como la superior: no se espeja) | EasyEDA usa el tamaño del terminal (0,25 × 0,325), no el del land | no |
| Infineon BGA525N6 (LNA L1/L2/L5, candidato, C18337445) | `Infineon_PG-TSNP-6-10_1.1x0.7mm_P0.4mm` | [Hoja v1.2](https://www.infineon.com/dgdl/Infineon-BGA525N6-DataSheet-v01_01-EN.pdf?fileId=8ac78c8c872bd8d6018775bb1e8d010e), figura 4 (PDF p.13): pads de 0,25, pasta de Ø0,25; la abertura de máscara de 0,35 se midió en la figura | EasyEDA usa el tamaño del terminal (0,20) | no |
| Taoglas GVLB208.A (patch L1 + L5, candidato, sin LCSC) | `Taoglas_GVLB208.A_20x20mm` | [Hoja](https://www.taoglas.com/datasheets/GVLB208.A.pdf), secciones 3 (p.6) y 4.3 (p.10): agujero de Ø1,0, pad de Ø1,2 arriba y de Ø2,2 abajo, despeje de Ø3,0 (arriba y capas internas) y de Ø3,5 (abajo). La dirección del pin (1,2 mm del centro, hacia el lado opuesto a la esquina chaflanada) se leyó del dibujo | No hay footprint público. **No es plano** (8,8 mm) y pide 70 × 70 mm de tierra: no se encontró un patch L1 + L5 de 4 mm o menos que ande en L5 | no |
| Pads de la base (diseño propio) | `Pod_Dock_Pads_5P_D2.0mm_P3.0mm_Keyed` | Diseño propio desde `docs/hardware/pod-v0.md` ("Conexión externa") y `pod-mecanica-produccion.md`: 5 pads dorados de Ø2,0 mm sin pasta, paso de 3,0 mm, en el orden VBUS, GND, D+, D−, DETECT (GND entre VBUS y el par). **Llave**: la fila queda 4 mm por debajo del eje de dos imanes de Ø5 mm a ±11 mm, de polaridad opuesta (marcados en Cmts.User); girado 180°, los resortes caen 8 mm afuera de los pads y los imanes se repelen. Fuera de la BOM y del pick and place | — | no (medidas a confirmar con la base) |

Además:

- **ICM-42688-P**: queda el genérico oficial `Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y`. Sus centros coinciden con el paquete de DS-000347 rev. 1.2 (p.54-55: ±1,1625 y ±0,9125), con la numeración y el pin 1 de la hoja. La hoja no trae land pattern (remite a la nota AN-IVS-0002A-00, que no se consiguió). El de EasyEDA (C1850418) es el mismo archivo que el del LSM6DSV320X y está peor centrado.
- **Tapa blindada**: Würth WE-SHC 36103205S (20 × 20 × 3 mm, marco y tapa, LCSC C7386558) con el footprint oficial `RF_Shielding:Wuerth_36103205_20x20mm`; si la cadena RF no entra, la 36103255 de 25 × 25 mm (oficial `Wuerth_36103255_25x25mm`). Van las 3610 (SMD), no las 3650 (THT).
- **Pines revisados de paso** (con las mismas hojas): el pin 7 (RESV) del ICM-42688-P va a GND según la tabla 9; el ADXL372 coincide con la tabla 5 de la hoja Rev. B; los pines 3 (AUXOFF), 4 (FLT) y 10 (ITIMER) del TPS259470A quedan sin conectar a propósito (drenador abierto y respuesta más rápida); en la LC29H(EA) los pines 2 y 4 son reservados y solo hay UART1 (el footprint es el mismo).
- **SAW y LNA**: el SAW (5 pads: 1 IN, 4 OUT, 2/3/5 GND) y el LNA (6 pines: 1 GND, 2 VCC, 3 AO, 4 CTRL2, 5 AI, 6 CTRL1; CTRL1 y CTRL2 altos = bajo consumo) reemplazan a los símbolos genéricos. Faltan las bobinas de adaptación de la hoja (5,1 nH en el SAW, 10–12 nH y 1 nF en el LNA).

**Lo que falta y dónde conseguirlo (fuentes con cuenta, no usadas):** los archivos oficiales de Quectel `LC29H(AA,AI,BA,CA,DA,EA,TI)_Footprint&Part_V1.4` y `2D_Dimensions_V1.3` y el Hardware Design V1.4 (zona de descargas de quectel.com, con login); el paquete de diseño de la DWM3000 en qorvo.com (la página respondió 429; antes estaba en decawave.com); la nota AN-IVS-0002A-00 de TDK; SnapEDA, Ultra Librarian y SamacSys para comparar los footprints dibujados. Cuando se tengan, se comparan con los dibujados.

**Antes de rutear, además de la tabla:** el courtyard de cada footprint es el contorno del cuerpo y en algunos (por ejemplo el LSM6DSV320X, con pads a ±1,60 mm contra un borde de ±1,50) queda más chico que los pads: agrandarlo. easyeda2kicad deja todos los pines con tipo eléctrico "unspecified": el generador del esquemático (`../tools/esquematico/generar.py`) les pone el tipo (`simbolos.EASYEDA_PIN_TYPES`) para que el ERC sirva, así que después de `generar.sh` hay que correrlo. El tamaño de las bolas del BQ25180 (0,184 mm) se compara con el land pattern recomendado de TI. Los footprints están en el formato de KiCad 5; `kicad-cli fp upgrade` los pasa al actual.

Los modelos 3D (`.wrl` y `.step`, unos 17 MB) se commitean: los `.step` hacen falta para la envolvente mecánica en CAD.

## Símbolos que agrega el generador

Además de las 10 partes de easyeda2kicad, `pod.kicad_sym` tiene los símbolos que escribe `../tools/esquematico/simbolos.py` (llevan el campo `Generador`):

- **Genéricos**: R, C, L, D, D_TVS, D_ESD, cristal, puente de soldadura, pulsador, buzzer, pad de prueba, antena, tapa blindada, fiducial, agujero, MOSFET N y P (SOT-23: 1 G, 2 S, 3 D), U.FL, conectores (batería, 4 pines, pads de la base, TC2030-NL) y los de alimentación con `PWR_FLAG`. Los pasivos de dos pines están dibujados horizontales, con el pin 1 a la izquierda.
- **Integrados y módulos**, con la fuente de su tabla de pines:

| Símbolo | Tabla de pines | Verificado |
|---|---|---|
| LC29H | Hardware Design V1.0 de Quectel, tabla 5 (copiada en `docs/hardware/pod-v0.md`) | Sí, según esa versión |
| TPS63900 | Hoja de TI SLVSET3D, tabla 5-1 (DSK) | Sí (leída de la hoja) |
| TPS259470 | Hoja de TI SLVSFC9C, tabla 5-1 (RPW) | Sí (leída de la hoja) |
| TPS7A20_DBV, TPS7A02_DBV | Hojas de TI, tablas de pines del SOT-23-5 (1 IN, 2 GND, 3 EN, 4 NC, 5 OUT) | Sí (leída de la hoja) |
| TPS22916 | Hoja de TI SLVSDO5F, tabla 5-1 (YFP) | Sí (leída de la hoja) |
| SN74LVC1T45 | Hoja de TI SCES515N, tabla 4-1 | Sí (leída de la hoja) |
| USBLC6-2SC6 | Numeración del símbolo oficial de KiCad (`Power_Protection:USBLC6-2P6`) | No contra la hoja de ST |
| DWM3000 | Símbolo oficial de KiCad `RF_Module:DWM3000` (extiende DWM1000); el pin 5 cambia entre los dos | **No** |
| ICM-42688-P | DS-000347 rev. 1.2, tabla 9 (pin 7 RESV a GND) | Sí (leída de la hoja) |
| ADXL372 | Hoja Rev. B, tabla 5 (coincide con lo supuesto) | Sí (leída de la hoja) |
| B39162B8389P810, BGA525N6 | Hojas de Qualcomm RF360 (p.5) y de Infineon (v1.2): candidatos de la cadena RF | Sí (leídas de la hoja), parte por confirmar |

## Partes y de dónde sale cada una

| Parte | Origen previsto | Número LCSC o fuente | Comando | Verificado contra la hoja |
|---|---|---|---|---|
| Quectel LC29H (AA/EA) | Footprint dibujado desde el Hardware Design V1.3 (ver arriba); modelo 3D de EasyEDA | C22403415 (AA), C28453488 (EA) | `easyeda2kicad --3d --lcsc_id=C22403415 --output hardware/lib/pod` | no |
| Raytac MDBT50Q-P1MV2 (nRF52840) | easyeda2kicad | C5119772 (JLC; la -1MV2 es C5118826) | `easyeda2kicad --full --lcsc_id=C5119772 --output hardware/lib/pod` | no |
| XINGLIGHT XL-1615RGBC-RF (LED RGB) | easyeda2kicad | C965840 | `easyeda2kicad --full --lcsc_id=C965840 --output hardware/lib/pod` | no |
| Ebyte E22-900M22S | easyeda2kicad | C411293 | `easyeda2kicad --full --lcsc_id=C411293 --output hardware/lib/pod` | no |
| ST LSM6DSV320X | easyeda2kicad | C26633007 | `easyeda2kicad --full --lcsc_id=C26633007 --output hardware/lib/pod` | no |
| Bosch BMP581 | easyeda2kicad | C5362283 | `easyeda2kicad --full --lcsc_id=C5362283 --output hardware/lib/pod` | no |
| Infineon DPS368 (sin montar) | easyeda2kicad | C3232508 | `easyeda2kicad --full --lcsc_id=C3232508 --output hardware/lib/pod` | no |
| Winbond W25N02KVZEIR | easyeda2kicad | C3010298 | `easyeda2kicad --full --lcsc_id=C3010298 --output hardware/lib/pod` | no |
| Winbond W25N04KV | Mismo footprint WSON-8 de 8 × 6 mm que el W25N02KV | Número LCSC no encontrado | — | no |
| TI BQ25180 | easyeda2kicad | C3682423 | `easyeda2kicad --full --lcsc_id=C3682423 --output hardware/lib/pod` | no |
| Analog Devices MAX17048G+T10 | easyeda2kicad | C2682616 | `easyeda2kicad --full --lcsc_id=C2682616 --output hardware/lib/pod` | no |
| Taoglas AGVLB.25B.07.0060A | No lleva footprint: es una antena con cable que entra por un U.FL | [DigiKey](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) | — | no |
| U.FL (Hirose U.FL-R-SMT-1) | Librería oficial de KiCad: `Connector_Coaxial:U.FL_Hirose_U.FL-R-SMT-1_Vertical` y el símbolo `Connector:Conn_Coaxial` | Librería oficial | — | no |
| Qorvo DWM3000 (sin montar) | Footprint dibujado desde la hoja Rev B (ver arriba); sin modelo 3D público | C5299931 (DWM3000TR13) | — | no |
| TI TPS22916C (load switch del GNSS, del E22 y de la NAND sin montar) | Footprint dibujado desde SLVSDO5F (ver arriba); modelo 3D de EasyEDA. Si PCBWay no arma un DSBGA de 0,4 mm, una alternativa con patas en SOT-23 (TPS22917 o TPS22918, **no verificadas**) | C2680319 | `easyeda2kicad --3d --lcsc_id=C2680319 --output hardware/lib/pod` | no |
| TI TPS259470A | Footprint dibujado desde SLVSFC9C (ver arriba); modelo 3D de EasyEDA | C3662799 | `easyeda2kicad --3d --lcsc_id=C3662799 --output hardware/lib/pod` | no |
| TI TPS63900 | Footprint dibujado desde SLVSET3D (ver arriba); modelo 3D de EasyEDA | C1518762 | `easyeda2kicad --3d --lcsc_id=C1518762 --output hardware/lib/pod` | no |
| Analog Devices ADXL372 (sin montar) | Footprint dibujado desde la hoja Rev. B (ver arriba); modelo 3D de EasyEDA | C579465 (ADXL372BCCZ-RL7) | `easyeda2kicad --3d --lcsc_id=C579465 --output hardware/lib/pod` | no |
| TDK ICM-42688-P (sin montar) | Librería oficial de KiCad: `Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y` | C1850418 | — | no |
| Qualcomm RF360 B39162B8389P810 (SAW, candidato, sin montar) | Footprint dibujado desde la hoja (ver arriba); modelo 3D de EasyEDA | C5556161 | `easyeda2kicad --3d --lcsc_id=C5556161 --output hardware/lib/pod` | no |
| Infineon BGA525N6 (LNA, candidato, sin montar) | Footprint dibujado desde la hoja (ver arriba); modelo 3D de EasyEDA | C18337445 | `easyeda2kicad --3d --lcsc_id=C18337445 --output hardware/lib/pod` | no |
| Taoglas GVLB208.A (patch, candidato, sin montar) | Footprint dibujado desde la hoja (ver arriba); sin modelo 3D | Sin número LCSC | — | no |
| Würth 36103205S (tapa blindada, sin montar) | Librería oficial de KiCad: `RF_Shielding:Wuerth_36103205_20x20mm` | C7386558 | — | no |
| TI DRV5032FB (Hall del chaleco, montado) | easyeda2kicad | C2655033 (DRV5032FBDBZR, SOT-23) | — | no |

Los números LCSC salen del relevamiento de `docs/hardware/pod-f3.md` y de `docs/hardware/pod-v0.md`.

## Cómo se generan

`generar.sh` instala `easyeda2kicad` 1.0.1 (versión fijada) en un entorno virtual temporal que borra al terminar, corre los comandos de la tabla desde la raíz del repo (`--full` para las 10 partes de arriba, `--3d` para los modelos de los footprints dibujados desde la hoja) y cambia la ruta de cada modelo 3D a `${KIPRJMOD}/../lib/pod.3dshapes`, para que no quede una ruta absoluta de la máquina. Después:

1. Abrir cada footprint en KiCad y **compararlo contra el dibujo de la hoja del fabricante**: pads, paso, numeración, pin 1 y keep-out de antena.
2. Cambiar la columna "Verificado contra la hoja" a **sí** solo después de esa comparación, con la fecha y quién la hizo.
3. Commitear los archivos generados (`pod.kicad_sym`, `pod.pretty/*.kicad_mod`, `pod.3dshapes/*`).
