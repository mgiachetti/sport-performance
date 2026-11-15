# Pod v0: propuesta de ubicación de partes y carcasa de prueba

**Estado: propuesta del 14/11/2026.** Reúne lo definido en una sesión de trabajo sobre la mecánica del pod v0 (B-909). En KiCad están el contorno, los tornillos y las zonas (sección 4); las partes no están colocadas y nada se imprimió ni se midió: las posiciones de las partes son estimaciones hechas sobre [`pod-v0.md`](pod-v0.md) y [`pod-mecanica-produccion.md`](pod-mecanica-produccion.md), y cada número lleva esa reserva aunque no se repita en cada línea.

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

## 2. Sistema de coordenadas

- Origen en la esquina de arriba a la izquierda de la placa, vista desde el lado del patch.
- **x** de 0 a 50 mm. **y** de 0 a 70 mm: y = 0 es el borde de la nuca, con el chaleco puesto.
- **z** = 0 en la cara de abajo de la placa; +z hacia el patch, que es el lado del tackle. La cara de abajo apoya contra el cuerpo.

## 3. Ubicación de partes

Posiciones en mm. Donde hay un solo punto, es el centro.

### Cara de arriba

| Parte | Posición | Notas |
|---|---|---|
| Patch GNSS GVLB258.A | Centro (25; 17), 25 × 25 × 8,12 | Centrado a lo ancho. Zona `GNSS_ANTENA` de 30 × 30: x de 10 a 40, y de 2 a 32. **Pin hacia abajo, en (25; 19,5)**: footprint con rotación 0 (su origen es el pin). Así la alimentación sale por L4 hacia la cadena RF por el camino más corto (zona `PATCH_FEED`, sección 4) |
| Cadena RF del GNSS | x de 19,5 a 22,5; y de 33 a 41 | ESD, SAW, LNA, SAW, atenuador y el 0 Ω de medición (sección 5) |
| LDO del GNSS (`U104`) | (21; 43,5) | |
| Load switch del GNSS (`U105`, sin montar) | (24; 43,5) | Al lado del LDO, entre él y el riel del LC29H |
| LDO de V_BCKP (`U106`, TPS7A02) | (18,5; 47) | Junto al pin V_BCKP del LC29H y lejos del buck-boost |
| LC29H | x de 2 a 18; y de 33 a 45,2 | 16 × 12,2 mm, justo debajo de la zona del patch |
| U.FL de la Taoglas | (21,5; 33) | Rescate y referencia de banco |
| DWM3000 (sin montar) | x de 33 a 56; y de 32 a 45 | **Sobresale 6 mm del borde derecho** (sección 5) |
| BMD-340 | x de 0 a 15; y de 50 a 60,2 | Keep-out de 4,4 × 15: x de 0 a 4,4; y de 47,6 a 62,6 (zona `BLE_ANTENA`, 4,35 de ancho). Pads 13 y 14 (XL1, XL2) en (11,25; 59,5) y (11,8; 58,6); pads 66 a 68 (VBUS, D−, D+) en x = 14,35, y de 53,5 a 51,3 |
| Cristal de 32,768 kHz (`Y301`) y sus dos capacitores | (11,5; 61,5), los capacitores a cada lado | Pegado a los pads 13 y 14, con pistas de menos de 3 mm, tierra alrededor en L1 y nada que conmute debajo (clase GNSS_SENSITIVE) |
| IMU LSM6DSV32X | (27; 36) | A unos 2 mm del centro de la placa |
| Barómetro BMP581 | (45; 20) | Esquina libre junto al patch, lejos del cargador |
| NAND | (23; 56), 8 × 6 | |
| Load switch de la NAND (`U502`, sin montar) | (19,5; 52) | Entre el riel y la NAND |
| MAX17048 | (29; 50) | |
| TPS63900 | (29,5; 58) | |
| Load switch del LoRa (`U303`) | (30; 54) | Entre el MAX17048 y el TPS63900, al lado del pin de alimentación del Ra-01SH |
| BQ25180 | (15; 65) | Con su cobre de 5 × 5. A 20 mm o más de la IMU y del MAX17048 |
| Ra-01SH | x de 31 a 48; y de 48 a 64 | Corrido para librar el tornillo de cierre de la esquina |
| U.FL de LoRa | (28,5; 62,5) | A la izquierda del Ra-01SH |
| LED RGB | (8,5; 2,2) | Borde de la nuca, debajo de la guía de luz |
| Buzzer (`BZ301`, sin montar) | (44,5; 27) | 8,5 × 8,5 mm, fuera de la zona GNSS y arriba del DWM3000; si se monta, la tapa superior necesita un agujero de sonido |
| Tornillos de la placa | (6; 8), (44; 8) y (25; 66) | Agujeros M2 metalizados a tierra |
| Tag-Connect TC2030-NL (`J301`) | (47; 13,5), vertical | Cara de arriba, accesible con la tapa superior afuera. Fuera de la celda (x de 12 a 42), así los pines de alineación del cable, que atraviesan la placa, no tocan nada abajo; a unos 3 mm del agujero de `H304`. Los puntos de prueba SWD y de la consola al lado |
| J201, conector de QGNSS | (4,5; 29), vertical, abriendo hacia el borde izquierdo | JST SH de 4 vías para el banco (con la tapa afuera). Fuera de la zona GNSS y cerca de la UART del LC29H y de sus traductores de nivel |

