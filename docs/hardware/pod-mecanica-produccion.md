# Pod: mecánica, producción y certificación

Complementa a `pod-v0.md` (diseño eléctrico) y a `pod-f3.md` (partes y costos). Sale de la revisión completa del plan de la Fase 3 (fabricación, mecánica, prueba y certificación) y de las decisiones del 08/11/2026 (ADR 0105):

- **Solo pines pogo** hacia afuera: el producto no lleva USB-C. El USB-C queda en las placas de desarrollo.
- **Batería de 500–600 mAh**, fijada ahora porque define el tamaño de la carcasa.
- **Usuarios: M19 y plantel superior** (adultos y jugadores de 17 y 18 años). Los menores siguen alcanzados por las reglas de privacidad y de seguridad (consentimiento de ubicación aparte, imán del chaleco).

Todo lo que dice **no verificado** se confirma antes de cerrar la decisión que depende de eso.

## 1. Envolvente mecánica antes de fijar el contorno de la placa

El contorno de 45 × 65 mm de `pod-v0.md` es provisorio. Antes de diseñar la placa se dibuja en CAD la envolvente 3D, con el apilado completo:

| Capa | Qué | Medida | Fuente |
|---|---|---|---|
| Tapa superior | Carcasa con la ventana de la antena GNSS | Pared de 1,5–2 mm (a validar en el impacto) | — |
| Antena GNSS | Taoglas AGVLB.25B: patch de 25 × 25 × 8 mm dentro de una **carcasa de 35 × 35 × 12 mm, 18 g**, afinada sobre un plano de tierra de **70 × 70 mm** | 35 × 35 × 12 mm | Hoja de Taoglas SPE-23-8-223-C |
| Placa | 4 capas, 1,6 mm, módulos de un solo lado | ≥ 45 × 65 mm (a revisar con la antena de 35 mm) | `pod-v0.md` |
| Batería | LiPo de 500–600 mAh con PCM y NTC | Unos 40 × 30 × 5 mm (**no verificado**, según la celda elegida) | Proveedor |
| Hueco de hinchazón | Espacio libre sobre la celda | ≥ 10 % del espesor de la celda (**no verificado**, lo pide el proveedor) | — |
| Antena LoRa | FPC de **≤ 45 mm** (por ejemplo Ebyte TX915-FPC-4510, 45 × 10 mm): la de 65 mm es tan larga como la placa | 45 × 10 mm | Ebyte (**no verificado**) |
| Tapa inferior | Cara contra el cuerpo, pines pogo y Hall | — | — |

**Metas** (a contrastar con Catapult Vector, cuyo peso y espesor **no están verificados** en esta revisión):

- Espesor total ≤ 15 mm y masa ≤ 50 g con el chaleco puesto. El Taoglas por sí solo pesa 18 g y mide 12 mm de alto: si la meta no cierra, la alternativa es un patch afinado para un plano de tierra chico.
- Bordes redondeados (radio ≥ 3 mm) y sin aristas: va sobre la columna, debajo de los tackles.
- La FPC de LoRa va pegada en la carcasa, en el borde opuesto a la antena GNSS, con su recorrido dibujado en el CAD (no a mano en cada pod).

El CAD se hace **antes** de diseñar la placa, junto con el bolsillo del chaleco (sección 3).

## 2. Estanqueidad, impacto y temperatura

**Meta: IP67** (sumergible 1 m durante 30 min) y resistencia al sudor y al protector solar.

- **Una sola interfaz externa: pines pogo.** Sin USB-C ni agujeros para botón. La guía de luz del LED va sellada (pieza transparente sobremoldeada o pegada con adhesivo estanco).
- **El MJF PA12 es poroso**: se sella con alisado por vapor o con un recubrimiento, o se pasa a un sobremoldeo cuando haya serie. Sin sellar no cumple IP67.
- **Ventilación del barómetro**: membrana de ePTFE con canal sellado hasta el sensor, **protegida de aplastamiento** por el bolsillo (rejilla o rebaje). El protector solar y los aceites ensucian la membrana y le hacen perder la clasificación: se prueba con sudor artificial.
- **Pines pogo**: chapados en oro, al ras de la carcasa, con junta alrededor. El VBUS del pod solo tiene tensión en la base (ver sección 5), así nunca queda energizado con sudor.
- **Prueba de estanqueidad en producción**: caída de presión de cada pod cerrado.

