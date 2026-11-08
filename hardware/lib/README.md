# Librería propia del pod

`pod.kicad_sym` (símbolos), `pod.pretty/` (footprints) y `pod.3dshapes/` (modelos 3D). El proyecto `../pod-v0/` las carga por su `sym-lib-table` y `fp-lib-table`, con rutas relativas a `${KIPRJMOD}`.

**Están vacías.** Los símbolos y footprints no se dibujan a mano a partir de una tabla de pines inventada. Se generan desde la base de LCSC/EasyEDA con [`easyeda2kicad`](https://github.com/uPesy/easyeda2kicad.py), o se toman de las librerías oficiales de KiCad o del fabricante. Correr `generar.sh` (abajo) en una máquina con Python y KiCad.

## Partes y de dónde sale cada una

| Parte | Origen previsto | Número LCSC o fuente | Comando | Verificado contra la hoja |
|---|---|---|---|---|
| Quectel LC29H (AA/EA) | Footprint de Quectel (lo entrega con el Hardware Design) | Sin número LCSC encontrado | — (pedirlo a Quectel o a un distribuidor) | no |
| Ebyte E73-2G4M08S1C | easyeda2kicad | C356849 | `easyeda2kicad --full --lcsc_id=C356849 --output hardware/lib/pod` | no |
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

Los números LCSC salen del relevamiento de `docs/hardware/pod-f3.md` y de `docs/hardware/pod-v0.md`.

## Cómo se generan

`generar.sh` instala `easyeda2kicad` 1.0.1 (versión fijada) en un entorno virtual temporal que borra al terminar, corre los comandos de la tabla desde la raíz del repo y cambia la ruta de cada modelo 3D a `${KIPRJMOD}/../lib/pod.3dshapes`, para que no quede una ruta absoluta de la máquina. Después:

1. Abrir cada footprint en KiCad y **compararlo contra el dibujo de la hoja del fabricante**: pads, paso, numeración, pin 1 y keep-out de antena.
2. Cambiar la columna "Verificado contra la hoja" a **sí** solo después de esa comparación, con la fecha y quién la hizo.
3. Commitear los archivos generados (`pod.kicad_sym`, `pod.pretty/*.kicad_mod`, `pod.3dshapes/*`).