### Cara de abajo

| Parte | Posición | Notas |
|---|---|---|
| Celda 503048 | x de 12 a 42; y de 14 a 62 | A 1 mm de la placa. Queda debajo del pin del patch: lleva despeje o lámina aislante |
| Resortes del inserto | x = 18; 21,5; 25; 28,5 y 32, en y = 7 | VBUS, D+, D−, GND y DETECT, a 3,5 mm de paso. El bloque de contactos de la tapa ocupa x de 17 a 33 e y de 4 a 10: lo de abajo queda afuera |
| TVS de VBUS (`D601`, SMF12A) | (14,5; 4,5) | Lo primero después del resorte de VBUS |
| eFuse TPS259470A (`U602`) y su divisor de OVLO y capacitor de dV/dt | (13; 9), sus pasivos de x = 10 a 16 | Entre el TVS y el riel que baja al BQ25180. A unos 4 mm del agujero de `H303` |
| ESD de D+ y D− (`U601`, USBLC6-2SC6) | (23,25; 11,8) | Justo debajo del bloque, entre los resortes de D+ y D− |
| Resistencia de DETECT (`R601`) y ESD de DETECT (`D602`) | (35; 7) | Al lado del resorte de DETECT, fuera del bloque |
| Punto de prueba de VBUS (`TP601`) | (11; 12,5) | |
| Sensor Hall DRV5032FA | (40; 66) | Fuera de la celda, frente al imán del chaleco |
| J101, conector de la batería | (12; 66) | JST GH horizontal, cerca del BQ25180. Trae la NTC de 10 kΩ de la celda por su pin 3 (TS del BQ25180): la NTC no va en la placa |

### En la carcasa

| Parte | Posición | Notas |
|---|---|---|
| FPC de LoRa (Molex 2111400100) | Pared interna del extremo de abajo, x de 6 a 44 | De pie, pegada a la tapa inferior |
| Tornillos de cierre | (2,6; 2,6), (47,4; 2,6), (2,6; 67,4) y (47,4; 67,4) | Uno por esquina |
| Ventilación del barómetro | Pared derecha, y = 20, z = 7,2 | Con rebaje para una membrana de 4 mm |
| Ranura del LED | Pared de la nuca, x de 5,5 a 11,5, z de 6,2 a 7,8 | 6 × 1,6 mm |

## 4. Contorno y fijación de la placa

