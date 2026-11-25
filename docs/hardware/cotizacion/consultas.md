# Consultas y pedidos de cotización del pod v0 (B-909)

Borradores listos para mandar, parte del paquete de cotización ([`costos.md`](costos.md), [`pedido-pcbway.md`](pedido-pcbway.md)). Van en inglés a los proveedores de afuera y en castellano a los de acá. Antes de mandar cada uno: completar lo que está entre corchetes (nombre, empresa, CUIT) y adjuntar lo que dice "Adjuntos". Las direcciones que dicen **no verificada** salen de una búsqueda y hay que confirmarlas en la página del proveedor.

Datos del pod que se repiten: placa de 6 capas de unos 50 × 70 mm, nRF52840 en un u-blox BMD-340, LoRa Ai-Thinker Ra-01SH (SX1262, 915 MHz), GNSS Quectel LC29H(AA) o (EA) L1 + L5 con patch pasivo apilado Taoglas GVLB258.A en la placa, IMU LSM6DSV32X, LiPo de 500–600 mAh. Prototipos: 5 armados, después 10 de piloto y 100 de serie, para un club de rugby (lo usa un jugador en un chaleco, entre los omóplatos).

| # | A quién | Para qué | Idioma | Dirección |
|---|---|---|---|---|
| 1 | Raytac | **Ya no va** (09/11/2026: el MCU es el u-blox BMD-340, con el keep-out en su hoja). Queda como registro | Inglés | service@raytac.com (**no verificada**), con copia a sales@raytac.com (la que publica [su página de contacto](https://www.raytac.com/contact/)) |
| 2 | Proveedor de baterías | Cotización de la celda con PCM, NTC, conector GH e informes | Inglés | Dos o tres proveedores a elegir |
| 3 | ENACOM | Potencia, salto de canal y homologación en 915–928 MHz | Castellano | hertz@enacom.gob.ar (homologación y RAMATEL; de un aviso de 2019, **no verificada** hoy) o un trámite por TAD |
| 4 | Despachante de aduana | Importación de prototipos con radio y baterías | Castellano | Al que se elija |
| 5 | Quectel | Notas de aplicación, firmware y stock de la LC29H(EA) | Inglés | support@quectel.com (la que figura en el Hardware Design del LC29H) |
| 6 | Taoglas | Ajuste del GVLB258.A en una tierra chica y su DXF | Inglés | Formulario de [taoglas.com/support-center](https://taoglas.com/support-center) (no publican un mail) |
| 7 | Ebyte / Ai-Thinker y LCSC | Ebyte **ya no va** (09/11/2026: el módulo es el Ra-01SH; desde el 15/11/2026 la antena LoRa es la antena chip M620720 en la placa). **Ai-Thinker / LCSC**: Ra-01SH con o sin IPEX, cristal y certificados (abajo) | Inglés | support@cdebyte.com (de los manuales de Ebyte, **no verificada**) |
| 8 | Distribuidores (Mouser, Arrow, ST, TI, LCSC) | Stock y reservas de las partes escasas | Inglés | Por sus portales; mail genérico abajo |
| 9 | KYOCERA AVX (soporte de aplicaciones de antenas) | Revisión de la ubicación de la antena chip M620720 en el borde corto, su footprint CAD y un punto de partida para la adaptación | Inglés | antenna.info@kyocera-avx.com (la que figura al pie de la hoja TDS-ANT-0048 rev. 4) |

## 1. Raytac: revisión del layout

Raytac revisa el esquemático y el layout de las placas que usan sus módulos (que sea un servicio gratis y formal es **no verificado**: se pregunta en el mismo mail). Mandarlo **con la placa ubicada y ruteada**, antes de pedir a PCBWay.

**Adjuntos:** PDF del esquemático (la hoja `mcu_radio` alcanza, mejor completo), capturas de las capas alrededor del módulo, el `.kicad_pcb` o los Gerbers, y el apilado.

> **Subject:** Layout review request: MDBT50Q-P1MV2 on a 6-layer wearable board
>
> Hello Raytac team,
>
> We are designing a wearable GNSS + IMU tracker for team sports around the MDBT50Q-P1MV2 (nRF52840, PCB antenna). We plan a first run of 5 prototypes, then 10 and 100 units. We would appreciate your free layout review before we order the boards.
>
> Design summary:
> - 6-layer, 1.6 mm FR4 board, about 50 × 70 mm. L2 and L5 are solid ground planes.
> - MDBT50Q-P1MV2 on the left board edge, antenna tip pointing out, with a keep-out of 3.5 × 11 mm in all four layers following section 2.3 of the datasheet (Ver. K). The first pads of the module start 3.8 mm from the antenna end in your footprint.
> - Normal voltage mode: VDD and VDDH at 3.4 V from a buck-boost, DCCH not connected. External 32.768 kHz crystal (Micro Crystal CM8V-T1A, CL 12.5 pF, ESR 70 kΩ, 18 pF load caps).
> - USB through dock pads (D+/D−, 90 Ω pair), no USB connector.
> - Next to it: a LoRa SX1262 module at 915 MHz (22 dBm) with its own antenna at the opposite edge, and a GNSS L1/L5 receiver with a ceramic patch on top of the board. The board sits inside a plastic enclosure on the player's back.
>
> Questions:
> 1. Is the 3.5 mm keep-out depth enough with the module flush to the edge, or do you recommend a larger clearance or moving the module inwards?
> 2. Does the FCC ID SH6MDBT50Q (and CE/IC) cover the MDBT50Q-P1MV2, and can you send the certificates and test reports for it?
> 3. What antenna detuning should we expect with a human body 10–20 mm behind the board, and do you recommend the -U1MV2 (U.FL) variant for that case? We would also need the -U1MV2 datasheet and footprint (Ver. K does not cover it).
> 4. We would like to order 120 pcs of the MDBT50Q-P1MV2 (5 for the prototypes now, the rest for the pilot and the first series): please quote price and lead time for 120 and 500 pcs, and tell us if you ship directly or through a distributor (LCSC shows no stock today). As a fallback we would use the MDBT50Q-1MV2: is it a drop-in replacement on the same footprint?
> 5. Silicon revision of the nRF52840 in current production lots (we rely on the APPROTECT fixes of the newer revisions).
>
> Attached: schematic, layout of the four layers around the module and stack-up.
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

## 2. Batería: pedido de cotización

**A quién:** proveedores de celdas con informes (por ejemplo, fabricantes chinos de LiPo prismáticas con UN38.3 propio; el que se elija). Mandar el mismo texto a dos o tres.

**Adjuntos:** dibujo con el hueco disponible en la carcasa (largo, ancho, espesor máximo con el margen de hinchazón) y el conector con la polaridad marcada.

> **Subject:** RFQ: 500–600 mAh protected LiPo with NTC and JST GH connector, 10 / 100 / 500 pcs
>
> Hello,
>
> We are looking for a single-cell LiPo pouch battery for a wearable sports tracker. Please quote samples (10 pcs) and 100 / 500 pcs.
>
> Requirements:
> - Capacity 500–600 mAh, 3.7 V nominal, 4.2 V charge. Maximum envelope [L × W × T] mm including the PCM; please state the nominal and maximum thickness and the mass.
> - Charge at 0.5 C (300 mA), discharge peaks of 250 mA; operating temperature −10 to 50 °C; please state the charge temperature window.
> - Protection circuit (PCM) included: overcharge, over-discharge, over-current and short-circuit, with its thresholds and quiescent current.
> - 10 kΩ NTC (B 3380–3435 K) on the cell, wired to the connector.
> - Connector JST GH 1.25 mm, 3 positions, housing GHR-03V-S with SSHL-002T-P0.2 contacts, wire length [50] mm. Pin 1 = BAT+, pin 2 = GND (BAT−), pin 3 = NTC. Please confirm the pin order in writing with a drawing: a reversed connector would damage our board.
> - Documents: UN38.3 test summary, IEC 62133-2 test report (or certificate), MSDS, and the cell datasheet with cycle life and self-discharge.
> - Shipping to Argentina by courier (UN3481 when packed with equipment, UN3480 for loose samples): please tell us how you ship samples.
>
> Please include unit price, tooling or NRE if any, MOQ, lead time for samples and production, and the cell manufacturer if you are not the cell maker.
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

## 3. ENACOM: consulta técnica

**Por dónde:** hertz@enacom.gob.ar (la dirección del sistema de homologación y RAMATEL, de un aviso del 10/04/2019: **no verificada** hoy) o una presentación por TAD; si responde un laboratorio reconocido, sirve igual. Mandarla **antes de pedir la v0** (`pod-mecanica-produccion.md`, sección 12).

**Lo que ya se sabe** (a confirmar en la respuesta): la Res. 581/2018 declaró 915–928 MHz de uso compartido sin autorización previa; los requisitos técnicos de los dispositivos de baja potencia están en la norma **ENACOM-Q2-60.14 V20.1**, adoptada por la Res. ENACOM 551/2021 (sección 5.4.5 para 915–928 MHz; el límite de potencia, **no verificado**); y la Res. ENACOM 57/2026 rehízo la homologación con certificadoras y laboratorios registrados. La fecha de vigencia del RAMATEL nuevo difiere entre fuentes (01/09/2026 en un resumen de Baker McKenzie, 01/12/2026 según la Res. 843/2026 citada en el ADR 0105): se pregunta.

> **Asunto:** Consulta sobre equipos de corto alcance en 915–928 MHz y homologación para préstamo en comodato
>
> Señores del ENACOM:
>
> Estamos desarrollando un dispositivo para monitorear la carga física de jugadores de rugby: un equipo de unos 50 g que el jugador lleva en un chaleco durante los entrenamientos y partidos. Lleva un receptor GNSS, sensores inerciales y dos radios en módulos certificados por la FCC: un transceptor LoRa (Semtech SX1262, módulo Ebyte E22-900M22S) en 915–928 MHz y Bluetooth Low Energy de 2,4 GHz (Nordic nRF52840, módulo Raytac MDBT50Q). Cada equipo transmite paquetes cortos (unos 30 bytes cada 1 a 2 segundos) a un concentrador en la cancha. Se fabricarían 10 equipos para un piloto con un club y después unos 100.
>
> Les consultamos:
>
> 1. ¿Qué potencia máxima (conducida y radiada, en dBm o mW PIRE) se admite en 915–928 MHz para este uso? Entendemos que la banda es de uso compartido según la Res. 581/2018 y que aplica la norma ENACOM-Q2-60.14 (Res. 551/2021): ¿es la versión vigente?
> 2. ¿Se exige salto de frecuencia, un tiempo máximo de permanencia por canal (dwell time) o un ciclo de trabajo? ¿Se puede usar un canal fijo con baja potencia?
> 3. Con el nuevo régimen de la Res. 57/2026 (¿desde qué fecha rige el RAMATEL nuevo?), entregar los equipos al club en **comodato** cuenta como comercialización. ¿Qué régimen corresponde (Homologación o Inscripción) para el piloto de 10 equipos y para la serie de 100? ¿Alcanzan los certificados FCC/CE de los módulos o se ensaya el equipo final?
> 4. ¿Qué laboratorios reconocidos pueden hacer los ensayos, qué documentación hay que presentar y cuáles son los plazos y aranceles aproximados?
> 5. ¿Hay un régimen para prototipos o ensayos (equipos que no se comercializan) mientras se desarrolla?
>
> Quedamos a disposición para enviar las hojas de datos de los módulos y el diagrama del equipo.
>
> Saludos cordiales,
> [Nombre] · [Empresa] · [CUIT] · [Teléfono]

## 4. Despachante: importación de prototipos

> **Asunto:** Consulta por importación de prototipos electrónicos con radio y baterías de litio
>
> Hola, [nombre]:
>
> Vamos a importar prototipos de un equipo electrónico que estamos desarrollando (un rastreador deportivo con GNSS, Bluetooth y LoRa) y queremos saber cómo conviene traerlo. Los envíos previstos:
>
> 1. **Placas armadas desde China (PCBWay)**: 5 placas armadas y 5 desnudas, unos US$ 1.000–1.500 en total y menos de 1 kg. Llevan módulos de radio (Bluetooth de 2,4 GHz y LoRa de 915 MHz) **sin batería**.
> 2. **Componentes y antenas desde EE. UU. (DigiKey)**: unos US$ 200–400.
> 3. **Baterías de litio sueltas** (10 celdas de 2 Wh, muestras del proveedor): UN3480.
> 4. Después, un piloto de 10 equipos terminados y una serie de 100, cada uno con su batería adentro (UN3481).
>
> Preguntas:
>
> 1. ¿Conviene el régimen de courier o una importación por despacho común? ¿Hasta qué valor y peso entra cada envío por courier y qué impuestos pagaría (derechos, tasa, IVA, percepciones)?
> 2. ¿Los equipos con radio necesitan la homologación o algún permiso de ENACOM para ingresar, aunque sean prototipos que no se venden? ¿Cómo se declara un prototipo?
> 3. ¿Qué posiciones arancelarias corresponden a las placas armadas, a los módulos de radio sueltos y a los equipos terminados?
> 4. ¿Cómo se traen las baterías sueltas (UN3480) y los equipos con batería (UN3481)? ¿Algún courier las acepta?
> 5. ¿Hace falta alguna licencia o certificado (seguridad eléctrica, RoHS) para estos productos?
> 6. ¿Cuáles son sus honorarios por cada envío y los plazos habituales?
>
> Gracias,
> [Nombre] · [Empresa] · [CUIT]

## 5. Quectel: LC29H

> **Subject:** LC29H(AA)/(EA): application notes, firmware release notes and EA availability
>
> Hello Quectel support,
>
> We are integrating the LC29H(AA) in a wearable sports tracker (5 prototypes now, then 10 and 100 units), with the LC29H(EA) in the same footprint for live RTK. Our design follows the LC29H Series Hardware Design V1.4 and the LC29H&LC79H Series GNSS Protocol Specification V1.5. We use a passive stacked L1/L5 patch with our own SAW + LNA + SAW chain (total gain about 13 dB at L1 and 16 dB at L5 at RF_IN).
>
> Could you please send or confirm:
> 1. The latest LC29H Hardware Design and Protocol Specification versions, and whether the pin table (figure 4, table 5) is unchanged for the AA and EA variants.
> 2. The application notes for AGNSS (EPO / assisted start) and for the DR and RTK functions of the LC29H, and the firmware release notes of the current AA and EA firmware.
> 3. For the AA: the RTCM3 MSM output rate actually supported (1 Hz or 10 Hz), whether it includes L5 observations, and whether the 10 Hz PVT keeps running while MSM7 is enabled.
> 4. Recommendations for a passive antenna design: gain window at RF_IN, the AGC/jamming indicators to read, and whether you can review our RF chain schematic.
> 5. LC29H(EA): price and stock at 10 / 100 / 500 units, lead time, and authorised distributors that ship to Argentina. Same for LC29H(AA) at 100 / 500.
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

## 6. Taoglas: GVLB258.A en una tierra chica

Desde el 09/11/2026 el patch es el **GVLB258.A**. Además del ajuste, se pide su **DXF**: la posición del pin del footprint sale hoy del dibujo de la sección 3 de la hoja.

> **Subject:** GVLB258.A tuning on a 50 × 70 mm ground plane (L1 + L5) and its DXF
>
> Hello Taoglas team,
>
> We plan to use the GVLB258.A stacked L1/L5 passive patch (25 × 25 × 8.12 mm) on a 6-layer, 50 × 70 mm board inside a plastic enclosure worn on a player's back, followed by our own SAW + LNA chain. The datasheet characterises the patch on a 70 × 70 mm ground plane, and we expect L5 to detune first on our smaller plane. Our bench reference is your AGVLB.25B.07.0060A.
>
> Questions:
> 1. What centre-frequency shift and efficiency loss do you expect at L1 and L5 on a 50 × 70 mm ground plane (patch centred near the top edge), and with a body 10–20 mm behind the board?
> 2. Do you offer the GVLB258.A tuned for a smaller ground plane, or a variant with a different tuning, and at what MOQ?
> 3. Your CSA.20 (passive antenna test, matching and fine tuning) and ISA.10 (integration review) services look like what we need: what do they cost, what do we send (2 sample boards?), and how long do they take?
> 4. The DXF (or STEP) of the GVLB258.A footprint: we placed the pin 2.5 mm from the centre from the drawing in section 3 and would like to confirm it. Also the soldering profile for the pin, whether the patch can go through reflow, and how you recommend clamping it in an enclosure that sees 30–50 g impacts.
> 5. Price and lead time at 10 / 100 / 500 units (DigiKey shows 895 in stock today).
> 6. A short-pin version for our run of 100: the pin comes out 2.4 ± 0.4 mm below the ceramic, so through our 1.6 mm board it protrudes about 0.8 mm (up to 1.36 mm) over a battery that sits 1 mm below. Can you supply the GVLB258.A with the pin cut to about 1.6–1.8 mm (flush with the board after soldering), and at what MOQ and cost? Otherwise, is trimming the pin before mounting acceptable for you?
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

## 7. Ai-Thinker y LCSC: Ra-01SH (y Ebyte, ya no va)

Desde el 09/11/2026 el LoRa es el **Ai-Thinker Ra-01SH** (LCSC C2764087). Su hoja muestra un IPEX propio en el mismo nodo que el pad 1 (`pod-v0.md`, "Salida de RF del Ra-01SH y su IPEX"). Por el portal de LCSC o a Ai-Thinker (support@aithinker.com, de su hoja):

> **Subject:** Ra-01SH: version without the IPEX connector, crystal tolerance and certificates
>
> Hello,
>
> We are using the Ra-01SH (LCSC C2764087) at 915 MHz with the RF taken from pad 1 (ANT) to our own U.FL connector.
> 1. Does the module ship with the on-module IPEX socket fitted? Is there a version without it (or with pad 1 disconnected from the IPEX), and its part number at LCSC?
> 2. Frequency tolerance and temperature drift of the 32 MHz crystal (the module has no TCXO).
> 3. Sleep current, and the FCC / CE (RED) certificate numbers of the Ra-01SH.
> 4. Price for 150 and 500 pcs.
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

El mail de Ebyte de abajo **ya no va**; queda como registro (la TX915-FPC-4510 no tenía precio ni stock en LCSC).

> **Subject:** RFQ: TX915-FPC-4510 antenna (and E22-900M22S) for a wearable, 10 / 100 / 500 pcs
>
> Hello Ebyte team,
>
> We use the E22-900M22S in a wearable tracker and plan to use your TX915-FPC-4510 flexible antenna (915 MHz, 45 × 10 mm, IPEX), stuck to the inside of a plastic enclosure worn on a player's back. Could you please send:
> 1. Price, MOQ and lead time of the TX915-FPC-4510 at 10, 100 and 500 pcs, with the cable length and connector options (U.FL / IPEX MHF1).
> 2. Its datasheet: gain, efficiency and VSWR at 915–928 MHz, and the recommended mounting (distance to the body, to metal and to the PCB ground).
> 3. The E22-900M22S at 100 and 500 pcs, and its full datasheet (TCXO control voltage for `SetDIO3AsTCXOCtrl`, pin 12 function, and the FCC/CE certificates).
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina

## 8. Distribuidores: partes escasas

Plan de stock en [`costos.md`](costos.md) y auditoría parte por parte en [`stock.md`](stock.md) (09/11/2026). Desde el 09/11/2026 todo se compra por los portales (plan vigente en [`costos.md`](costos.md)): **150 LSM6DSV32XTR**, **150 DRV5032FADBZR**, **150 BGA525N6E6327XTSA1** y **150 TPS22919DCKR en LCSC**; **150 BMD-340-A-R**, **150 LC29HAAMD**, **150 GVLB258.A** y **150 TPS7A2032PDBVR en DigiKey**. El mail de abajo (de antes del rediseño) queda solo para una segunda fuente del BGA525N6 en Mouser o Arrow:

> **Subject:** Stock and lead time: LSM6DSV320XTR and BGA525N6E6327XTSA1, 130–150 pcs
>
> Hello,
>
> Could you please confirm stock, factory lead time and price for:
> - STMicroelectronics LSM6DSV320XTR: 110 pcs (cut tape), and whether a backorder is possible with a confirmed date.
> - Infineon BGA525N6E6327XTSA1: 150 pcs (cut tape).
>
> We can take a partial delivery now (5–10 pcs) and the rest later. Shipping to Buenos Aires, Argentina.
>
> Best regards,
> [Name] · [Company]

## 9. KYOCERA AVX: antena chip M620720 en el borde corto

Desde el 15/11/2026 la antena LoRa es la **M620720** en la placa (ADR 0105, "Registro de decisiones"). La hoja muestra la antena en el **borde largo** de una placa de 40 × 100 mm; la nuestra va en el **borde corto** de una de 50 × 70, y el footprint se dibujó desde la imagen de la p.5 (no hay CAD en la hoja). Adjuntos: el dibujo de la zona (captura de KiCad con la zona `LORA_ANTENA`, el Ra-01SH, la alimentación y la celda debajo) y el apilado de 6 capas.

> **Subject:** M620720 layout review on a 50 × 70 mm 6-layer board (short edge), CAD footprint and matching
>
> Hello KYOCERA AVX antenna team,
>
> We are designing a wearable GNSS tracker for team sports with an SX1262 LoRa radio at 915–928 MHz and plan to use your M620720 ceramic chip antenna (datasheet TDS-ANT-0048 rev. 4). The pod is worn between the shoulder blades in a vest pocket, inside a plastic (PA12) enclosure about 2 mm thick.
>
> Our board is 6 layers, 50 × 70 mm, 1.6 mm thick (FR4, the second and fifth layers are solid ground planes). Because of the other antennas (a stacked L1/L5 GNSS patch on the opposite end, a BLE module on a long edge), the M620720 can only go on the **short (50 mm) edge**, close to a corner:
> - Antenna on the bottom edge, rotated 180° from the drawing on page 5 (not mirrored): the feed end (pin 1) on the right, 8.4 mm from the right edge, and the pin 3 copper arm running left along the edge to P1. Copper 0.3 mm from the board edge (your demo board has 0.1 mm; our fab's minimum is 0.3 mm).
> - Clearance with no metal on any layer: 16.0 × 10.95 mm (your 14.9 + 1.1 mm along the edge and 10.65 mm deep, plus our 0.2 mm), from x = 26.7 to 42.7 mm along the 50 mm edge. On the P1 side (left) the ground is the full plane, with a grounded M2 mounting hole (4.4 mm pad) 0.5 mm from the clearance. On the feed side (right) about 7 mm of board remain, with a corner notch for a stainless M2 enclosure screw: the ground tongue where P2 lands is 1.7 mm wide at its narrowest.
> - The LiPo cell (aluminium pouch) sits 1 mm under the board and overlaps the inner 3 mm of the clearance; the user's body is 8–10 mm behind the board.
> - 50 Ω coplanar feed on the top layer, about 20 mm from the radio module to the feed pad (about 10 mm of it inside the clearance, as on your demo board), with your P1/P2 positions and a pi pad set at the entry of the clearance.
>
> Questions:
> 1. Is this placement on the short edge acceptable, and what efficiency and frequency shift should we expect compared with your 40 × 100 mm demo board? Would you recommend a different position along the edge?
> 2. Orientation: we rotated your page 5 layout by 180° (pin 1 and the feed on the right, the pin 3 arm and P1 toward the left, board edge below the antenna), so the antenna sits on the board exactly as in your drawing, only turned. We did not mirror it. Is the radiator symmetric enough that a mirrored layout (feed on the left with the same edge) would also be valid, or must the orientation relative to the board edge be kept as drawn? Which side of the part carries the pin 1 mark?
> 3. Could you review our layout (we can send the KiCad/Gerber files) and suggest a matching starting point (P1, P2 or a pi network) for 915–928 MHz on this board, inside the enclosure and on the body?
> 4. The CAD footprint of the M620720 (Altium, DXF or Gerber) with the recommended copper, solder mask and paste: we drew ours from the image on page 5 of the datasheet and would like to check it (pad size, the copper arm from pin 3 to P1, the clearance shape, and the solder mask opening, which looks 2.0 mm deep against 2.1 mm of copper).
> 5. Any guidance on nearby metal: the battery cell under part of the clearance, a grounded M2 board screw 0.5 mm from it on the P1 side, a stainless M2 enclosure screw about 3.7 mm from it on the feed side, and the effect of the body.
> 6. Availability of evaluation boards or samples, and price and lead time at 100 / 500 pcs (DigiKey shows 37,777 in stock and a 20-week factory lead time today).
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina
