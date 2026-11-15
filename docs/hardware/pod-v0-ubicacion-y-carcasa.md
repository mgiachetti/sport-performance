# Pod v0: propuesta de ubicación de partes y carcasa de prueba

**Estado: propuesta del 14/11/2026, con la antena LoRa en la placa y sin el DWM3000 desde el 15/11/2026.** Reúne lo definido en una sesión de trabajo sobre la mecánica del pod v0 (B-909). En KiCad están el contorno, los tornillos y las zonas (sección 4); las partes no están colocadas y nada se imprimió ni se midió: las posiciones de las partes son estimaciones hechas sobre [`pod-v0.md`](pod-v0.md) y [`pod-mecanica-produccion.md`](pod-mecanica-produccion.md), y cada número lleva esa reserva aunque no se repita en cada línea.

Los fuentes de la carcasa están en [`hardware/pod-v0/carcasa/`](../../hardware/pod-v0/carcasa/LEEME.md).

## 1. Decisiones

| Tema | Qué quedó | Quién lo decidió |
|---|---|---|
| Sensor de impactos | El pod va en la espalda, donde los placajes llegan atenuados: alcanza la IMU **LSM6DSV32X** (±32 g y giroscopio). El **ADXL372 sale de la v0** (`U403`, su capacitor y la variante `pod-v0-highg`): queda para una v2 si la LSM6DSV32X satura o aparece un acelerómetro de ±200 g más barato | Usuario, 14/11/2026 (ADR 0105, "Registro de decisiones"; ya aplicado en el esquemático, las listas y el firmware) |
| Patch GNSS | **Queda el Taoglas GVLB258.A** (25 × 25 mm). El GVLB208.A (20 × 20) pesa apenas 1,5 g menos, rinde unos 3 dB menos de ganancia pico en L1 y L5, cuesta US$ 4,75 más y no cumple la regla de stock (DigiKey 271, 16 semanas). Números en la sección 9 ("Peso") | Usuario, 14/11/2026 (ADR 0105, "Registro de decisiones") |
| Tamaño de la placa | **50 × 70 mm**, el máximo que ya preveía `pod-v0.md`. En 45 × 65 mm no entran a la vez los keep-outs de las cuatro antenas | Propuesta aceptada |
| Batería | Celda **503048** (5 × 30 × 48 mm, unos 720 mAh), con el mismo espesor que la de 500–600 mAh | Propuesta aceptada; adoptada el 14/11/2026 en el ADR 0105, `pod-f3.md` y la tabla de autonomía de `pod-v0.md` |
| Contactos de la base | **Inserto de cinco pines en la tapa inferior**, bajo el patch, con resortes internos hasta la placa. Base con el pod parado en una ranura | Propuesta aceptada; adoptada el 14/11/2026 en el ADR 0105, `pod-f3.md` y B-907 |
| Fijación de la placa | **3 tornillos M2** desde adentro a postes de la tapa inferior | Usuario |
| Cierre de la carcasa | **4 tornillos M2 × 12** en las esquinas, desde la cara del cuerpo. Obliga a cambiar el contorno de la placa (sección 4) | Usuario |
| Programación | **Solo por SWD interno** (Tag-Connect), con la carcasa abierta. No se suman SWDIO y SWDCLK al inserto de contactos | Usuario |
| Forma de la carcasa | **Cuña** de 55 × 75 mm: 21,1 mm en la nuca y 16,6 mm en el extremo de abajo. El prototipo lo ven usuarios, así que no es una caja | Usuario ("la forma está bastante buena") |
| Material | Final en **nylon** (PA12). El prototipo se imprime en una FlashForge Adventurer 5M Pro, en ASA o PETG. Sin fibra de carbono, por las antenas | Usuario |
| LED | **Guía de luz** impresa en PETG transparente, como tercera pieza | Propuesta aceptada |
| Antena LoRa | **Antena chip KYOCERA AVX M620720 en la placa**, al borde de abajo, con su despeje en todas las capas. La FPC Molex 2111400100 sale de la placa y queda en el kit de banco; el U.FL (`J302`) queda como puerto de prueba sin montar detrás de un selector de 0 Ω. La carcasa no se alarga. TX a +14 dBm por defecto, +22 dBm de reserva (secciones 5 y 9) | Usuario, 15/11/2026 (ADR 0105, "Registro de decisiones") |
| UWB | **Sale el DWM3000** y la zona `UWB_ANTENA`; el banco de UWB (B-911) usa un DWM3000EVB por puntos de prueba | Usuario, 15/11/2026 (ADR 0105, "Registro de decisiones") |

## 2. Sistema de coordenadas

- Origen en la esquina de arriba a la izquierda de la placa, vista desde el lado del patch.
- **x** de 0 a 50 mm. **y** de 0 a 70 mm: y = 0 es el borde de la nuca, con el chaleco puesto.
- **z** = 0 en la cara de abajo de la placa; +z hacia el patch, que es el lado del tackle. La cara de abajo apoya contra el cuerpo.

## 3. Ubicación de partes

Posiciones en mm. Donde hay un solo punto, es el centro.

### Cara de arriba