- **Esquinas con radio 5 mm**, para que la carcasa pueda llevar esquinas de radio 7,5 mm.
- **Una muesca cóncava de radio 2,7 mm en cada esquina**, centrada a 2,6 mm de cada borde. Por ahí pasa el tetón del tornillo de cierre. Conviene definirla antes del layout, porque cambia el contorno.
- **Tornillos de la placa** en triángulo, para que la placa no quede forzada: (6; 8), (44; 8) y (25; 66). Los dos de arriba se corrieron 1 mm respecto de la primera propuesta, para dejar unos 2,5 mm de placa entre el agujero y la muesca.
- **Los tornillos de la placa no cierran la carcasa.** Se evaluó usar los mismos para las dos cosas y se descartó: los golpes sobre la tapa pasarían por la placa, el sello dependería del espesor de la placa y abrir la carcasa dejaría la placa suelta.
- **La batería no va rígida**: se apoya con espuma, con su hueco de hinchazón.
- **Ya está en la placa de KiCad** (`hardware/pod-v0/pod-v0.kicad_pcb`, 14/11/2026; origen (0; 0) = (100; 100)): el contorno con las cuatro muescas, los tres tornillos (`H303`, `H304` y `H305`, `MountingHole_2.2mm_M2_Pad_Via` metalizados a GND, bloqueados y también en el esquemático), el plano de GND de L2 (`L2_GND`) y las zonas `GNSS_ANTENA`, `PATCH_FEED`, `BLE_ANTENA`, `LORA_ANTENA` y `UWB_ANTENA` en sus lugares ([`hardware/README.md`](../../hardware/README.md), "Contorno, tornillos y zonas con nombre"). El DRC del CI y su prueba de reglas pasan con el contorno nuevo. Las partes no se ubicaron: el layout lo hace el usuario.
- **Zona `PATCH_FEED`** (solo L3): x de 23 a 27, y de 18 a 32,5. Con el pin hacia abajo, en (25; 19,5), la alimentación del patch sale por L4 unos 10 mm hasta pasar el borde de la cerámica (y = 29,5), sube a L1 por su vía de RF cerca de y = 31 y llega a la cadena RF en y = 33. Con el pin hacia arriba o hacia un costado el tramo de L4 sería más largo y cruzaría más plano.
- **`LORA_ANTENA`** quedó chica: x de 25,5 a 30,5, y de 60 a 70, sobre el U.FL del Ra-01SH y la salida de su cable hacia la pared de abajo, sin tapar el Ra-01SH (x de 31 a 48). La FPC no está en la placa.
- **`UWB_ANTENA`**: x de 46,2 a 50, y de 32 a 45. Con el DWM3000 sobresaliendo 6 mm a la derecha, unos 3,8 mm de la parte de su antena (9,8 mm desde la punta) quedan sobre la placa: ahí no va cobre en ninguna capa, igual que el keep-out del footprint. Supone la antena hacia afuera; si se gira el módulo, la zona se mueve con él.

## 5. Antenas

### Reglas y distancias

| Antena | Regla | Cómo queda |
|---|---|---|
| GNSS (patch) | Arriba, centrado, con tierra continua debajo | Es la mejor ubicación posible, pero **no cumple del todo**: la hoja pide 70 × 70 mm de tierra y la placa tiene 50 × 70. L5 se valida en el banco |
| BLE (BMD-340) | Al ras del borde, con 4,4 × 15 mm sin cobre en ninguna capa | Cumple. La celda queda a 7,6 mm |
| LoRa (FPC) | En el extremo opuesto al patch, a 40 mm o más | Cumple: unos 41 mm al borde del patch. La celda queda a unos 9 mm |
| UWB (DWM3000) | Antena fuera del borde de la placa, sin metal alrededor | Cumple con la antena sobresaliendo 6 mm, pero ver los pendientes |