**Especificación ambiental** (se prueba con la carcasa antes de comprometer la electrónica):

| Prueba | Valor propuesto | Estado |
|---|---|---|
| Caída | 1,5 m sobre césped y sobre cemento, 6 caras y 4 esquinas | Propuesto |
| Compresión | Carga de un tackle sobre la columna (un jugador de 100 kg cayendo) | Valor a definir con datos (**no verificado**) |
| Vibración | Transporte en bolso | Propuesto |
| Temperatura de uso | −10 a +50 °C (sol sobre el chaleco, auto cerrado aparte) | Propuesto |
| Temperatura de carga | Ventana de la celda, aplicada con el NTC y el JEITA del BQ25180 (sección 4) | A confirmar con la celda |
| Agua | IP67 (inmersión) y rociado con sudor artificial | Propuesto |

**Reglamentos deportivos:** World Rugby Regulation 12 (equipamiento) y su anexo de dispositivos para usar en el cuerpo; reglas de la URBA para juveniles y de la federación de hockey (FIH y Confederación Argentina de Hockey). Los límites exactos (tamaño, forma, ubicación, aprobación) **no están verificados**: se preguntan antes del piloto, porque un dispositivo no aprobado no se puede usar en partido.

## 3. Seguridad del imán del chaleco

Los usuarios son M19 y plantel superior, pero un imán de neodimio suelto sigue siendo un riesgo (ingestión, pellizco) y hay jugadores de 17 años.

- **Imán encapsulado** (por ejemplo, dentro de un disco de silicona o TPU) y **retenido** (cosido en un bolsillo propio o pegado con refuerzo), nunca suelto en la tela.
- **Prueba de lavado**: ciclos de lavado y secado en las condiciones del club, midiendo el campo después.
- **Campo medido**: el que se necesita para detectar con el DRV5032FB a la distancia del bolsillo, y el que no dispara el Hall de otro pod cercano (bolsos, la base).
- **Tolerancia de alineación por talle**: el bolsillo fija la posición del pod frente al imán en todos los talles.
- **Envío**: verificar si el campo de 100+ imanes los vuelve carga peligrosa en avión (**no verificado**).

**Logística de los chalecos:** cantidad por plantel con repuestos, talles, proceso de lavado del club, pods que se llevan a casa y su devolución.

## 4. Batería y transporte

Una celda de hobby no sirve: sin informes, el courier no la acepta y la polaridad del conector suele venir invertida.

**Requisitos al proveedor:**

- Informe **UN38.3** e **IEC 62133** de la celda, y hoja de seguridad (MSDS).
- **PCM** (protección de la celda) incluido y verificado.
- **NTC de 10 kΩ** en la celda, cableado al TS del BQ25180.
- **Conector con clave y polaridad definida** por escrito: el BAT del BQ25180 y el LC29H no se protegen contra tensión invertida.
- Capacidad de **500–600 mAh**, medidas y tolerancias para el hueco de hinchazón.

**Carga:** ventana de temperatura de la celda aplicada por el NTC (JEITA del BQ25180, a configurar), corriente de carga de unos 300 mA (cargador lineal dentro de una carcasa cerrada; ver `pod-v0.md`), y control de temperatura dentro de la base.

**Transporte:** cada pod lleva una celda de unos 2 Wh **contenida en el equipo**. Se confirma con el courier el régimen aplicable (UN3481) para las 5 placas, los 10 del piloto y los 100.

## 5. Base de carga y descarga (B-907)

Una base de **20 lugares**.

- **Contactos**: pogo con **clave mecánica** (patrón de pads asimétrico) y **imanes con polaridad**, para que un pod girado no entre. Sin esa clave, un pod al revés pone 5 V en un pin de datos.
- **Por lugar**: load switch con límite de corriente, y VBUS habilitado **solo con un pod detectado** (así el contacto expuesto nunca queda energizado solo).
- **USB**: el nRF52840 es full-speed (12 Mbps). 20 pods × 49 MB son cerca de 1 GB: con un hub de un solo TT se comparte un canal de 12 Mbps (más de 15 min). Hacen falta **hubs multi-TT**, respetando la cantidad de niveles.
- **Fuente**: 20 pods a unos 300 mA son 6 A a 5 V, más los hubs y el host: fuente de unos 50 W con margen.
- **Host**: una mini-PC o Raspberry Pi por base, con **cola de subida local** y reintentos (100 pods suben unos 5 GB por día; con la subida de un club puede llevar horas).
- **Recuperación**: el watchdog del BQ25180 reinicia un pod colgado al conectarlo (ver `pod-v0.md`).
- Costo y lista de partes propios (sección 10).