| Parte | Posición | Notas |
|---|---|---|
| Patch GNSS GVLB258.A | Centro (25; 17), 25 × 25 × 8,12 | Centrado a lo ancho. Zona `GNSS_ANTENA` de 30 × 30: x de 10 a 40, y de 2 a 32. **Pin hacia abajo, en (25; 19,5)**: footprint con rotación 0 (su origen es el pin). Así la alimentación sale por L4 hacia la cadena RF por el camino más corto (zona `L3_GND`, sección 4). Del lado de abajo, el pin va cortado a su largo antes de montar y lleva un escudo (sección 6) |
| Cadena RF del GNSS | x de 18,5 a 23,5; y de 35 a 45 | ESD, SAW, LNA, SAW, atenuador y el 0 Ω de medición (sección 5), con su cerco de vías: hace falta una franja de unos 5 × 10 mm, no 3 × 8 |
| LDO del GNSS (`U104`) | (21; 47) | |
| Load switch del GNSS (`U105`, sin montar) | (24,5; 47) | Al lado del LDO, entre él y el riel del LC29H |
| LDO de V_BCKP (`U106`, TPS7A02) | (16,5; 47,5) | Junto al pin V_BCKP del LC29H y lejos del buck-boost |
| LC29H | x de 2 a 18; y de 33 a 45,2 | 16 × 12,2 mm, justo debajo de la zona del patch |
| U.FL de la Taoglas | (21,5; 34) | Rescate y referencia de banco; a casi 1 mm del borde de `GNSS_ANTENA` (y = 32) |
| BMD-340 | x de 0 a 15; y de 50 a 60,2 | Keep-out de 4,4 × 15: x de 0 a 4,4; y de 47,6 a 62,6 (zona `BLE_ANTENA`, 4,35 de ancho). Pads 13 y 14 (XL1, XL2) en (11,25; 59,5) y (11,8; 58,6); pads 66 a 68 (VBUS, D−, D+) en x = 14,35, y de 53,5 a 51,3 |
| Cristal de 32,768 kHz (`Y301`) y sus dos capacitores | (11,5; 61,5), los capacitores a cada lado | Pegado a los pads 13 y 14, con pistas de menos de 3 mm, tierra alrededor en L1 y nada que conmute debajo (clase GNSS_SENSITIVE) |
| IMU LSM6DSV32X | (28,5; 36,5) | Movida el 15/11/2026 desde (29,5; 37), 1 mm hacia el centro de la placa, para dejarle 1,25 mm al Ra-01SH (sus pads empiezan en x = 31). Sigue fuera de la franja de la cadena RF del GNSS (x hasta 23,5) y a unos 3,5 mm del centro de la placa |
| Barómetro BMP581 | (45; 20) | Esquina libre junto al patch, lejos del cargador |
| NAND | (23; 56), 8 × 6 | NAND_SCK (32 MHz) del lado izquierdo, lejos de la cadena RF de LoRa y de la alimentación de la antena: su armónico 29 cae en 928 MHz (sección 5, "Relojes") |
| Load switch de la NAND (`U502`, sin montar) | (19,5; 52) | Entre el riel y la NAND |
| MAX17048 | (29; 50) | Sensado de la celda (CELL y GND) **en Kelvin**: pistas propias desde los pads de J101, sin compartir la corriente de carga |
| TPS63900 (buck-boost) con su bobina | (20; 62), la bobina al sur, cerca de (20; 65) | Junto al BQ25180. Con la bobina hacia abajo el nodo de conmutación queda a 5 mm o más de la RF de LoRa (lo más cercano es el pad del brazo de P1, en x ≈ 27,2: unos 6 mm desde la bobina) y del cristal (regla SW_NODE), fuera de `LORA_ANTENA` (empieza en x = 26,7); el cuerpo del integrado (2,5 × 2,5 mm) queda a unos 1,75 mm del borde de la NAND |
| Load switch del LoRa (`U303`) | (29,5; 53,5) | Debajo del MAX17048, entre la NAND y el Ra-01SH. Con el Ra-01SH girado 180° su pad 3 (VCC) queda en la columna de la derecha, en (48,2; 48,5): VCC_LORA cruza por una capa interna y el 10 µF y el 100 nF del módulo (`C306`, `C307`; `C308` sin montar) van **en la cara de abajo, debajo del pad 3** (fuera de la celda, que termina en x = 42), porque arriba, entre los pads y el borde, no entran |
| BQ25180 | (15; 65) | Con su cobre de 5 × 5. A 20 mm o más de la IMU y del MAX17048. Queda cerca de la NTC de la celda (abajo, extremo del PCM): en la base la NTC lee algo más caliente que la celda, que es el lado conservador para JEITA |
| Ra-01SH | Centro (40,2; 45,5), girado 180°: cuerpo x de 32,2 a 48,2 e y de 37 a 54; pads almenados de x = 31,0 a 49,4 | En el lugar que dejó el DWM3000. Con 180° el **pad 1 (ANT) queda abajo a la derecha, en (47,9; 52,5)** (cobre de x 46,4 a 49,4 e y 51,9 a 53,1), del lado de la alimentación de la antena; la columna de la derecha son los pads 1–8 (ANT, GND, VCC, RESET, TXEN, DIO1, DIO2, DIO3) y la de la izquierda los 9–16 (el SPI, del lado del BMD-340). El borde de abajo del módulo no tiene pads: abajo queda una franja libre de y = 54 a 59,05 para la cadena RF. Subido a y = 37 (no 43) para que entren la cadena y el U.FL de prueba; queda a 5 mm de `GNSS_ANTENA` y a 1,25 mm de la IMU |
| Cadena RF de LoRa | x de 41 a 49,2; y de 52,5 a 59,7 | En L1, 0402 (courtyard de 1,86 × 0,94 mm). Centros, rotaciones y redes: `C310` (48,25; 54,5) 0°, paralelo de LORA_ANT, sin montar; `R325` (46,8; 55,5) 270°, puente del pasabajos; `C311` (48,25; 56,9) 0°, paralelo de LORA_RF, sin montar; `R326` (45,3; 57,9) 180°, selector a la antena; `R327` (46,8; 58,75) 270°, selector al U.FL, sin montar; `C312` (43,8; 58,41) 270°, paralelo del pi, sin montar; `R328` (42,35; 57,9) 0°, serie del pi. La línea baja del pad 1 por x = 46,8, dobla en y = 57,9 hacia la izquierda y entra al despeje por x = 41,15. **Verificado en una copia de la placa** con los footprints reales (el Ra-01SH, los 0402 y el U.FL de KiCad, la M620720 de la librería del pod): el DRC de kicad-cli 10.0.8 no da choques de courtyard, separaciones ni reglas de zona; solo serigrafía de referencias, que se acomoda en el layout. Alimentación de unos 20 mm del pad 1 a la antena (4,8 + 5,7 + 9,7) |
| U.FL de prueba de LoRa (`J302`, sin montar) | (46,8; 62,3), girado 270° (el pin hacia arriba) | Land pattern de KiCad (`U.FL_Hirose_U.FL-R-SMT-1_Vertical`): cobre de 3,15 × 4,0 mm (aquí x de 44,8 a 48,8 e y de 60,25 a 63,4), courtyard de 4,35 × 5,0. Abajo a la derecha, fuera del despeje (que termina en x = 42,7) y a 0,9 mm de la zona de cobre que deja la muesca del tornillo de cierre (y ≥ 64,4). Para el S11 con el NanoVNA, medidas conducidas y el A/B contra la Molex (sección 5) |
| Antena LoRa M620720 (`AE301`) | Centro (38,6; 68,65), girada 180°: cuerpo x de 35,6 a 41,6 e y de 67,65 a 69,65; pads y brazo hasta y = 69,7 (cobre a 0,3 mm del borde) | Eje largo a lo largo del borde de abajo. **Girada 180° respecto del dibujo de la hoja, no espejada**: el pin 1 (alimentación) queda a la derecha, en x = 41,15, y el brazo de cobre del pin 3 corre hacia la izquierda por el borde hasta x ≈ 27,2, donde va P1 (`C314`, 3,1 pF, centro (26,95; 69,35), pad de GND en x de 26,2 a 26,7, afuera del despeje). P2 (`C313`, 4,1 pF) en la alimentación, centro (42,45; 66,9), con el pad de GND en la lengua de tierra de la derecha (x de 42,7 a 43,2). Zona `LORA_ANTENA` (sección 4) |
| LED RGB | (8,5; 2,2) | Borde de la nuca, debajo de la guía de luz |
| NMOS de los LED (`Q301` a `Q303`) | (5; 12,5), en fila | Fuera del bolsillo de 5 × 5 mm de la guía de luz y de la zona GNSS |
| Buzzer (`BZ301`, sin montar) | (44,5; 27) | 8,5 × 8,5 mm, fuera de la zona GNSS y arriba del Ra-01SH; si se monta, la tapa superior necesita un agujero de sonido |
| Tornillos de la placa | (6; 8), (44; 8) y (24; 66) | Agujeros M2 metalizados a tierra. **`H305` se corrió 1 mm a la izquierda el 15/11/2026** (de (25; 66) a (24; 66)) para que el despeje de la antena LoRa entrara sin tocarlo: su pad (Ø4,4) termina en x = 26,2, a 0,5 mm del despeje, y su courtyard a 0,25 mm. Es tierra, del lado de P1, pero el tornillo es metal junto a la antena y se mide (sección 9). El poste de la tapa inferior se corrió con él (`generar_carcasa.py`) |
| Puntos de prueba del DWM3000EVB (`TP702` a `TP710`) | A elegir en el layout, cerca del BMD-340 | UWB_CS, UWB_IRQ, UWB_RST, UWB_WAKEUP, SENS_SCK, SENS_MOSI, SENS_MISO, VREG y GND, para cablear el EVB del banco (B-911). Lejos del patch y de la cadena RF de LoRa (SENS_SCK es un reloj de 8 MHz) |
| Tag-Connect TC2030-NL (`J301`) | (47; 13,5), vertical | Cara de arriba, accesible con la tapa superior afuera. Fuera de la celda (x de 12 a 42), así los pines de alineación del cable, que atraviesan la placa, no tocan nada abajo; a unos 3 mm del agujero de `H304`. Los puntos de prueba SWD y de la consola al lado. SWDCLK con una resistencia serie de 22–33 Ω del lado del BMD-340 (a sumar al esquemático) y lejos de `LORA_RF`, que está en la otra punta |
| J201, conector de QGNSS | (4,5; 29), vertical, abriendo hacia el borde izquierdo | JST SH de 4 vías para el banco (con la tapa afuera). Fuera de la zona GNSS y cerca de la UART del LC29H y de sus traductores de nivel |