- **El DWM3000 tiene una sola antena**, un monopolo cerámico en un extremo del módulo. La hoja da dos opciones: que la antena sobresalga del borde de la placa (figura 10, como en el DWM3000EVB) o dejar una separación de unos 10 mm sin cobre. Se eligió la primera, porque 10 mm sin cobre se llevan casi un cuarto del ancho y le quitan tierra al patch.
- **Carcasa aparte para el UWB.** Con la antena afuera, la carcasa pasaría de 55 a unos 67 mm de ancho. Como el UWB se monta en una sola placa, esa placa usa una carcasa propia y la normal no crece.
- **Qué extremo del DWM3000 es la antena** no está verificado contra el footprint.
- **Con el pod en la espalda, el cuerpo bloquea el UWB hacia adelante.** La orientación de la antena tiene que coincidir con la de los anchors.

### Cómo medir la antena GNSS

- **NanoVNA** (H4 o LiteVNA): mide el S11 del patch montado en la placa real, con la carcasa y sobre el cuerpo. Muestra si la tierra chica corre la resonancia de L5 (1176 MHz) o de L1 (1575 MHz).
- **openEMS**: simula el patch sobre la tierra exportada de KiCad. Taoglas no publica el dieléctrico, así que sirve para comparar variantes y no como valor absoluto.
- **QGNSS con el LC29H**: el C/N0 de L1 y de L5 por separado contra la Taoglas es la prueba final.
- **Un 0 Ω entre el nodo `GNSS_ANT` y el ESD/SAW.** Al sacarlo, el patch se mide solo por el U.FL. Hoy el U.FL entra al nodo por el capacitor de 100 pF, pero el nodo sigue unido a la cadena.

### Qué hay que medir con y sin

- Los tornillos de la placa de arriba, a unos 5–7 mm del patch.
- Los tornillos de cierre de abajo: quedan a unos 4 mm de la antena BLE y a unos 3 mm de las puntas de la FPC de LoRa. Si desafinan, se cambian por tornillos M2 de nylon sin tocar la carcasa.
- El tornillo de la placa de abajo, a unos 6 mm de la FPC de LoRa.
- Las escuadras de plástico que sostienen el patch y el adhesivo de sus esquinas.

## 6. Apilado, batería y contactos

### Apilado en z

| Capa | z (mm) |
|---|---|
| Cara de afuera, lado del tackle | 12,3 en la nuca; 7,8 en el extremo de abajo |
| Cara interna de arriba | 10,5 sobre el patch; 6,0 en el extremo de abajo |
| Tope del patch | 9,72 nominal; 10,12 con tolerancia |
| Placa | de 0 a 1,6 |
| Celda | de −1,0 a −6,2 |
| Cara interna de abajo | −7,0 |
| Cara de afuera, contra el cuerpo | −8,8 |

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