## 6. Prueba de fin de línea y plantilla

Cada pod pasa una prueba antes de cerrarse y otra después.

| Prueba | Cómo | Límite |
|---|---|---|
| Autotest del firmware | Por USB en la plantilla de pogo | Todos los sensores responden |
| LoRa | Potencia conducida (antes de cerrar) y radiada (después) | A definir con el banco |
| GNSS | Caja blindada con repetidor, o cielo abierto | C/N0 mínimo a definir |
| Corriente | En cada estado (activo, espera, System OFF, envío) | Contra el presupuesto de `pod-v0.md` |
| IMU | Autotest del LSM6DSV320X | Pasa |
| Barómetro | Lectura contra una referencia | Dentro de la tolerancia |
| LED, Hall | Patrones, imán de prueba | Pasa |
| Estanqueidad | Caída de presión | Pasa |

- **Plantilla de pogo** barata con agujeros de alineación: la placa necesita **agujeros y fiduciales** para la plantilla (y para el Tag-Connect sin patas), y eso entra en el contorno **antes** de diseñarla.
- **Registro**: número de serie, resultado y valores medidos de cada pod.
- La antena (U.FL del Taoglas, FPC pegada) se arma con una plantilla y se verifica después de cerrar: un U.FL tiene pocos ciclos y sin retención puede salirse en un tackle (alivio de tensión y adhesivo).

## 7. Programación de producción

En este orden:

1. Primera grabación por SWD con **APPROTECT activado**, la UICR con `NFCPINS` y `PSELRESET` (P0.18 como reset) y el número de serie en la UICR.
2. **MCUboot con imágenes firmadas**; actualizaciones solo firmadas.
3. **Claves por pod** derivadas del identificador del chip (FICR) y de la clave del club, inyectadas en la base; nunca una clave única para todo el club. El diseño del protocolo y de las claves va en el ADR de flota y protocolo.
4. **Etiqueta** con el número de serie y un código QR, ligada al identificador del chip en la app.
5. **Modo envío** como último paso antes de embalar.
6. **VID/PID USB propio**: los de prueba de Nordic o Zephyr no sirven para distribuir.

Nota: hay revisiones viejas del nRF52840 con APPROTECT vulnerable a fallas inducidas; se pide la revisión de silicio actual (**no verificado** para el MDBT50Q).

## 8. Etiquetado y trazabilidad

- Número de serie, QR, revisión de hardware y lote en cada pod (grabado láser o etiqueta resistente al agua), con el lugar reservado en el dibujo de la carcasa.
- Marca de ENACOM y número de homologación, marcas de batería y de residuos electrónicos (WEEE).
- Declaraciones RoHS y REACH de los fabricantes de módulos y partes.

## 9. Fabricación en PCBWay

Antes de pedir, se manda **el diseño (no solo los Gerbers)** para una revisión de fabricación (DFM):

- **DSBGA de 0,4 mm** (BQ25180, TPS22916C): confirmar que lo arman; los rayos X ven poco en un DSBGA de 8 bolillas, así que se confía en la prueba funcional.
- **LGA** (LSM6DSV320X, BMP581) y los pads debajo del módulo Raytac (61 pads): plantilla de pasta escalonada o fina.
- **Panel**: rieles lejos de la antena del Raytac y de la zona libre del borde; sin V-score ni puentes al lado de la antena.
- **Una sola cara** con todo el SMT si se puede: el Hall en la cara de abajo obliga a una segunda pasada.
- Reglas de vías en el pad, puentes de máscara y apilado confirmados por PCBWay (las del `.kicad_dru` son valores iniciales).
- Flux sin limpieza debajo de los LGA.

## 10. Riesgos de la lista de partes y costo

**Registro de riesgos:**

| Parte | Riesgo | Acción |
|---|---|---|
| LSM6DSV320X | Poco stock (45 en LCSC) | Reservar cantidad para 100 + repuestos; respaldo ICM-42688-P + ADXL372 |
| Taoglas AGVLB.25B | Una sola fuente | Cotizar, o elegir una alternativa con plano de tierra chico |
| LC29H (EA) | Sin stock ni precio | Preguntar a Quectel |
| MDBT50Q-P1MV2 | Precio sin verificar; certificaciones a confirmar | Cotizar a 100 |
| XL-1615RGBC-RF | Parte poco conocida, hoja sin verificar | Alternativa conocida |
| DW3110 / DWM3000 | Sin stock | Sin montar en la v0 |
| W25N02 vs W25N04 | El costo usa la de 2 Gbit y la decisión es la de 4 Gbit | Cotizar la de 4 Gbit |
| Partes de alimentación | Todavía candidatas | Elegir y cotizar |

- **Cotizaciones vivas** a cantidad 5, 10 y 100, con plazos de entrega.
- Los números de parte son de LCSC, pero se fabrica en PCBWay: ellos compran en DigiKey o Mouser, con su recargo y sus mínimos.

**Planilla de costo de abajo hacia arriba**, con cortes por cantidad (5, 10, 100):

- **Por pod**: todas las partes, incluidas las que faltan en la tabla de `pod-f3.md` (buck-boost, LDO, load switches, traductores, SAW, cristal de 32 kHz, TVS, U.FL, contactos pogo), PCB, armado, carcasa sellada, batería certificada y etiqueta. Estimación realista: **US$ 85–95 a nivel de placa** (contra US$ 75–85 de `pod-f3.md`; **no verificado**).
- **Por chaleco**: chaleco con bolsillo e imán encapsulado.
- **Infraestructura por lugar**: base de 20 lugares con host, **gateway de exterior con GPS** (el RAK7268V2 es de interior y no tiene PPS de GPS para la baliza; un modelo de exterior o un gabinete, con alimentación, puesta a tierra y protección contra robo), base GNSS de la cancha (LG290P).
- **NRE**: vueltas de placa, plantilla de prueba, herramental de la carcasa si se sobremoldea, ensayo de laboratorio de ENACOM, importación y despachante.
- **Repuestos y rendimiento**: 10–15 % extra.
- **Posventa**: devoluciones, etiquetas, esfuerzo de firmware.

## 11. Cronograma con dos vueltas

Una primera placa con GNSS, LoRa y BLE en 4 capas rara vez sale bien de entrada. Se planean **dos vueltas (v0 y v0.1) antes del piloto**, con fechas en cada puerta:

1. **ENACOM y despachante** (sección 12), antes de pedir la v0.
2. **CAD de la envolvente** y prueba de la carcasa (estanqueidad, caída).
3. **Revisión previa al pedido** de la v0:
   - esquemático y diseño revisados por alguien que no sea el autor;
   - cada footprint comparado con el dibujo del fabricante (`hardware/lib/README.md`), con un segundo revisor para el LC29H, el MDBT50Q, el E22, el BQ25180, el LSM6DSV320X y el BMP581;
   - los puntos abiertos de `pod-v0.md` cerrados o aceptados por escrito;
   - revisión de fabricación de PCBWay (sección 9).
4. **v0**: 10 placas, 5 armadas, puesta en marcha de `pod-v0.md`.
5. **v0.1**: correcciones de la v0, con la carcasa real y las pruebas de fin de línea.
6. **Piloto de 10 pods** (B-910).
7. **Tanda de 100.**

Plazos a sumar: compra en DigiKey o Mouser, PCBWay (unas 3 semanas, **no verificado**), courier y aduana para placas con radio.

## 12. ENACOM y homologación antes del piloto

- Desde el **01/12/2026** el nuevo RAMATEL cuenta el **comodato como comercialización** (ADR 0105). Prestar 10 pods al club para el piloto ya es comercializar, y necesita **Homologación** con ensayo de laboratorio.
- **Antes de pedir la v0** se pregunta a ENACOM o a un laboratorio: potencia máxima en 915–928 MHz, si se puede usar canal fijo o hay que saltar de canal (eso cambia el protocolo, B-905), si alcanzan los módulos certificados, y qué régimen aplica al piloto.
- **Modelo de propiedad del piloto**: si los pods son del club (compra) o nuestros en préstamo (comodato) define el trámite. Se decide con el club.
- **Despachante**: opinión sobre la importación de equipos con radio, incluidos prototipos, kits de prueba, el gateway y la base.