### Cara de abajo

| Parte | Posición | Notas |
|---|---|---|
| Celda 503048 | x de 12 a 42; y de 14 a 62 | A 1 mm de la placa. Queda debajo del pin del patch: el pin se corta a su largo antes de montar y lleva un escudo rígido (sección 6, obligatorio). Su extremo de abajo (el del PCM) se mete unos 3 mm bajo el despeje de la antena LoRa (y de 59,05 a 62, x de 26,7 a 42): metal del sobre de aluminio a 1 mm, que se mide (sección 9) |
| Resortes del inserto | x = 18; 21,5; 25; 28,5 y 32, en y = 7 | **D+, D−, GND, DETECT y VBUS**, de izquierda a derecha, a 3,5 mm de paso (orden del 14/11/2026, ver "Ruteo"). El bloque de contactos de la tapa ocupa x de 15 a 35 e y de 3,5 a 10,5 (`BLOQUE` de `generar_carcasa.py`): lo de abajo queda afuera |
| ESD de D+ y D− (`U601`, USBLC6-2SC6) | (19,75; 12) | Justo debajo del bloque, entre los resortes de D+ y D− |
| Resistencia de DETECT (`R601`) y ESD de DETECT (`D602`) | (28,5; 12) | Debajo del resorte de DETECT, que va a GND ahí mismo |
| TVS de VBUS (`D601`, SMF12A) | (36,5; 5) | Lo primero después del resorte de VBUS, a la derecha del bloque |
| eFuse TPS259470A (`U602`) y su divisor de OVLO y capacitor de dV/dt | (38; 10), sus pasivos de x = 35,5 a 40,5 e y = 7 a 13 | Entre el TVS y el riel que baja al BQ25180; fuera del poste del tornillo `H304` (radio 3 alrededor de (44; 8)) |
| Punto de prueba de VBUS (`TP601`) | (37; 13,5) | |
| Sensor Hall DRV5032FA | (46; 42) | Movido el 15/11/2026: (40; 66) quedaba dentro del despeje de la antena LoRa. Fuera de la celda (x ≥ 44,5) y lejos del despeje. **El imán del chaleco cambia de lugar**: va frente a (46; 42), del lado derecho a media altura |
| J101, conector de la batería | (12; 66) | JST GH horizontal, cerca del BQ25180. Trae la NTC de 10 kΩ de la celda por su pin 3 (TS del BQ25180): la NTC no va en la placa |

### En la carcasa

| Parte | Posición | Notas |
|---|---|---|
| Tornillos de cierre | (2,6; 2,6), (47,4; 2,6), (2,6; 67,4) y (47,4; 67,4) | Uno por esquina |
| Ventilación del barómetro | Pared derecha, y = 20, z = 7,2 | Con rebaje para una membrana de 4 mm |
| Ranura del LED | Pared de la nuca, x de 5,5 a 11,5, z de 6,2 a 7,8 | 6 × 1,6 mm |

## 4. Contorno y fijación de la placa

- **Esquinas con radio 5 mm**, para que la carcasa pueda llevar esquinas de radio 7,5 mm.
- **Una muesca cóncava de radio 2,7 mm en cada esquina**, centrada a 2,6 mm de cada borde. Por ahí pasa el tetón del tornillo de cierre. Conviene definirla antes del layout, porque cambia el contorno.
- **Tornillos de la placa** en triángulo, para que la placa no quede forzada: (6; 8), (44; 8) y (24; 66) (el de abajo estaba en (25; 66) hasta el 15/11/2026; se corrió por el despeje de la antena LoRa). Los dos de arriba se corrieron 1 mm respecto de la primera propuesta, para dejar unos 2,5 mm de placa entre el agujero y la muesca.
- **Los tornillos de la placa no cierran la carcasa.** Se evaluó usar los mismos para las dos cosas y se descartó: los golpes sobre la tapa pasarían por la placa, el sello dependería del espesor de la placa y abrir la carcasa dejaría la placa suelta.
- **La batería no va rígida**: se apoya con espuma, con su hueco de hinchazón.
- **Ya está en la placa de KiCad** (`hardware/pod-v0/pod-v0.kicad_pcb`, 14/11/2026; origen (0; 0) = (100; 100)): el contorno con las cuatro muescas, los tres tornillos (`H303`, `H304` y `H305`, `MountingHole_2.2mm_M2_Pad_Via` metalizados a GND, bloqueados y también en el esquemático), el plano de GND de L2 (`L2_GND`) y las zonas `GNSS_ANTENA`, `L3_GND`, `BLE_ANTENA` y `LORA_ANTENA` en sus lugares (`UWB_ANTENA` salió el 15/11/2026) ([`hardware/README.md`](../../hardware/README.md), "Contorno, tornillos y zonas con nombre"). El DRC del CI y su prueba de reglas pasan con el contorno nuevo. Las partes no se ubicaron: el layout lo hace el usuario.
- **Alimentación del patch**: con el pin hacia abajo, en (25; 19,5), sale por L4 unos 10 mm hasta pasar el borde de la cerámica (y = 29,5), sube a L1 por su vía de RF cerca de (25; 31) y llega a la cadena RF en y = 35. Con el pin hacia arriba o hacia un costado el tramo de L4 sería más largo. Es la misma CPWG de L1 espejada: L4 se refiere a L3 por el prepreg de 0,2 mm, así que 0,33 mm con 0,20 mm a GND dan unos 51–52 Ω (regla "RF_50: ancho de 50 ohm en L4"). GND coplanar en L4, vías de GND de L1 a L4 cada 2–3 mm a los dos lados, al menos 4 alrededor del despeje de Ø3,5 mm del pin y 2 a 4 alrededor de la vía de RF.
- **Zona `L3_GND`** (solo L3; reemplaza a la franja `PATCH_FEED` de 4 mm): todo el tercio de arriba (y < 33) más la franja x de 5 a 17, y de 33 a 55, por donde baja el par USB. En L3 solo GND, así todo lo que corre por L4 (la alimentación del patch, D+ y D−, VBUS y el grupo del eFuse) tiene su referencia.
- **`LORA_ANTENA`** (15/11/2026): el despeje de la M620720, **x de 26,7 a 42,7 e y de 59,05 a 70**, en todas las capas. Son los 14,9 + 1,1 mm a lo largo del borde y los 10,65 mm de profundidad de la hoja (TDS-ANT-0048 rev. 4, p.5), más 0,2 mm porque el cobre de la antena va a 0,3 mm del borde (el mínimo de PCBWay de `pod-v0.kicad_dru`) y no a 0,1 mm como en la placa de demostración. La rule area prohíbe vías y rellenos (también el plano de L2) y las reglas propias dejan entrar solo la alimentación (LORA_FEED) por L1, los footprints `AE301`, `C313` y `C314`, y ningún dibujo ni texto de cobre (`hardware/README.md`; la sonda del DRC las prueba). **Por qué así** (revisión del 15/11/2026): la antena va **girada 180° respecto del dibujo de la hoja** (la primera versión la espejaba), con la alimentación a la derecha y el brazo y P1 hacia la izquierda. Así P1 cae sobre la tierra ancha de la izquierda (todo el plano de la franja de abajo, con `H305`, que es GND) en lugar de una isla junto a la muesca del tornillo de cierre: en la primera versión el pad de GND de P1 quedaba sobre unos 1,1 mm de cobre unidos al plano por un cuello de unos 0,3 mm. Del lado de la alimentación, la lengua de tierra de P2 queda entre el despeje (x = 42,7) y la muesca: **1,7 mm de ancho en lo más angosto** (y ≈ 67,4) y abierta hacia arriba al plano entero desde y = 64,4. Para que entrara sin tocar `H305` se corrió ese tornillo 1 mm a la izquierda. Vías de GND de costura: dos junto al pad de GND de P1, en (25,7; 69,2) y (25,7; 68,2), y una junto al de P2, en (43,75; 66,9), todas fuera del despeje. Quedan **0,5 mm al pad de `H305`** a la izquierda y unos **3,7 mm al tornillo de cierre** a la derecha (al vástago; la muesca empieza a 2 mm).
- **La zona de `UWB_ANTENA` quedó en tierra** (15/11/2026): el DWM3000 salió de la placa y el plano de L2 se rellenó sobre ese lugar.

## 5. Antenas

### Reglas y distancias

| Antena | Regla | Cómo queda |
|---|---|---|
| GNSS (patch) | Arriba, centrado, con tierra continua debajo | Es la mejor ubicación posible, pero **no cumple del todo**: la hoja pide 70 × 70 mm de tierra y la placa tiene 50 × 70. L5 se valida en el banco |
| BLE (BMD-340) | Al ras del borde, con 4,4 × 15 mm sin cobre en ninguna capa | Cumple. La celda queda a 7,6 mm |
| LoRa (M620720, desde el 15/11/2026) | En el extremo opuesto al patch, a 40 mm o más; al borde de la placa con 14,9 + 1,1 × 10,65 mm sin metal en ninguna capa (hoja, p.5) | Cumple la distancia al patch (unos 53 mm entre centros) y el despeje. **No es la placa de la hoja**: AVX la mide en el borde largo de 40 × 100 mm y acá va en el borde corto de 50 × 70, con la celda debajo de 3 mm del despeje y el cuerpo atrás: ver abajo |

- **El DWM3000 salió de la v0 el 15/11/2026** (ADR 0105): necesitaba la antena afuera de la placa y una carcasa propia. El banco de UWB (B-911) usa un Qorvo DWM3000EVB cableado a puntos de prueba (sección 3).
- **Por qué salió la FPC (estudio del 14/11/2026, queda como registro).** La FPC de LoRa, tal como estaba, iba a quedar muy desafinada. Pegada en la pared interna de abajo queda a unos 0,5 mm del borde de la placa (y de su tierra) a lo largo de sus 38 mm, a unos 3 mm de los tornillos de cierre de acero y a unos 6 mm del de la placa (`H305`). La especificación de aplicación de Molex (AS-2111400100, secciones 5 y 6) pide **5 mm o más** entre la antena y un plano de tierra, paralelo o perpendicular (la eficiencia baja cuanto más cerca está), el **cable a 5 mm o más del borde de la FPC** y nunca sobre metal. Sus números (más de 55 % y 60 % de eficiencia, 0,3 y 1,0 dBi) son sobre un bloque de PC/ABS de 1,5 mm, casi en espacio libre, y la misma hoja avisa que en el equipo se pierden 1 a 2 dB y que la resonancia se corre y se corrige con adaptación.
- **Lo que se había propuesto** era alargar la carcasa unos 5 mm para dejar la FPC a 5 mm de la placa. El usuario eligió el 15/11/2026 pasar a la antena chip en la placa y no alargar la carcasa.

### Antena LoRa en la placa (desde el 15/11/2026)