- **D+ y D−** salen de los resortes (y ≈ 7, cara de abajo) y llegan a los pads 66 a 68 del BMD-340 (x = 14,35; y de 51,3 a 53,5): unos **45 mm** de par. Van como **par de 90 Ω en una capa interna (L3)**, referido al plano de L2, con **GND a los dos lados** en L3 (relleno o pistas de guarda cosidas a L2 con vías cada pocos mm). Dentro de `GNSS_ANTENA` no puede haber vías que no sean de GND, así que el par sale de los resortes por L4 hasta pasar x = 10 (o y = 32), baja a L3 ahí y sigue por L3 a lo largo del lado izquierdo (x de 7 a 9, debajo del LC29H, lejos de sus señales GNSS_SENSITIVE) hasta subir a L1 al lado de los pads del BMD-340.
- **Lejos de la cadena del LNA y los SAW** (x de 19,5 a 22,5; y de 33 a 41) y de la alimentación del patch (`PATCH_FEED`): el par no pasa por debajo de ninguna de las dos.
- La geometría de 0,25/0,15 mm de `USB_90D` es la de L1. En L3, entre L2 y L4, la impedancia cambia: se recalcula con `hardware/tools/impedancia.py` y con la calculadora de PCBWay antes de rutear. Hasta 5 mm sin acoplar (la entrada a los resortes y al ESD) y 0,5 mm de diferencia de largo como máximo, como dice la regla.
- **VBUS y la carga**: el BQ25180 carga a 300–350 mA y la entrada se dimensiona para 1 A (clase `POWER_DOCK`). Desde el eFuse hasta el BQ25180 en (15; 65) son unos 60 mm: **0,5 mm o más en L1 o L4** (35 µm; unos 60 mΩ, 30 mV a 0,5 A) o **1,5 mm en las internas**. Lo natural es L4, por debajo de la celda (que queda a 1 mm, con su lámina), sin vías dentro de `GNSS_ANTENA`. El retorno es el plano de L2.
- **Alternativa a evaluar en el layout: el inserto en el extremo de abajo.** D+, D− y VBUS quedarían a unos 10–15 mm del BMD-340 y del BQ25180, sin cruzar la placa ni pasar cerca de la cadena RF. A cambio, los contactos irían al punto más bajo con el chaleco puesto (más sudor), junto a la FPC de LoRa, el Hall y el tornillo de abajo, y la carcasa se tendría que regenerar. Si el ruteo de arriba no cierra, se evalúa esta opción.

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
- [ ] **Ra-01SH y antena UWB:** al correr el Ra-01SH para librar el tornillo de cierre, quedó a unos 4 mm de la antena del DWM3000. Antes estaba a 9 mm. Solo afecta a la placa con UWB, pero hay que revisarlo.
- [x] **Ubicar el Tag-Connect y J201** (propuesta en la sección 3, a confirmar en el layout).
- [ ] **Posición del pin del patch** contra el DXF de Taoglas, y **altura del escalón** entre la base de 25 × 25 y el elemento de arriba, para sumar el apoyo de presión vertical en la tapa.

### Para medir con la primera placa

- [ ] **L5 con la tierra de 50 × 70 mm:** C/N0 de L1 y de L5 por separado contra la Taoglas.
- [ ] **Efecto de los tornillos** sobre el patch, la antena BLE y la FPC de LoRa (sección 5).
- [ ] **Distancia de detección del Hall:** el sensor queda a unos 8 mm de la cara de afuera, porque la batería está en el medio. Define el tamaño del imán del chaleco.
- [ ] **Luz del LED** a través de la guía, con el filamento real.

### Abiertos de diseño

- [ ] **Peso: unos 70 g contra la meta de 50 g** (estimación). Las dos tapas son unos 24 g, el patch 17,5 g, la celda unos 14,5 g y la placa de 50 × 70 × 1,6 mm de 4 capas unos 10 g desnuda y 14–16 g armada. Palancas:
  - **Paredes de 1,5 mm**: unos 6 g menos. Pendiente del usuario; el generador sigue en 2 mm.
  - **Kyocera AVX 1005620** (25 × 25 × 4,16 mm, 9,6 g, L1 centrada en 1584 ± 2 MHz y L5 en 1176 ± 2 MHz sobre 70 × 70 mm, 3,3/0,4 dBic en el cenit en L1/L5; DigiKey 56, 12 semanas): unos 8 g menos y 4 mm menos de alto. **Comprar 5** para compararla en el banco con QGNSS contra el GVLB258.A. Tiene la misma base de 25 × 25 mm, pero **el pin no está en el mismo lugar**: según el dibujo de su hoja (TDS-ANT-0088 rev. 1) está a 10,70 mm de un borde (1,8 mm del centro) y centrado en el otro eje, contra 2,5 mm del GVLB258.A, con un pin de Ø0,82 mm que sobresale 3 mm. Con el mismo footprint no entra: hace falta un segundo agujero (o un footprint propio) en el lugar de su pin, y verificar hacia qué lado queda respecto del chaflán. La hoja no da las eficiencias; DigiKey lista 7,85 mm de alto máximo, que no coincide con los 4,16 mm de la hoja.
  - **Antenas chip de L1 y L5**: solo si el usuario reabre la decisión del patch apilado (con chips se pierde ganancia y la tierra chica pesa más).
  - Comparación del 14/11/2026 que dejó el **GVLB258.A** (hoja rev. I): 17,5 g netos, eficiencia 50,94 % en L5 y 70,44 % en L1, ganancia pico 3,29 dBi en L5 y 4,30 dBi en L1. El **GVLB208.A** (hoja SPE-25-8-318-B): 16 g, pin a 1,2 mm del centro, eficiencia 49,8 % en L5 y 50,2 % en L1, ganancia pico 0,4 dBi en L5 y 1,5 dBi en L1, US$ 4,75 más caro y sin stock suficiente (DigiKey 271, 16 semanas).
