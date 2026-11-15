# Pod v0: propuesta de ubicación de partes y carcasa de prueba

**Estado: propuesta del 14/11/2026.** Reúne lo definido en una sesión de trabajo sobre la mecánica del pod v0 (B-909). Nada de esto está colocado en KiCad, impreso ni medido: las posiciones son estimaciones hechas sobre [`pod-v0.md`](pod-v0.md) y [`pod-mecanica-produccion.md`](pod-mecanica-produccion.md), y cada número lleva esa reserva aunque no se repita en cada línea.

Los fuentes de la carcasa están en [`hardware/pod-v0/carcasa/`](../../hardware/pod-v0/carcasa/LEEME.md).

## 1. Decisiones

| Tema | Qué quedó | Quién lo decidió |
|---|---|---|
| Sensor de impactos | El pod va en la espalda, donde los placajes llegan atenuados: alcanza la IMU **LSM6DSV32X** (±32 g y giroscopio). No hace falta un acelerómetro de alto rango como el ADXL372 | Usuario (ya está en el BOM) |
| Tamaño de la placa | **50 × 70 mm**, el máximo que ya preveía `pod-v0.md`. En 45 × 65 mm no entran a la vez los keep-outs de las cuatro antenas | Propuesta aceptada |
| Batería | Celda **503048** (5 × 30 × 48 mm, unos 720 mAh), con el mismo espesor que la de 500–600 mAh | Propuesta aceptada. Falta pasarla al ADR 0105 y a `pod-f3.md` |
| Contactos de la base | **Inserto de cinco pines en la tapa inferior**, bajo el patch, con resortes internos hasta la placa. Base con el pod parado en una ranura | Propuesta aceptada. Falta pasarla a B-907 |
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
| Patch GNSS GVLB258.A | Centro (25; 17), 25 × 25 × 8,12 | Centrado a lo ancho. Zona `GNSS_ANTENA` de 30 × 30: x de 10 a 40, y de 2 a 32 |
| Cadena RF del GNSS | x de 19,5 a 22,5; y de 33 a 41 | ESD, SAW, LNA, SAW, atenuador y el 0 Ω de medición (sección 5) |
| LDO del GNSS | (21; 43,5) | |
| LC29H | x de 2 a 18; y de 33 a 45,2 | 16 × 12,2 mm, justo debajo de la zona del patch |
| U.FL de la Taoglas | (21,5; 33) | Rescate y referencia de banco |
| DWM3000 (sin montar) | x de 33 a 56; y de 32 a 45 | **Sobresale 6 mm del borde derecho** (sección 5) |
| BMD-340 | x de 0 a 15; y de 50 a 60,2 | Keep-out de 4,4 × 15: x de 0 a 4,4; y de 47,6 a 62,6 |
| IMU LSM6DSV32X | (27; 36) | A unos 2 mm del centro de la placa |
| Barómetro BMP581 | (45; 20) | Esquina libre junto al patch, lejos del cargador |
| NAND | (23; 56), 8 × 6 | |
| MAX17048 | (29; 50) | |
| TPS63900 | (29,5; 58) | |
| BQ25180 | (15; 65) | Con su cobre de 5 × 5. A 20 mm o más de la IMU y del MAX17048 |
| Ra-01SH | x de 31 a 48; y de 48 a 64 | Corrido para librar el tornillo de cierre de la esquina |
| U.FL de LoRa | (28,5; 62,5) | A la izquierda del Ra-01SH |
| LED RGB | (8,5; 2,2) | Borde de la nuca, debajo de la guía de luz |
| Tornillos de la placa | (6; 8), (44; 8) y (25; 66) | Agujeros M2 metalizados a tierra |
| J201 (QGNSS) y Tag-Connect | Sin ubicar | El Tag-Connect va en la cara de arriba y fuera de la celda (sección 8) |

### Cara de abajo

| Parte | Posición | Notas |
|---|---|---|
| Celda 503048 | x de 12 a 42; y de 14 a 62 | A 1 mm de la placa. Queda debajo del pin del patch: lleva despeje o lámina aislante |
| Resortes del inserto | x = 18; 21,5; 25; 28,5 y 32, en y = 7 | VBUS, D+, D−, GND y DETECT, a 3,5 mm de paso |
| Sensor Hall DRV5032FA | (40; 66) | Fuera de la celda, frente al imán del chaleco |
| J101, conector de la batería | (12; 66) | JST GH horizontal, cerca del BQ25180 |

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

