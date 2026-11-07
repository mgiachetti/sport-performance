# 0105. Pod GNSS + IMU: doble banda L1/L5, telemetría en vivo por LoRa a un gateway en la cancha, cálculo en la tablet con el dominio y posprocesado después de la sesión

- Estado: Propuesto
- Fecha: 2026-11-07
- Issue: #116 (B-901)

## Contexto

La Fase 3 es un pod por jugador con firmware propio sobre hardware genérico. Lo que guarda en storage y en Postgres ya está decidido en [ADR 0005](0005-pod-crudo-en-storage.md). El backlog proponía prototipar con WisBlock: el RAK4631 (nRF52840 + SX1262) y el RAK12500 (u-blox ZOE-M8Q, una sola banda L1), con descarga por BLE.

Con el club se definieron estas condiciones:

- **El GPS tiene que ser bueno en Argentina.** Satélites visibles hay de sobra: GPS, Galileo, GLONASS y BeiDou se ven bien (GLONASS solo en L1). Los problemas son otros tres:
  - **No hay SBAS en Sudamérica**: WAAS y EGNOS no cubren la región.
  - **El retardo ionosférico** es alto: Buenos Aires está bajo la influencia de la cresta sur de la anomalía de ionización ecuatorial, y el ciclo solar viene de su pico. Un receptor de una sola banda no lo cancela.
  - **El multicamino** de tribunas, árboles y el propio cuerpo del jugador.
- **Datos en vivo.** El staff quiere ver durante el partido si un jugador se esforzó de más y hay que cambiarlo. Las bandas de frecuencia cardíaca quedan para el futuro: el esfuerzo se lee de las corridas, los sprints y los contactos.
- **Cantidad y costo:** 100 pods, fabricados en China, a unos US$ 80 por pod o menos (precio en origen).

El relevamiento de partes, precios, regulación y RAMSAC, con sus fuentes, está en [`docs/hardware/pod-f3.md`](../hardware/pod-f3.md). Los precios son de páginas cacheadas o agregadores. Lo que no se pudo confirmar dice "no verificado".

## Decisión

### Hardware del pod

- **GNSS de doble banda L1 + L5** a 10 Hz, con las 4 constelaciones a la vez.
  - **Por qué doble banda:** medir en dos frecuencias cancela el retardo ionosférico y rechaza mejor el multicamino. En L5 se ven desde acá Galileo E5a, GPS L5 y BeiDou B2a. GLONASS aporta solo en L1.
  - **Qué usa Catapult:** según las fotos internas de su presentación ante la FCC (2ADAL-S7401), que revisó el equipo, el Vector S7 lleva un **u-blox EVA-M8Q**, de una sola banda (L1), con 10 Hz en varias constelaciones o 18 Hz solo con GPS. Un receptor de doble banda puede igualarlo o superarlo en la medición cruda; lo que hay que alcanzar es su procesamiento.
  - **Por qué 10 Hz:** es la frecuencia de Catapult Vector. Subir a 18 o 25 Hz aporta poco frente a la precisión.
  - **Prototipo con dos candidatos:**
    - **u-blox NEO-F10N-00B-20, como opción principal.** Es la única variante del F10N con fase portadora (`UBX-RXM-RAWX`), con protocolo documentado y conversión a RINEX con RTKLIB. La -00B-00 no tiene salida cruda.
    - **Quectel LC29H(AA), como opción de costo**, a unos US$ 7,40 contra unos US$ 19–21 del F10N-20. Posiciona a 10 Hz. Según la página de la serie LC29H, la salida cruda es de 1 Hz. Que la variante AA saque crudo en modo base con MSM7 está **no verificado**: los reportes del foro son de la EA.
  - **Primer test de banco:** medir hasta qué tasa sale RAWX en el F10N, y si el modo base del LC29H es estable y no degrada la solución de navegación (PVT).
  - **Descartados:** Allystar TAU1201/1202, sin salida cruda confirmada. Unicore UM620N, sin precio ni salida cruda confirmados.
