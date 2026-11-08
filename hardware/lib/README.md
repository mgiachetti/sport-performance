# Librería propia del pod

`pod.kicad_sym` (símbolos), `pod.pretty/` (footprints) y `pod.3dshapes/` (modelos 3D). El proyecto `../pod-v0/` las carga por su `sym-lib-table` y `fp-lib-table`, con rutas relativas a `${KIPRJMOD}`.

Los símbolos y footprints no se dibujan a mano a partir de una tabla de pines inventada. Se generan desde la base de LCSC/EasyEDA con [`easyeda2kicad`](https://github.com/uPesy/easyeda2kicad.py), o se toman de las librerías oficiales de KiCad o del fabricante.

**Generada el 2026-11-08** con `generar.sh` (easyeda2kicad 1.0.1): 10 partes, ninguna verificada todavía contra su hoja.

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

Los modelos 3D (`.wrl` y `.step`, unos 17 MB) se commitean: los `.step` hacen falta para la envolvente mecánica en CAD.

## Partes y de dónde sale cada una

| Parte | Origen previsto | Número LCSC o fuente | Comando | Verificado contra la hoja |
|---|---|---|---|---|
| Quectel LC29H (AA/EA) | Footprint de Quectel (lo entrega con el Hardware Design) | Sin número LCSC encontrado | — (pedirlo a Quectel o a un distribuidor) | no |
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
| Qorvo DWM3000 (sin montar) | Footprint de Qorvo (paquete de diseño del módulo) | Número LCSC no encontrado | — | no |
| TI TPS22916C (load switch del GNSS, del E22 y de la NAND sin montar) | easyeda2kicad cuando se confirme el número, o la librería oficial de KiCad (DSBGA de 4 bolas; si PCBWay no lo arma, una alternativa con patas en SOT-23, por ejemplo TPS22917 o TPS22918, **no verificadas**) | Número LCSC por buscar | — | no |
| TI DRV5032FB (Hall del chaleco, montado) | easyeda2kicad | C2655033 (DRV5032FBDBZR, SOT-23) | — | no |

Los números LCSC salen del relevamiento de `docs/hardware/pod-f3.md` y de `docs/hardware/pod-v0.md`.

## Cómo se generan

`generar.sh` instala `easyeda2kicad` 1.0.1 (versión fijada) en un entorno virtual temporal que borra al terminar, corre los comandos de la tabla desde la raíz del repo y cambia la ruta de cada modelo 3D a `${KIPRJMOD}/../lib/pod.3dshapes`, para que no quede una ruta absoluta de la máquina. Después:

1. Abrir cada footprint en KiCad y **compararlo contra el dibujo de la hoja del fabricante**: pads, paso, numeración, pin 1 y keep-out de antena.
2. Cambiar la columna "Verificado contra la hoja" a **sí** solo después de esa comparación, con la fecha y quién la hizo.
3. Commitear los archivos generados (`pod.kicad_sym`, `pod.pretty/*.kicad_mod`, `pod.3dshapes/*`).