- [ ] **Estanqueidad:** junta en la unión, sello bajo las cabezas de los tornillos, sellado de la guía de luz y de los pines.
- [ ] **Rosca en nylon impreso:** aguanta pocos ciclos de abrir y cerrar.
- [ ] **Espesor.** La única forma de bajarlo a unos 17–18 mm es poner la batería arriba, al lado del patch, y los módulos abajo. Deja una masa metálica junto a la antena GNSS; se puede probar en el banco apoyando una celda junto al patch.
- [ ] **Cable de la FPC de LoRa:** recorre unos 10 mm hasta el U.FL. Conviene una variante con el cable más corto que los 100 mm.
- [ ] **Recuperación por MCUboot** sin botón (sección 8).
- [ ] **Medidas de los herrajes:** pines, resortes, insertos y membrana son genéricos. Se ajusta la carcasa a las partes que se compren.

### Para pasar a otros documentos

- [x] ADR 0105 y `pod-f3.md`: celda 503048 y contactos por inserto (14/11/2026).
- [x] Tabla de autonomía de `pod-v0.md` (columna de 720 mAh).
- [x] B-907: base con el pod parado y contactos de lámina.

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
- **Los tornillos de cierre de abajo quedan a unos 3 mm de las puntas de la FPC de LoRa**, no a 1 mm: el milímetro era la distancia al tetón de plástico.
- **El muestreo de la IMU no puede ser de 400 Hz** en el modo normal: los ODR de la familia LSM6DSV van de a doble desde 7,5 Hz (sección 10).
- **Las primeras vistas de la carcasa estaban espejadas** de izquierda a derecha. Los STL estaban bien.

## 12. Fuentes

- [Kyocera AVX 1005620, hoja de datos TDS-ANT-0088 rev. 1](https://datasheets.kyocera-avx.com/1005620.pdf)
- [Driver `lsm6dsv16x` de Zephyr, tabla de ODR por modo](https://github.com/zephyrproject-rtos/zephyr/blob/main/drivers/sensor/st/lsm6dsv16x/lsm6dsv16x.c) (misma familia y registro `ODR_XL` que la LSM6DSV32X, ST DS13511)
- [DWM3000, hoja de datos (Farnell)](https://farnell.com/datasheets/4509027.pdf)
- [DWM3000 antenna placement, foro de Qorvo](https://forum.qorvo.com/t/dwm3000-antenna-placement/21256)
- [Vertical/horizontal keep-out needed for DWM3000, foro de Qorvo](https://forum.qorvo.com/t/vertical-horizontal-keep-out-needed-for-dwm3000-module/21313)
- [Model List for LiPo and Li-ion](https://www.mikrocontroller.net/attachment/102205/Model_List_for_LiPO_and_Li-ion.pdf)
- [Adventurer 5M vs Adventurer 5M Pro, FlashForge](https://www.flashforge.com/blogs/news/adventurer-5m-vs-adventurer-5m-pro)
- [Nozzle Assembly for Adventurer 5M Series, FlashForge](https://flashforge.com/products/nozzle-assembly)