- **Cadena**: pad 1 del Ra-01SH → pasabajos C–L–C sin montar (`C310`, `R325` de puente, `C311`) → nodo LORA_RF → selector de 0 Ω (`R326` a la antena, montado; `R327` al U.FL de prueba `J302`, sin montar) → adaptación en pi (`C312` paralelo sin montar, `R328` como lugar del serie, 0 Ω de arranque) → alimentación de 50 Ω por L1 (unos 20 mm en total) → P2 (`C313`, 4,1 pF a GND) junto al pin 1 → antena; el pin 3 por su brazo de cobre a P1 (`C314`, 3,1 pF a GND). P1 y P2 son los valores de la placa de demostración de AVX para 902–928 MHz y **solo son un punto de partida**: la hoja aclara que dependen del diseño. P1 y P2 quedan con un pad sobre el borde del despeje, como en la hoja; el resto de la adaptación, afuera. Coordenadas en la sección 3.
- **El footprint sale de la imagen de la p.5 de la hoja** (no hay CAD): pads de 1,1 × 2,1 mm, brazo del pin 3 de 0,7 mm por el borde hasta P1, despeje de 16,0 × 10,95 mm. Está dibujado **en la misma orientación que la hoja** (borde arriba, pin 1 a la izquierda) y en el pod va girado 180°: nada espejado. El courtyard cubre el cuerpo y los tres pads (el brazo queda afuera), así no choca con los de P1 y P2. **A verificar contra el footprint de AVX** (Altium o DXF), pedido en la consulta 9 de [`cotizacion/consultas.md`](cotizacion/consultas.md) junto con una revisión de la ubicación en el borde corto y de la orientación. Diferencias con la hoja: el cobre de arriba de AVX llega hasta 8,1 mm de profundidad en la franja de la alimentación y acá el despeje es el rectángulo completo en todas las capas; y la máscara de la hoja parece abrir los pads unos 2,0 mm de profundidad contra 2,1 de cobre, y acá abre los 2,1 (se revisa con el CAD).
- **Cómo se ajusta**, con el U.FL de prueba (`J302`, el selector y `R325` según lo que se mide). **S11 de la antena**: montar `J302` y `R327`, **dejar `R326` y sacar `R325`** (el Ra-01SH queda afuera y el NanoVNA ve el nodo LORA_RF, el pi, la alimentación y la antena). Medir **con la carcasa cerrada, en el chaleco, sobre un cuerpo, seco y mojado**. Objetivo: **mejor que −6 dB en 915–928 MHz** en todos los casos. Primero P1 (corre la resonancia), después P2 y, si hace falta, el pi. **Potencia conducida del Ra-01SH o la FPC Molex**: montar `J302` y `R327`, **sacar `R326` y dejar `R325`** (la antena chip queda afuera y el U.FL ve la salida del pasabajos).
- **A/B contra la FPC**: RSSI en el gateway de la antena chip (`R326` y `R325` montados, `R327` sin montar) contra la Molex 2111400100 enchufada en el U.FL de prueba (`R325`, `R327` y `J302` montados, `R326` afuera; la FPC a 5 mm o más de la placa y de su tierra, como pide Molex), mismo pod, mismo lugar y misma potencia. **Pasa si la antena chip queda a 3 dB o menos de la FPC.** Si no, se revisa la adaptación con AVX y, como rescate, la FPC por el U.FL.
- **Potencia**: +14 dBm por defecto y +22 dBm de reserva. El control de potencia por pod desde el RSSI de la baliza queda para el firmware (issue #325).
- **Enlace y convivencia**: estimaciones en [`pod-v0.md`](pod-v0.md), "Antena LoRa en la placa".

### Cómo medir la antena GNSS

- **NanoVNA** (H4 o LiteVNA): mide el S11 del patch montado en la placa real, con la carcasa y sobre el cuerpo. Muestra si la tierra chica corre la resonancia de L5 (1176 MHz) o de L1 (1575 MHz).
- **openEMS**: simula el patch sobre la tierra exportada de KiCad. Taoglas no publica el dieléctrico, así que sirve para comparar variantes y no como valor absoluto.
- **QGNSS con el LC29H**: el C/N0 de L1 y de L5 por separado contra la Taoglas es la prueba final.
- **Un 0 Ω entre el nodo `GNSS_ANT` y el ESD/SAW.** Al sacarlo, el patch se mide solo por el U.FL. Hoy el U.FL entra al nodo por el capacitor de 100 pF, pero el nodo sigue unido a la cadena.

### Qué hay que medir con y sin

- Los tornillos de la placa de arriba, a unos 5–7 mm del patch.
- Los tornillos de cierre de abajo: quedan a unos 4 mm de la antena BLE, y el de la derecha a unos 3,7 mm del despeje de la antena LoRa (la muesca, a 2 mm), del lado de la alimentación y de P2. **Medir el S11 y el RSSI con tornillos de acero y de nylon**; si desafinan, se cambian por M2 de nylon sin tocar la carcasa.
- El tornillo de la placa de abajo (`H305`, metalizado a GND, en (24; 66)): su pad queda a 0,5 mm del despeje de la antena LoRa, del lado de P1 y del final del brazo. Medir con y sin tornillo (y con uno de nylon).
- La celda debajo de los 3 mm de adentro del despeje de la antena LoRa.
- Las escuadras de plástico que sostienen el patch y el adhesivo de sus esquinas.
- El techo de la tapa superior sobre el patch (a unos 0,4–0,8 mm de su cara de arriba) y el apoyo de presión contra el borde de la base.

## 6. Apilado, batería y contactos

### Apilado en z

| Capa | z (mm) |
|---|---|
| Cara de afuera, lado del tackle | 12,3 en la nuca; 7,8 en el extremo de abajo |
| Cara interna de arriba | 10,5 sobre el patch; 6,0 en el extremo de abajo |
| Tope del patch | 9,72 nominal; 10,12 con tolerancia |
| Placa | de 0 a 1,6 |
| Pin del patch cortado a su largo antes de montar y su escudo, bajo (25; 19,5) | hasta −0,7: pin y soldadura ≤ 0,3 mm más un escudo de 0,3–0,4 mm |
| Celda | de −1,0 a −6,2 |
| Cara interna de abajo | −7,0 |
| Cara de afuera, contra el cuerpo | −8,8 |

- **El pin del patch no puede quedar como sale de fábrica (paso obligatorio del armado).** El pin del GVLB258.A sale 2,4 ± 0,4 mm por debajo de la cerámica: con la placa de 1,6 mm sobresale unos **0,8 mm** (de 0,24 a 1,36 con las tolerancias) más el cono de soldadura, y la celda está a 1,0 mm, justo debajo de (25; 19,5). Por eso: **cortar el pin a su largo antes de montarlo** (unos 1,6–1,8 mm debajo de la cerámica, para que pin y soldadura queden en **0,3 mm o menos** de la cara de abajo; cortarlo después de soldar le da un golpe a la junta del electrodo de arriba), soldarlo, y **pegar sobre la soldadura un escudo rígido** de 0,3 mm o más (FR4 o policarbonato), que reparte la carga si la celda se hincha o el pod recibe un golpe. Para las 100 se le pide a Taoglas una versión con el pin corto (`cotizacion/consultas.md`, sección 6). Queda en −0,7 como mucho, con 0,3 mm de aire hasta la celda: el lugar de la celda y la carcasa no cambian.
- **Si el corte o el escudo no se pueden garantizar**: bajar la celda hasta 1 mm o más por debajo de la punta en el peor caso (unos 2,7 mm desde la placa contando la soldadura), lo que suma unos 1,7 mm al espesor, o correr la celda para que no quede debajo del pin (empezar en y ≥ 22, con unos 40 mm de largo; no hay una celda estándar de esas medidas con 720 mAh).

### Batería

- **Celdas comparadas** (lista genérica de modelos, sin verificar con el proveedor): 503040, unos 570 mAh; **503048, unos 720 mAh**; 603048, unos 900 mAh y 1 mm más de espesor. No hay un tamaño estándar de 800 mAh justos.
- **Autonomía en Activo** con la 503048: unas 16–20 h, escalando la columna de 600 mAh de `pod-v0.md`.
- **J101** va en la cara de abajo, del mismo lado que la celda, para que el cable no rodee el borde de la placa. La celda se arma con el extremo del PCM hacia la franja de abajo. Hacen falta unos 15–20 mm de cable para enchufar antes de bajar la placa.

### Contactos de la base

- **Los pads en la placa no pueden quedar al ras de la carcasa.** La cara de abajo de la placa queda unos 8–9 mm adentro, detrás de la batería y la pared; la de arriba, unos 9–11 mm, por el alto del patch.
- **Inserto en la tapa inferior:** cinco pines de oro duro sellados, unidos a la placa por resortes internos de unos 2,5 mm. El oro duro pasa al inserto y la placa queda en ENIG.
- **Bajo el patch, en la franja de la nuca:** el plano de tierra lo tapa, así que no afecta ninguna antena, y es el punto más alto con el chaleco puesto, donde menos sudor junta.
- **Base con el pod parado** en una ranura, con contactos de lámina que rozan. Veinte pods ocupan dos filas de diez y la forma de la ranura hace de llave, sin imanes en el pod.

### Ruteo de USB y VBUS desde el inserto

- **Orden de los contactos: D+, D−, GND, DETECT y VBUS** (x = 18; 21,5; 25; 28,5 y 32). Los resortes, el ESD de datos y la protección de VBUS están dentro de `GNSS_ANTENA`, donde no puede haber vías que no sean de GND: cada red va en una sola capa, L4. Con el orden anterior (VBUS a la izquierda) el par tenía que cruzar el resorte de VBUS y el grupo del eFuse para ir al BMD-340, que está a la izquierda. Así, el par sale hacia la izquierda, VBUS hacia la derecha (al eFuse, en x de 35,5 a 40,5), DETECT termina en su resistencia a GND ahí mismo y GND queda entre los datos y el resto. El orden de contacto de las láminas de la base no cambia: GND la más larga y primera, DETECT la más corta y última.
- **D+ y D−** van **por L4 de punta a punta**: de los resortes (y ≈ 7) hacia la izquierda por debajo del bloque, bajan por x de 7 a 9 (fuera del poste de `H303`, y lejos de las señales GNSS_SENSITIVE del LC29H, que están en L1) y suben a L1 con **un solo par de vías** al lado de los pads 66 a 68 del BMD-340 (x = 14,35; y de 51,3 a 53,5). Son unos **45 mm** de par sobre la franja de GND de L3 (`L3_GND`), con GND coplanar a los dos lados en L4. Como L4 se refiere a L3 igual que L1 a L2, la geometría de L1 (0,25/0,15 mm) da unos 90 Ω y la regla `USB_90D` no cambia. Hasta 5 mm sin acoplar (la entrada a los resortes y al ESD) y 0,5 mm de diferencia de largo.
- **Si el par fuera por L3**, L4 debajo tendría que ser GND macizo (stripline entre L2 y L4) y 90 Ω pediría unos 0,21/0,17 mm, con una regla propia para esa capa. No hace falta.
- **Lejos de la cadena del LNA y los SAW** (x de 18,5 a 23,5; y de 35 a 45) y de la alimentación del patch: el par no pasa por debajo de ninguna de las dos.
- **VBUS y la carga**: el BQ25180 carga a 300–350 mA y la entrada se dimensiona para 1 A (clase `POWER_DOCK`). Desde el eFuse hasta el BQ25180 en (15; 65) son unos 70 mm por L4, bajando por x ≈ 43 (entre la celda y el borde derecho) y volviendo por L4 en y ≈ 57–58, entre el Ra-01SH y el despeje de la antena LoRa (y ≥ 59,05): pasa por debajo de la cadena RF de LoRa, que va en L1 sobre la tierra de L2: **0,5 mm o más en L1 o L4** (35 µm; unos 70 mΩ, 35 mV a 0,5 A) o **1,5 mm en las internas**. Sin vías dentro de `GNSS_ANTENA`; pasa por debajo del borde de la celda, que queda a 1 mm.
- **Alternativa a evaluar en el layout: el inserto en el extremo de abajo.** D+, D− y VBUS quedarían a unos 10–15 mm del BMD-340 y del BQ25180, sin cruzar la placa ni pasar cerca de la cadena RF. A cambio, los contactos irían al punto más bajo con el chaleco puesto (más sudor), junto a la antena LoRa y el tornillo de abajo, y la carcasa se tendría que regenerar. Si el ruteo de arriba no cierra, se evalúa esta opción.

## 7. Carcasa de prueba

### Forma y medidas

- **Exterior de 55 × 75 mm**, con esquinas de radio 7,5 mm.
- **Cuña:** 21,1 mm de espesor en la nuca y 16,6 mm en el extremo de abajo. El techo baja siguiendo la altura de los componentes.
- **Paredes de 2 mm y caras de 1,8 mm.** Pared mínima medida en el modelo: 1,8 mm.
- **Dos tapas con unión a media madera** dentro del espesor de la pared, a una altura constante.
- **Marcas en V** que apuntan a la nuca e indican cómo va en el bolsillo, y un rebaje redondo de 14 mm para el logo del club.
- **Volumen de las dos tapas:** unos 23,3 cm³, que son unos 24 g en PA12.

### Piezas

- **Tapa inferior** (contra el cuerpo): tres postes para la placa con insertos M2, cuatro tetones de cierre, el bloque de contactos con su isla rebajada y las guías de la celda.
- **Tapa superior** (lado del tackle): cuatro escuadras que sostienen el patch de costado, la cámara del barómetro con su ventilación, la ranura del LED, las marcas en V y el rebaje del logo. No apoya sobre la placa.
- **Guía de luz:** el cuerpo queda medio milímetro sobre el LED, una cara a 45° desvía la luz y la lengua asoma por la ranura. Se pega desde adentro en la tapa superior.

### Cierre

- **Cuatro tornillos M2 × 12 de cabeza botón**, uno por esquina, desde la cara del cuerpo. La cabeza queda escondida 1,6 mm.
- **Rosca de 4 mm en la tapa superior**, en un agujero piloto para tornillo autorroscante. No lleva insertos, porque agrandarían la muesca de la placa.
- **Encastre a presión** con un cordón en los dos lados largos, solo en la variante de nylon. Mantiene las tapas alineadas entre los tornillos.
- **Todavía no es estanca:** falta la junta en la unión y el sello bajo las cabezas.

### Variantes y materiales

| | Nylon sinterizado o resina | Impresora de filamento |
|---|---|---|
| Uso | Servicio de impresión (MJF o SLS) | Prototipo en la FlashForge Adventurer 5M Pro, boquilla de 0,4 mm |
| Juego en la unión | 0,15 mm | 0,25 mm |
| Encastre a presión | Sí | No |
| Borde de la cara del cuerpo | Redondeado | Chaflán a 45°, para imprimir sin soportes |
| Agujeros | Nominales | Más grandes, porque impresos quedan más chicos |
| Tapa superior | Cara de afuera hacia abajo | Boca hacia abajo, con soportes solo por dentro |

- **Tapas en filamento:** ASA para un acabado mate, o PETG si se busca lo más fácil. PLA solo para una primera prueba de encastre.
- **Sin fibra de carbono** (PLA-CF, PETG-CF, PA-CF): la fibra conduce y afecta a las antenas. La fibra de vidrio no conduce, pero pide una boquilla endurecida de 0,6 mm o más, y con ese diámetro hay que engrosar las paredes de la unión.
- **Nylon en la Adventurer 5M Pro:** no figura en la lista oficial (PLA, PETG, TPU, ABS, ASA, PLA-CF y PETG-CF). La boquilla llega a 280 °C y la cama a 110 °C, así que admite nylon sin carga que imprima a 270 °C o menos, con el filamento seco y adhesivo en la cama. La cámara es cerrada pero no calefaccionada.
- **Guía de luz:** PETG transparente sin color, relleno al 100 %, capa de 0,10 a 0,12 mm. Queda esmerilada. Mejora si se pintan de blanco las caras del cuerpo, menos la de abajo y la lengua.

### Qué se verificó en el modelo

- Las mallas son cerradas y la simplificación no mueve la superficie más de 0,06 mm.
- Las dos tapas no se pisan entre sí, y la guía de luz no pisa las tapas ni el LED.
- Ninguna pieza choca con los componentes de la sección 3, con el contorno de la sección 4 aplicado.
- No se imprimió ni se armó nada.

## 8. Programación

- **Primera grabación:** por SWD con el Tag-Connect TC2030-NL, con la carcasa abierta. Graba MCUboot, el firmware, el número de serie y la protección de lectura.
- **Actualizaciones:** por los cinco contactos, que son USB, con MCUmgr desde la base. BLE queda como respaldo. En el banco, un adaptador de pogo a USB hace de base.
- **Depuración:** la consola principal va por RTT, que es SWD. Un pod cerrado no se puede depurar, así que las unidades de desarrollo se abren.
- **Recuperación de un pod cerrado:** si un firmware rompe el USB, la salida es el modo de recuperación de MCUboot por los mismos contactos. Como no hay botón, falta definir cómo se entra; una opción es el imán del Hall al conectar la base.
- **Ubicación del Tag-Connect:** en la cara de arriba, accesible con la tapa superior afuera. Conviene que no quede sobre la celda, porque sus pines de alineación atraviesan la placa; el largo hay que confirmarlo con la hoja.

## 9. Hallazgos y pendientes

### Para resolver antes del layout

- [x] **Contorno de la placa:** radio 5 mm y las cuatro muescas de las esquinas, dibujado en KiCad el 14/11/2026 con los tornillos y las zonas (sección 4).
- [x] **Ra-01SH y antena UWB:** resuelto el 15/11/2026: el DWM3000 salió de la placa y el Ra-01SH subió a su lugar.
- [x] **Ubicar el Tag-Connect y J201** (propuesta en la sección 3, a confirmar en el layout).
- [x] **Pin del patch contra la celda**: pin cortado a su largo antes de montar y escudo rígido, obligatorios en el armado (sección 6); versión de pin corto pedida a Taoglas para las 100.
- [x] **Orden de los contactos del inserto** para que el par USB y VBUS no se crucen en L4 (sección 6).
- [x] **Qué extremo del DWM3000 es la antena**: verificado contra el footprint (el DWM3000 salió el 15/11/2026).
- [x] **FPC de LoRa a 5 mm o más de la tierra** (Molex): resuelto el 15/11/2026 con la antena chip en la placa; la carcasa no se alarga.
- [ ] **Footprint de la M620720 contra el CAD de AVX**, su orientación (girada 180° respecto de la hoja) y revisión de la ubicación en el borde corto (consulta 9).
- [ ] **Resistencia serie en SWDCLK** (22–33 Ω): sumarla al esquemático.
- [ ] **Posición del pin del patch** contra el DXF de Taoglas, y **altura del escalón** entre la base de 25 × 25 y el elemento de arriba, para sumar el apoyo de presión vertical en la tapa.

### Para medir con la primera placa

- [ ] **L5 con la tierra de 50 × 70 mm:** C/N0 de L1 y de L5 por separado contra la Taoglas.
- [ ] **Efecto de los tornillos** sobre el patch, la antena BLE y la antena LoRa (sección 5): `H305` y el tornillo de cierre de abajo a la derecha, de acero y de nylon.
- [ ] **Antena LoRa**: S11 por el U.FL de prueba con la carcasa cerrada, en el chaleco, sobre un cuerpo, seco y mojado (mejor que −6 dB en 915–928 MHz); A/B de RSSI contra la Molex (pasa a 3 dB o menos); C/N0 de L1 y L5 con LoRa transmitiendo a +14 y +22 dBm (`pod-v0.md`, arranque).
- [ ] **Distancia de detección del Hall:** en (46; 42) queda fuera de la celda, a unos 8–9 mm de la cara de afuera. Define el tamaño del imán del chaleco y su nuevo lugar en el bolsillo.
- [ ] **Luz del LED** a través de la guía, con el filamento real.

### Abiertos de diseño

- [ ] **Peso: unos 74–76 g contra la meta de 50 g** (estimación). Las dos tapas son unos 24 g, el patch 17,5 g, la celda unos 14,5 g y la placa de 50 × 70 × 1,6 mm de 4 capas unos 10 g desnuda y 14–16 g armada: unos 70 g, más unos 4–6 g de los siete tornillos M2, los insertos, el inserto de contactos con sus resortes, la guía de luz y el escudo del pin (la FPC de LoRa ya no va). Palancas:
  - **Paredes de 1,5 mm**: unos 6 g menos. Pendiente del usuario; el generador sigue en 2 mm.
  - **Kyocera AVX 1005620** (25 × 25 × 4,16 mm, 9,6 g, L1 centrada en 1584 ± 2 MHz y L5 en 1176 ± 2 MHz sobre 70 × 70 mm, 3,3/0,4 dBic en el cenit en L1/L5; DigiKey 56, 12 semanas): unos 8 g menos y 4 mm menos de alto. **Comprar 5** para compararla en el banco con QGNSS contra el GVLB258.A. Tiene la misma base de 25 × 25 mm, pero **el pin no está en el mismo lugar**: según el dibujo de su hoja (TDS-ANT-0088 rev. 1) está a 10,70 mm de un borde (1,8 mm del centro) y centrado en el otro eje, contra 2,5 mm del GVLB258.A, con un pin de Ø0,82 mm que sobresale 3 mm. Con el mismo footprint no entra: hace falta un segundo agujero (o un footprint propio) en el lugar de su pin, y verificar hacia qué lado queda respecto del chaflán. La hoja no da las eficiencias; DigiKey lista 7,85 mm de alto máximo, que no coincide con los 4,16 mm de la hoja.
  - **Antenas chip de L1 y L5**: solo si el usuario reabre la decisión del patch apilado (con chips se pierde ganancia y la tierra chica pesa más).
  - Comparación del 14/11/2026 que dejó el **GVLB258.A** (hoja rev. I): 17,5 g netos, eficiencia 50,94 % en L5 y 70,44 % en L1, ganancia pico 3,29 dBi en L5 y 4,30 dBi en L1. El **GVLB208.A** (hoja SPE-25-8-318-B): 16 g, pin a 1,2 mm del centro, eficiencia 49,8 % en L5 y 50,2 % en L1, ganancia pico 0,4 dBi en L5 y 1,5 dBi en L1, US$ 4,75 más caro y sin stock suficiente (DigiKey 271, 16 semanas).
- [ ] **Estanqueidad:** junta en la unión, sello bajo las cabezas de los tornillos, sellado de la guía de luz y de los pines.
- [ ] **Rosca en nylon impreso:** aguanta pocos ciclos de abrir y cerrar.
- [ ] **Espesor.** La única forma de bajarlo a unos 17–18 mm es poner la batería arriba, al lado del patch, y los módulos abajo. Deja una masa metálica junto a la antena GNSS; se puede probar en el banco apoyando una celda junto al patch.
- [ ] **Recuperación por MCUboot** sin botón (sección 8).
- [ ] **Medidas de los herrajes:** pines, resortes, insertos y membrana son genéricos. Se ajusta la carcasa a las partes que se compren.

### Para pasar a otros documentos

- [x] ADR 0105 y `pod-f3.md`: celda 503048 y contactos por inserto (14/11/2026).
- [x] Tabla de autonomía de `pod-v0.md` (columna de 720 mAh).
- [x] B-907: base con el pod parado y contactos de lámina.
- [x] ADR 0105, `pod-v0.md`, `pod-f3.md`, `pod-mecanica-produccion.md` y el backlog: antena LoRa en la placa y sin DWM3000 (15/11/2026).

## 10. Sugerencias de configuración de la IMU

No son decisiones; quedan como punto de partida para el firmware.

- Acelerómetro en ±32 g y giroscopio en 2000 dps o más.
- Muestreo de **480 o 960 Hz** con FIFO en modo continuo (la LSM6DSV32X tiene ODR de 7,5 · 15 · 30 · 60 · 120 · 240 · 480 · 960 · 1920 · 3840 · 7680 Hz; 400 y 800 Hz solo existen en el modo de ODR de alta precisión 2, y 500 y 1000 Hz en el 1), para guardar la ventana de cada impacto, y menor resolución para las métricas de carga.
- Interrupción de wake-up o de umbral para marcar colisiones sin procesar todo el flujo en el micro.
- SPI si se lee a alta frecuencia: I²C se queda corto con FIFO a casi 1 kHz.
- El chip cerca del centro de la placa, lejos de los bordes y del conector, con la placa firme contra la carcasa.

## 11. Correcciones hechas durante la sesión

- **La 603048 es de unos 900 mAh**, no de 600 como se dijo al principio.
- **Los tornillos de cierre entran por la cara del cuerpo.** La primera carcasa usaba los mismos tres tornillos para la placa y el cierre; después se separaron.
- **El nylon en la Adventurer 5M Pro** no está descartado: no figura en la lista oficial, pero la máquina admite algunos por temperatura.
- **Los tornillos de cierre de abajo quedaban a unos 3 mm de las puntas de la FPC de LoRa**, no a 1 mm: el milímetro era la distancia al tetón de plástico (la FPC salió el 15/11/2026).
- **El muestreo de la IMU no puede ser de 400 Hz** en el modo normal: los ODR de la familia LSM6DSV van de a doble desde 7,5 Hz (sección 10).
- **Las primeras vistas de la carcasa estaban espejadas** de izquierda a derecha. Los STL estaban bien.

## 12. Fuentes

- [Kyocera AVX 1005620, hoja de datos TDS-ANT-0088 rev. 1](https://datasheets.kyocera-avx.com/1005620.pdf)
- [KYOCERA AVX M620720, hoja de datos TDS-ANT-0048 rev. 4](https://datasheets.kyocera-avx.com/ethertronics/AVX-E_M620720.pdf) (leída el 15/11/2026; el dibujo de la p.5 es solo imagen)
- [DigiKey M620720](https://www.digikey.com/en/products/detail/kyocera-avx/M620720/6072490) (37.777 en stock, plazo de fábrica de 20 semanas, 15/11/2026)
- [Driver `lsm6dsv16x` de Zephyr, tabla de ODR por modo](https://github.com/zephyrproject-rtos/zephyr/blob/main/drivers/sensor/st/lsm6dsv16x/lsm6dsv16x.c) (misma familia y registro `ODR_XL` que la LSM6DSV32X, ST DS13511)
- [DWM3000, hoja de datos (Farnell)](https://farnell.com/datasheets/4509027.pdf)
- [DWM3000 antenna placement, foro de Qorvo](https://forum.qorvo.com/t/dwm3000-antenna-placement/21256)
- [Vertical/horizontal keep-out needed for DWM3000, foro de Qorvo](https://forum.qorvo.com/t/vertical-horizontal-keep-out-needed-for-dwm3000-module/21313)
- [Model List for LiPo and Li-ion](https://www.mikrocontroller.net/attachment/102205/Model_List_for_LiPO_and_Li-ion.pdf)
- [Adventurer 5M vs Adventurer 5M Pro, FlashForge](https://www.flashforge.com/blogs/news/adventurer-5m-vs-adventurer-5m-pro)
- [Nozzle Assembly for Adventurer 5M Series, FlashForge](https://flashforge.com/products/nozzle-assembly)
