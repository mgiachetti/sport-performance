# Consultas y pedidos de cotización del pod v0 (B-909)

Borradores listos para mandar, parte del paquete de cotización ([`costos.md`](costos.md), [`pedido-pcbway.md`](pedido-pcbway.md)). Van en inglés a los proveedores de afuera y en castellano a los de acá. Antes de mandar cada uno: completar lo que está entre corchetes (nombre, empresa, CUIT) y adjuntar lo que dice "Adjuntos". Las direcciones que dicen **no verificada** salen de una búsqueda y hay que confirmarlas en la página del proveedor.

Datos del pod que se repiten: placa de 4 capas de unos 50 × 70 mm, nRF52840 en un Raytac MDBT50Q-P1MV2, LoRa Ebyte E22-900M22S (SX1262, 915 MHz), GNSS Quectel LC29H(AA) o (EA) L1 + L5 con patch pasivo apilado Taoglas GVLB208.A en la placa, IMU LSM6DSV320X, LiPo de 500–600 mAh. Prototipos: 5 armados, después 10 de piloto y 100 de serie, para un club de rugby (lo usa un jugador en un chaleco, entre los omóplatos).

| # | A quién | Para qué | Idioma | Dirección |
|---|---|---|---|---|
| 1 | Raytac | Revisión del layout del MDBT50Q y keep-out de la antena | Inglés | service@raytac.com (**no verificada**), con copia a sales@raytac.com (la que publica [su página de contacto](https://www.raytac.com/contact/)) |
| 2 | Proveedor de baterías | Cotización de la celda con PCM, NTC, conector GH e informes | Inglés | Dos o tres proveedores a elegir |
| 3 | ENACOM | Potencia, salto de canal y homologación en 915–928 MHz | Castellano | hertz@enacom.gob.ar (homologación y RAMATEL; de un aviso de 2019, **no verificada** hoy) o un trámite por TAD |
| 4 | Despachante de aduana | Importación de prototipos con radio y baterías | Castellano | Al que se elija |
| 5 | Quectel | Notas de aplicación, firmware y stock de la LC29H(EA) | Inglés | support@quectel.com (la que figura en el Hardware Design del LC29H) |
| 6 | Taoglas | Ajuste del GVLB208.A en una tierra chica | Inglés | Formulario de [taoglas.com/support-center](https://taoglas.com/support-center) (no publican un mail) |

## 1. Raytac: revisión del layout

Raytac revisa el esquemático y el layout de las placas que usan sus módulos (que sea un servicio gratis y formal es **no verificado**: se pregunta en el mismo mail). Mandarlo **con la placa ubicada y ruteada**, antes de pedir a PCBWay.

**Adjuntos:** PDF del esquemático (la hoja `mcu_radio` alcanza, mejor completo), capturas de las 4 capas alrededor del módulo, el `.kicad_pcb` o los Gerbers, y el apilado.

> **Subject:** Layout review request: MDBT50Q-P1MV2 on a 4-layer wearable board
>
> Hello Raytac team,
>
> We are designing a wearable GNSS + IMU tracker for team sports around the MDBT50Q-P1MV2 (nRF52840, PCB antenna). We plan a first run of 5 prototypes, then 10 and 100 units. We would appreciate your free layout review before we order the boards.
>
> Design summary:
> - 4-layer, 1.6 mm FR4 board, about 50 × 70 mm. L2 is a solid ground plane.
> - MDBT50Q-P1MV2 on the left board edge, antenna tip pointing out, with a keep-out of 3.5 × 11 mm in all four layers following section 2.3 of the datasheet (Ver. K). The first pads of the module start 3.8 mm from the antenna end in your footprint.
> - Normal voltage mode: VDD and VDDH at 3.4 V from a buck-boost, DCCH not connected. External 32.768 kHz crystal (Abracon ABS06, CL 12.5 pF, 18 pF load caps).
> - USB through dock pads (D+/D−, 90 Ω pair), no USB connector.
> - Next to it: a LoRa SX1262 module at 915 MHz (22 dBm) with its own antenna at the opposite edge, and a GNSS L1/L5 receiver with a ceramic patch on top of the board. The board sits inside a plastic enclosure on the player's back.
>
> Questions:
> 1. Is the 3.5 mm keep-out depth enough with the module flush to the edge, or do you recommend a larger clearance or moving the module inwards?
> 2. Does the FCC ID SH6MDBT50Q (and CE/IC) cover the MDBT50Q-P1MV2, and can you send the certificates and test reports for it?
> 3. What antenna detuning should we expect with a human body 10–20 mm behind the board, and do you recommend the -U1MV2 (U.FL) variant for that case? We would also need the -U1MV2 datasheet and footprint (Ver. K does not cover it).
> 4. Price and lead time for the MDBT50Q-P1MV2 at 10, 100 and 500 units, and your recommended distributor (LCSC shows no stock today).
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

## 6. Taoglas: GVLB208.A en una tierra chica

> **Subject:** GVLB208.A tuning on a 50 × 70 mm ground plane (L1 + L5)
>
> Hello Taoglas team,
>
> We plan to use the GVLB208.A stacked L1/L5 passive patch (20 × 20 × 8.8 mm) on a 4-layer, 50 × 70 mm board inside a plastic enclosure worn on a player's back, followed by our own SAW + LNA chain. The datasheet characterises the patch on a 70 × 70 mm ground plane, and we expect L5 to detune first on our smaller plane. Our bench reference is your AGVLB.25B.07.0060A.
>
> Questions:
> 1. What centre-frequency shift and efficiency loss do you expect at L1 and L5 on a 50 × 70 mm ground plane (patch centred near the top edge), and with a body 10–20 mm behind the board?
> 2. Do you offer the GVLB208.A tuned for a smaller ground plane, or a variant with a different tuning, and at what MOQ?
> 3. Your CSA.20 (passive antenna test, matching and fine tuning) and ISA.10 (integration review) services look like what we need: what do they cost, what do we send (2 sample boards?), and how long do they take?
> 4. Recommended pad, through-hole and keep-out geometry (we follow section 4.3 of the datasheet), soldering profile for the pin, and whether the patch can go through reflow.
> 5. Price and lead time at 10 / 100 / 500 units (DigiKey shows 271 in stock today).
>
> Best regards,
> [Name] · [Company] · Buenos Aires, Argentina