- **Antena:**
  - Patch cerámico **activo de doble banda L1/L5 de 25 × 25 mm**, con un plano de tierra suficiente.
  - **Filtro SAW antes del LNA**, porque el pod transmite LoRa a centímetros del receptor.
  - **Separación física** entre la antena GNSS (arriba, mirando al cielo) y la antena de LoRa.
- **IMU:**
  - **ST LSM6DSV320X:** en un solo chip, 6 ejes con un canal de ±2–16 g y otro canal de alto rango de ±32–320 g, independientes.
  - El canal de alto rango es para los impactos: con ±16 g los tackles saturan. De esos impactos salen `contacts_n` y `scrums_n`, **solo en rugby**. En hockey no hay contactos ([ADR 0017](0017-deporte-y-sexo-en-el-modelo.md), [ADR 0091](0091-datos-de-cancha-de-hockey.md)).
  - **Respaldo si no hay stock** (LCSC tenía 45 unidades): ICM-42688-P más ADXL372.
- **MCU y radio:** nRF52840 (BLE) + SX1262 (LoRa).
  - Prototipo con el **RAK4630**: integrado y con el ecosistema WisBlock, a unos US$ 18–24.
  - Serie con **módulos Ebyte** (E73 + E22-900M22S), a unos US$ 10 los dos. Sus certificaciones FCC/CE no están verificadas.
- **Memoria:** NAND SPI de **4 Gbit**. El cálculo está en `pod-f3.md`:
  - Una sesión de 3 h son unos 24 MB sin las mediciones crudas del GNSS, y unos 46 MB con crudo a 1 Hz.
  - Con 4 Gbit (512 MB) entran unas 11 sesiones con crudo.
  - 2 Gbit es el mínimo, y obliga a descargar seguido.
- **Batería:** objetivo de 4–5 h de sesión. Cargador BQ25180 y medidor de carga MAX17048.
  - El consumo estimado es de unos 40–50 mA: GNSS de 21–30 mA, nRF52840, LNA, IMU, NAND y unos pocos mA de promedio de LoRa.
  - Con 1000 mAh eso da unas 20 h, mucho más de lo necesario.
  - El banco mide el consumo real y decide: mantener 1000 mAh como margen (frío, envejecimiento, futura banda de FC) o bajar a unos 400–500 mAh para achicar el pod y el costo.
- **UWB opcional para deportes bajo techo** (Qorvo DW3110 o su sucesor QM33, canales 5 y 9):
  - La placa lleva **el lugar para el chip, su antena y su cristal**, sin montar en la tanda de 100. Montarlo después no obliga a rediseñar la placa **siempre que el lugar se haya probado**: algunos prototipos de B-909 lo llevan montado para validar el diseño de RF a 6,5–8 GHz.
  - **Encapsulado:** el DW3110 es WLCSP, que puede exigir paso fino o vías en el pad en todas las placas aunque no se monte. Hay que comparar con el DW3210 o el QM33 en un encapsulado más simple antes de cerrar la placa (**no verificado**).
  - **Para qué:** bajo techo (gimnasio, cancha cubierta, deportes indoor) no hay GNSS, y UWB da posición de 10–30 cm. Afuera, el GNSS de doble banda alcanza.
  - **Costo estimado por pod si se monta:** unos US$ 9–12. El chip cuesta US$ 6,64 @100 en LCSC o US$ 8,77 @100 en RFMW, sin stock en ninguno de los dos al relevarlo; se suman antena chip, cristal, pasivos y el armado, cuyo costo **no está verificado**.
  - **Modo TDoA:** el pod solo emite pulsos cortos y las anclas escuchan. El límite de potencia de UWB aplica a quien transmite, así que las anclas pueden usar antenas directivas de más ganancia **en recepción** y recuperar alcance. Si las anclas se sincronizan por el aire, esas tramas sí cuentan contra el límite. Las anclas van altas y alcanza con que cada pod vea al menos 4.
  - **DW3000 y no DW1000, salvo que la prueba diga otra cosa:** consume cerca de un tercio, tiene seguridad 802.15.4z (STS), es más chico y es el producto vigente. El DW1000 tiene más alcance (modo de 110 kbps y canales bajos), pero esos canales tienen restricciones en varios países, y su ciclo de vida es un riesgo.
    - Según las fotos internas de su presentación ante la FCC (2ADAL-S7401), que revisó el equipo, el Catapult Vector S7 usa un DW1000 con antena Taoglas. Es un diseño de 2019–2020, anterior al DW3000.
    - B-911 compara los dos en el mismo lugar bajo techo, con el pod en la espalda de un jugador: alcance y proporción de paquetes recibidos.
  - **Sin GNSS no hay hora para los turnos de LoRa.** Bajo techo, los pods toman la hora de una **baliza LoRa del gateway**: así el pod sigue solo emitiendo en UWB, sin el consumo de escuchar a las anclas.
  - **Anclas e instalación** (unas 4–6 en una cancha cubierta de 40 × 20 m; **no verificado**) se compran solo para el lugar que las necesite. Quedan fuera del objetivo de US$ 80.
- **Ubicación:** en un chaleco, **entre los omóplatos**, con la antena hacia arriba. Es la misma ubicación de Catapult, así lo medido se compara con primera.
- **Objetivo de costo: US$ 80 por pod en origen, para 100 unidades.**
  - El relevamiento da unos **US$ 74–82** en el caso optimista: LC29H, módulos Ebyte, LSM6DSV320X, antena Taoglas y NAND de 2 Gbit, con el PCB y la carcasa en el extremo bajo o alto de su rango.
  - Da unos **US$ 113** en el caso pesimista (los extremos altos de la tabla): F10N-20, RAK4630 y antena Linx, cuyo precio está **no verificado**.
  - **Lo que más pesa es la antena GNSS de marca**, de €19,87–21,03 la Taoglas en DigiKey. Hasta con la opción barata, los US$ 80 quedan justos. Con el F10N, los US$ 80 solo se alcanzan con una antena L1/L5 activa china de unos US$ 4–8, cuyo precio no está verificado.

### Telemetría en vivo

- **Radio y banda:** LoRa en **915–928 MHz únicamente**. La Res. ENACOM 581/2018 declaró esa banda de uso compartido sin autorización para usarla (citada por la Res. 1132/2023). El tramo 902–915 MHz tiene otro régimen y no se usa. La potencia máxima en Argentina **no está verificada**: el pod se configura con la potencia que surja de la norma, no con la del plan AU915.
- **Protocolo propio, no LoRaWAN, con turnos (TDMA)** sincronizados por la hora del GNSS: todos los pods la tienen al microsegundo con el PPS (bajo techo, con la baliza del gateway; ver UWB). Cada pod transmite en su turno, así los paquetes no chocan.
  - **Riesgo regulatorio:** canales fijos podrían no cumplir las reglas de salto de frecuencia o de tiempo de permanencia por canal de la norma Q2-63.03, parecidas a las de la FCC 15.247. La banda útil es de solo 13 MHz. Si la norma lo pide, cada trama cambia de canal siguiendo una secuencia conocida por todos. Es una pregunta explícita de B-903.
- **Qué se transmite:** cada pod arma un resumen por segundo y manda **dos resúmenes juntos cada 2 s**, en unos 40 bytes. El resumen incluye:
  - metros recorridos;
  - velocidad máxima;
  - aceleraciones y desaceleraciones de más de 2 m/s²;
  - impactos de la IMU;
  - carga acelerométrica (`accel_load_au`);
  - posición.
- **Capacidad:**
  - Un paquete de 40 B en SF7 / 125 kHz ocupa unos 82 ms en el aire.
  - Con turnos de unos 100 ms (paquete más tiempo de guarda), una trama de 2 s tiene 20 turnos por canal: **unos 160 pods en 8 canales**. Alcanza para entrenar una categoría entera a la vez.
  - 30 pods ocupan cerca del 15 % de cada canal. Cada 1 s sería el 31 %, con capacidad para unos 80 pods: por eso la cadencia es de 2 s.
- **Gateway de 8 canales SX1302** (RAK7268V2, unos US$ 139–170), en un **mástil de 3–5 m** al costado de la cancha, para quedar por encima de los jugadores.
  - Se conecta a la **tablet del staff** por Ethernet o por Wi-Fi local, con un packet forwarder, y **funciona sin internet**.
  - El forwarder tiene que dejar pasar tramas que no son LoRaWAN, con una sync word privada. Se verifica en B-905.
  - Solo si hay conexión al exterior (Wi-Fi del club o 4G), el vivo sube al servidor para que también lo vea quien no está en la cancha.
- **Privacidad y seguridad (son datos de menores):**
  - **Cifrado y autenticación:** cada paquete va cifrado y autenticado con una clave del club (AES-CCM), grabada en el pod cuando está en la base. Lleva un contador que impide repetir paquetes viejos.
  - **Sin datos personales en el aire:** el paquete lleva solo el id del pod. Qué pod usa cada jugador lo sabe solo la app, que lo asigna en cada sesión.
  - **Quién ve la pantalla en vivo:** solo el staff, según la matriz de permisos ([ADR 0025](0025-matriz-de-permisos.md)): el entrenador y el preparador físico asignados a la categoría, y la administración. Ningún jugador ve nombres de otros.
  - **Consentimiento:** el seguimiento por GNSS necesita el consentimiento de datos del jugador. Si el texto vigente no menciona la ubicación, se publica una versión nueva del texto ([ADR 0043](0043-consentimientos.md)). Sin consentimiento, el pod no se asigna.
  - **Retención:** las trazas de posición tienen una retención propia (ADR 0044), que se define en B-908. Las cubren la exportación y el borrado del titular.
- **El cálculo del vivo se hace en la tablet**, con **las mismas funciones de `packages/domain`** que usa el worker después. El pod solo resume y no decide nada. Así, cambiar una regla no exige actualizar el firmware de 100 pods, y el vivo y el informe calculan igual.
- **Las señales de esfuerzo son reglas declarativas por club**, con valores por defecto en seeds, como el motor de alertas ([ADR 0022](0022-motor-de-reglas-de-alerta.md)):
  - **Volumen del partido, como % del promedio propio por partido:**
    - HSR absoluto (5,5 m/s en varones y 5,28 m/s en mujeres, o el umbral de primera);
    - HSR relativo (más del 60 % de la Vmax del jugador);
    - sprints, aceleraciones y desaceleraciones de más de 2 m/s²;
    - `accel_load_au`.

    Nunca se usa el nombre "PlayerLoad".
  - **Caída de intensidad:** los metros/min de los últimos 5 min frente al pico del partido.
  - **Velocidad máxima reciente frente a la Vmax propia**, que sale del `sprint_40` o del máximo de la temporada.
  - **Esfuerzos repetidos sin recuperar:**
    - en rugby, RHIE: sprint, contacto de la IMU y sprint con poca pausa;
    - en hockey no hay contactos ([ADR 0091](0091-datos-de-cancha-de-hockey.md)), así que se cuentan esfuerzos de alta intensidad repetidos solo con corridas y aceleraciones.
  - **Jugador sin promedio propio todavía:** el estado es "historia insuficiente", como el ACWR con menos de 28 días, y se usan su Vmax y los umbrales absolutos.
- **Es una heurística.** La pantalla dice "sugiere revisar", con ícono y texto. Correr menos puede ser táctico y no fatiga: **el cambio lo decide el entrenador**. No es un dispositivo médico (principio 7).

### Después de la sesión

- **El pod graba todo a tasa completa:** GNSS a 10 Hz, la IMU a 100 Hz o más y las ráfagas de impacto.
- **Se descarga por una base con pines pogo o USB**, que también carga el pod. Por BLE, una sesión de 46 MB con crudo son unos 8 min por pod: con 100 pods no es viable.
- El crudo va a storage como dice [ADR 0005](0005-pod-crudo-en-storage.md).
- **Posprocesado PPK en el worker**, con dos fuentes de corrección:
  - una **base propia al costado de la cancha**: otro módulo igual grabando crudo, con la línea de base casi nula y las mismas señales;
  - **o el RINEX de 1 s de RAMSAC** (IGN), de las estaciones IGM0/IGM1 de CABA, a unos 15 km de Munro según una estimación.

  Que RAMSAC rastree L5/E5a y si el servicio tiene costo están **no verificados**.