- [ ] **Confirmar el contorno de la placa:** radio 5 mm y las cuatro muescas de las esquinas.
- [ ] **Ra-01SH y antena UWB:** al correr el Ra-01SH para librar el tornillo de cierre, quedó a unos 4 mm de la antena del DWM3000. Antes estaba a 9 mm. Solo afecta a la placa con UWB, pero hay que revisarlo.
- [ ] **Ubicar el Tag-Connect y J201.**
- [ ] **Posición del pin del patch** contra el DXF de Taoglas, y **altura del escalón** entre la base de 25 × 25 y el elemento de arriba, para sumar el apoyo de presión vertical en la tapa.

### Para medir con la primera placa

- [ ] **L5 con la tierra de 50 × 70 mm:** C/N0 de L1 y de L5 por separado contra la Taoglas.
- [ ] **Efecto de los tornillos** sobre el patch, la antena BLE y la FPC de LoRa (sección 5).
- [ ] **Distancia de detección del Hall:** el sensor queda a unos 8 mm de la cara de afuera, porque la batería está en el medio. Define el tamaño del imán del chaleco.
- [ ] **Luz del LED** a través de la guía, con el filamento real.

### Abiertos de diseño

- [ ] **Peso.** Las dos tapas son unos 24 g. Con los 18 g del patch y unos 14,5 g de la celda ya son unos 57 g sin la placa, contra la meta de 50 g. Bajar las paredes a 1,5 mm ahorra unos 6 g.
- [ ] **Estanqueidad:** junta en la unión, sello bajo las cabezas de los tornillos, sellado de la guía de luz y de los pines.
- [ ] **Rosca en nylon impreso:** aguanta pocos ciclos de abrir y cerrar.
- [ ] **Espesor.** La única forma de bajarlo a unos 17–18 mm es poner la batería arriba, al lado del patch, y los módulos abajo. Deja una masa metálica junto a la antena GNSS; se puede probar en el banco apoyando una celda junto al patch.
- [ ] **Cable de la FPC de LoRa:** recorre unos 10 mm hasta el U.FL. Conviene una variante con el cable más corto que los 100 mm.
- [ ] **Recuperación por MCUboot** sin botón (sección 8).
- [ ] **Medidas de los herrajes:** pines, resortes, insertos y membrana son genéricos. Se ajusta la carcasa a las partes que se compren.

### Para pasar a otros documentos

- [ ] ADR 0105 y `pod-f3.md`: celda 503048 y contactos por inserto.
- [ ] Tabla de autonomía de `pod-v0.md`.
- [ ] B-907: base con el pod parado y contactos de lámina.

## 10. Sugerencias de configuración de la IMU

No son decisiones; quedan como punto de partida para el firmware.

- Acelerómetro en ±32 g y giroscopio en 2000 dps o más.
- Muestreo de 400 a 960 Hz con FIFO en modo continuo, para guardar la ventana de cada impacto, y menor resolución para las métricas de carga.
- Interrupción de wake-up o de umbral para marcar colisiones sin procesar todo el flujo en el micro.
- SPI si se lee a alta frecuencia: I²C se queda corto con FIFO a casi 1 kHz.
- El chip cerca del centro de la placa, lejos de los bordes y del conector, con la placa firme contra la carcasa.

## 11. Correcciones hechas durante la sesión

- **La 603048 es de unos 900 mAh**, no de 600 como se dijo al principio.
- **Los tornillos de cierre entran por la cara del cuerpo.** La primera carcasa usaba los mismos tres tornillos para la placa y el cierre; después se separaron.
- **El nylon en la Adventurer 5M Pro** no está descartado: no figura en la lista oficial, pero la máquina admite algunos por temperatura.
- **Los tornillos de cierre de abajo quedan a unos 3 mm de las puntas de la FPC de LoRa**, no a 1 mm: el milímetro era la distancia al tetón de plástico.
- **Las primeras vistas de la carcasa estaban espejadas** de izquierda a derecha. Los STL estaban bien.

## 12. Fuentes

- [DWM3000, hoja de datos (Farnell)](https://farnell.com/datasheets/4509027.pdf)
- [DWM3000 antenna placement, foro de Qorvo](https://forum.qorvo.com/t/dwm3000-antenna-placement/21256)
- [Vertical/horizontal keep-out needed for DWM3000, foro de Qorvo](https://forum.qorvo.com/t/vertical-horizontal-keep-out-needed-for-dwm3000-module/21313)
- [Model List for LiPo and Li-ion](https://www.mikrocontroller.net/attachment/102205/Model_List_for_LiPO_and_Li-ion.pdf)
- [Adventurer 5M vs Adventurer 5M Pro, FlashForge](https://www.flashforge.com/blogs/news/adventurer-5m-vs-adventurer-5m-pro)
- [Nozzle Assembly for Adventurer 5M Series, FlashForge](https://flashforge.com/products/nozzle-assembly)