- **Métodos:** el método es `pod` (CLAUDE.md, principio 4), con dos variantes que se guardan las dos:
  - `pod_live`: lo calculado en vivo con los resúmenes;
  - `pod_ppk`: lo procesado después con el crudo y el PPK;
  - `pod_uwb`: posición por UWB bajo techo, si se monta (B-911).

  Los informes, el panel y las alertas usan `pod_ppk` cuando existe. Nunca se comparan las variantes entre sí, ni contra Catapult, sin avisar.
- **Bandas de FC:** quedan diferidas, pero el firmware conserva el rol de central BLE para leer una banda estándar y retransmitirla por LoRa, sin cambiar el hardware.

## Alternativas descartadas

- **BLE, Wi-Fi o 2,4 GHz propietario para el vivo.** El cuerpo absorbe mucho los 2,4 GHz, así que con 30 jugadores en 100 × 70 m el alcance hasta el costado no es confiable. Wi-Fi además gasta mucha batería.
- **4G en cada pod.** Tiene costo por jugador, consumo y depende de la cobertura de cada club.
- **GNSS de una sola banda (L1)**, por ejemplo el RAK12500 / ZOE-M8Q del backlog. Ahorra unos US$ 5–10, pero no resuelve la ionosfera ni la falta de SBAS, que son el problema en Argentina.
- **Sin acelerómetro de alto rango.** Ahorra unos US$ 2–4, pero en rugby los contactos saturan un acelerómetro de ±16 g.
- **RTK en vivo**, con correcciones por el downlink de LoRa a 100 pods. Es marginal en ancho de banda, y obliga a receptores RTK más caros. El vivo no necesita centímetros, y el PPK de después da la precisión.
- **Descarga solo por BLE.** No escala a 100 pods (ver arriba).

## Consecuencias

- **Homologación ante ENACOM.** El nuevo RAMATEL (Res. 57/2026, vigente desde el 01/12/2026 según la Res. 843/2026) define "comercializar" incluyendo **dar en comodato**. Si prestamos los pods a los clubes, el equipo final necesita **Homologación**, con certificado de una agencia reconocida y ensayo de laboratorio. El FCC/CE de los módulos probablemente no alcanza: lo que se registra es el equipo final.
  - Para **uso propio** existe la Autorización por modelo, con una Declaración de Conformidad.
  - Antes de la tanda de 100 hay que definir el modelo de entrega y presupuestar la homologación.
- **El precio de US$ 80 es en origen.** Quedan afuera:
  - la importación a Argentina, con impuestos y régimen de courier, a revisar con un despachante;
  - los chalecos, las bases, el gateway y la base GNSS propia;
  - las vueltas de prototipo y la homologación.
- **Validación propia obligatoria.** No hay estudios publicados de GNSS de doble banda de bajo costo en deportes. El plan de prototipos compara en la cancha del club contra un Catapult puesto a la vez, y contra fotocélulas en el sprint (`pod-f3.md`).
- **Riesgos de suministro:**
  - el F10N-00B-20 tiene stock incierto (Avnet pide un mínimo de 500 unidades y 19 semanas);
  - el LSM6DSV320X tiene stock bajo.

  Los dos tienen respaldo definido.
- **Firmware nuevo** (`firmware/`, en C): turnos LoRa sincronizados por el PPS (o por la baliza del gateway bajo techo), resumen por segundo, cifrado AES-CCM con contador, registro en NAND, descarga por la base y DFU.
- **App:** tiene que recibir el gateway y mostrar la pantalla en vivo. Las métricas y señales del vivo son funciones nuevas del dominio, con tests, y las usan la tablet y el worker.
- El ADR va asociado a B-901: `pnpm docs:check` exige un `B-xxx` en la línea del issue, y el epic #116 no tiene uno propio.
- Este ADR queda **Propuesto** hasta que los tests de banco y de cancha confirmen el GNSS y la antena. Con esos datos se escribe un ADR que lo acepta o lo reemplaza.
