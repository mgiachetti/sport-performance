# Protocolo del LC29H para el firmware del pod (B-901, B-904)

Lo que dice la especificación de protocolo de Quectel sobre lo que el firmware del pod necesita del GNSS: crudo, 10 Hz, constelaciones, RTK de la EA, backup, PPS, guardado de la configuración, versión del firmware e interferencias. Complementa [`pod-v0.md`](pod-v0.md) (hardware) y [`banco-gnss.md`](banco-gnss.md) (pruebas), dentro del [ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md) y del [ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md).

**Fuente:** *Quectel LC29H&LC79H Series GNSS Protocol Specification*, versión 1.5, del 12/09/2025 (en adelante, **"la especificación"**). Se descarga de la [página del LC29H](https://www.quectel.com/product/gnss-lc29h/) y **no se sube al repo** (la licencia no lo permite). Las citas dan sección y página impresa (la del pie, "N / 146"). Lo que la especificación no dice queda marcado **"no lo dice la especificación"** y se mide en el banco (B-901).

El pod usa la **LC29H(AA)**, con la **LC29H(EA)** como opción para RTK. Muchos comandos valen solo para algunas variantes, y la especificación lo aclara en una nota de cada comando. Este documento lo dice siempre.

## Resumen para el firmware

| Tema | AA (principal) | EA (RTK) |
|---|---|---|
| Crudo (observables) | **Sí, solo RTCM3**: MSM4 o MSM7 con `$PAIR432` y efemérides con `$PAIR436`, sin modo base. La tasa no la dice | Igual por RTCM3. Además **recibe** RTCM |
| Crudo propio de Quectel o Airoha (`$PQTMRAW` o similar) | **No existe** en la especificación | No existe |
| Tasa de posición | 100–1000 ms con `$PAIR050` (o `$PQTMCFGFIXRATE`), con el GNSS apagado y guardando | 100 ms por defecto. Arriba de 1 Hz solo salen RMC y GGA a esa tasa |
| Velocidad | `$PQTMPVT` (N/E/abajo) y `$PQTMVEL` (con precisión estimada) | RMC y GGA arriba de 1 Hz. Que salgan los PQTM a 10 Hz, **no está claro** |
| Modelo dinámico | `$PAIR080` (normal, fitness, etc.). Umbral estático con `$PAIR070` (0 = apagado, por defecto) | Esos comandos no existen en la EA |
| UART | Hasta 921600 bps (`$PAIR864`). A 10 Hz hace falta ≥ 460800 | Igual (y 3000000) |
| Backup | `$PAIR650` o `$PQTMBKP`; se sale por WAKEUP o por tiempo | `$PAIR650` |
| PPS | `$PAIR752` (tipo y ancho) y `$PQTMCFGPPS` (polaridad, solo AA) | `$PAIR752` |
| Guardar | `$PAIR513` o `$PQTMSAVEPAR` (a más de 1 Hz, con el GNSS apagado) | Igual |
| Versión del firmware | `$PQTMVERNO`, más `$PQTMVER`, que sale solo al encender | `$PQTMVERNO` |
| Interferencia | `$PAIR391` (`$PAIRSPF` de L1 y `$PAIRSPF5` de L5) y `$PQTMJAMMINGSTATUS` | `$PAIR391` |

## 1. Mediciones crudas en la AA

**Respuesta: sí, según la especificación, pero solo como RTCM3 (MSM4 o MSM7 más efemérides) y sin modo base.** No hay un mensaje de crudo propio (`$PQTMRAW` o un PAIR de crudo). La especificación no dice a qué tasa sale, si se guarda ni si afecta el PVT a 10 Hz: eso se mide en el banco.

Qué dice:

- **El RTCM es salida y entrada en toda la serie.** Tabla 1 (p. 11): "RTCM 10403.3 — Input/output, binary, standard". El capítulo 3 (p. 140) dice que el RTCM "is used to transfer GNSS raw measurement data".
- **Mensajes de salida** (tabla 8, pp. 140–141):
  - MSM4: 1074 GPS, 1084 GLONASS, 1094 Galileo, 1114 QZSS, 1124 BeiDou;
  - MSM7: 1077, 1087, 1097, 1117, 1127;
  - efemérides: 1019 GPS, 1020 GLONASS, 1042 BeiDou, 1044 QZSS, 1046 Galileo I/NAV;
  - 1005 (punto de referencia de la antena).

  MSM5 (10x5), 1006 y NavIC (1134/1135/1137) son **solo de entrada**, así que la AA no saca crudo de NavIC. Para Argentina no importa: NavIC no se ve.
- **Variantes:** la única restricción de la tabla 8 es la nota 4 (p. 141): "The input mode of RTCM messages is only supported on the LC29H (BA, DA, EA) and LC79H (EL)". **La salida no tiene restricción de variante**, y los comandos `$PAIR432`, `$PAIR434` y `$PAIR436` tampoco (§2.4.39–2.4.44, pp. 127–131). La **AA no recibe RTCM**: no puede hacer RTK.
- **Cómo se prende:**
  - `$PAIR432,<Mode>` (§2.4.39, p. 127): −1 apaga, 0 = MSM4, 1 = MSM7. Según la nota 1 de la tabla 8, saca los MSM "if the corresponding constellation is enabled". `$PAIR433` lo consulta.
  - `$PAIR436,1` (§2.4.43, p. 130): efemérides en RTCM. `$PAIR437` lo consulta.
  - `$PAIR434,0|1` (§2.4.41, p. 129): el 1005. Al rover no le sirve, así que va en 0.
  - **En la AA, el puerto tiene que tener RTCM3 en la salida**: `$PQTMCFGPROT,W,1,1,<in>,<out>` (§2.3.38, pp. 81–83, "only supported on LC29H (AA) and LC79H (AL)"). El bit 0 es NMEA y el bit 2, RTCM3. El ejemplo de la especificación responde `00000005,00000001` (entrada NMEA + RTCM3, salida solo NMEA): **por defecto la salida RTCM podría estar apagada**. El firmware lee con `$PQTMCFGPROT,R,1,1` y pone la salida en 5. La especificación no dice si `PQTMCFGPROT` necesita guardar y reiniciar.
- **Modo base:** **no hace falta, y en la AA no existe.** `$PQTMCFGRCVRMODE` (§2.3.14, p. 55) "is supported on LC29H (BA, CA, DA, EA) and LC79H (EL)". Lo mismo `$PQTMCFGSVIN` (p. 47). La prueba del banco con `$PQTMCFGRCVRMODE,W,2` en la AA no tiene sentido: se usa `$PAIR432` directo.
- **Tasa máxima:** **no lo dice la especificación.**
  - La tabla 6 de `$PQTMCFGMSGRATE` (pp. 42–43) no incluye mensajes RTCM, y ningún comando baja la tasa del RTCM. Lo esperable es que los MSM salgan en cada época de posición.
  - La [página del producto](https://www.quectel.com/product/gnss-lc29h/) dice "GNSS raw data 1 Hz" para toda la serie. **Puede que el crudo quede en 1 Hz aunque la posición vaya a 10 Hz.**
  - Para el pod da igual: el log guarda el crudo a 1 Hz (`gnss_raw` del [README de `pod-protocol`](../../packages/pod-protocol/README.md)). Si sale a 10 Hz, el firmware se queda con la época del segundo entero y descarta las otras nueve.
- **Persistencia:** `$PAIR513` y `$PQTMSAVEPAR` guardan "the current configurations" en la NVM (§2.4.46, p. 132; §2.3.2, p. 38). La especificación no lista qué parámetros entran. En la AA, `$PQTMRESTOREPAR` vuelve a valores de fábrica "the parameters configured by all commands" (nota de §2.3.3, p. 40), lo que sugiere que todos se guardan. **Que `$PAIR432` y `$PAIR436` sobrevivan a un corte, no lo dice la especificación.** Igual el firmware los manda en cada arranque.
- **Si degrada el PVT a 10 Hz:** **no lo dice la especificación.** El riesgo que sí se puede estimar es el del UART:
  - MSM7 con 4–5 constelaciones y doble banda es del orden de 1–1,5 kB por época (estimación);
  - a 10 Hz serían unos 10–15 kB/s, contra unos 92 kB/s de 921600 bps en 8N1;
  - entra, pero es el mensaje más grande del puerto. La nota 2 de `$PAIR864` (p. 136) avisa que "messages may be lost when the baud rate is below 460800 bps at 10 Hz output frequency".
- **Qué no da la RTCM:** la AA no da el modo de la fase portadora como en `UBX-RXM-RAWX`. El indicador de continuidad (lock time) va dentro del MSM. MSM7 trae la fase, el pseudorango, el Doppler y la C/N0 con más resolución, y es el que conviene para PPK. MSM4 no trae el Doppler fino.

**Para el banco (B-901):**
- confirmar que salen los MSM7 a 10 Hz y a 1 Hz de posición, y a qué tasa;
- ver que tengan L5/E5a/B2a (lo que se ve en el MSM depende del firmware: **no lo dice la especificación**);
- ver que el PVT siga sin épocas perdidas con MSM7 y efemérides prendidos;
- ver que RTKLIB (`convbin`) lo lea;
- ver si sobrevive a un corte de VCC y a un ciclo completo.

## 2. Posición a 10 Hz

### Tasa de posición

- **`$PAIR050,<Time>`** (§2.4.9, pp. 97–98), en ms, de 100 a 1000. Por defecto vale 100 en la EA y 1000 en las demás. Notas:
  - **en la AA, si `<Time>` < 1000** hay que hacerlo con el GNSS apagado, con esta secuencia:
    1. `$PAIR382,1*2E` y `$PAIR003*39`;
    2. `$PAIR050`;
    3. `$PAIR513*3D` o `$PQTMSAVEPAR*5A`;
    4. `$PAIR002*38`.

    "The configuration takes effect immediately upon completion of the above operations";
  - en la EA, la misma secuencia y **un reinicio más**;
  - en las demás variantes (o en otros casos), guardar y reiniciar;
  - **la DA solo admite 1000** (nota 3, p. 98, y nota de `$PQTMCFGFIXRATE`, p. 65). Esto confirma lo que decía el foro: la DA no pasa de 1 Hz.
- **`$PQTMCFGFIXRATE,W,<ms>`** (§2.3.23, pp. 64–65): en la AA "takes effect immediately"; en BA, CA y EA, después de `$PQTMSAVEPAR` y un reinicio. Como `$PAIR050` documenta la secuencia segura con el GNSS apagado, el firmware usa `$PAIR050`.
- **`$PAIR051`** consulta la tasa (§2.4.10, p. 99).
- **Límites por variante en los mensajes:**
  - **BA, CA y EA:** arriba de 1 Hz "only RMC and GGA messages will be output at the set frequency, whereas GSA and GSV messages maintain a 1 Hz output frequency. Other NMEA messages will not be output" (nota 2 de `$PAIR050`, p. 98);
  - **BA, CA y DA:** GSA, GSV, `$PQTMPVT` y `$PQTMDOP` salen como máximo a 1 Hz (nota 2 de `$PQTMCFGMSGRATE`, p. 43);
  - **la AA no tiene ninguna de esas dos restricciones.**

### UART

- **`$PAIR864,0,0,<baud>`** (§2.4.49, pp. 135–136): de 4800 a 921600 bps, y 3000000 salvo en la AA y la LC79H(AL). "The module must be rebooted after changing the port baud rate". A 10 Hz hace falta ≥ 460800 (nota 2). `$PAIR865,0,0` lo consulta.
- **`$PQTMCFGUART,W,[1,]<baud>[,8,0,1,0]`** (§2.3.37, pp. 79–81, solo AA y AL): tiene efecto después de `$PQTMSAVEPAR` y un reinicio.
- **Velocidad de fábrica:** **no lo dice la especificación.** Los ejemplos usan 115200, que es el valor habitual del Hardware Design (verificar).
- **Control de flujo:** solo por software (`$PAIR866`, p. 137). El pod no lo usa: es UART binario por la RTCM, y XON/XOFF no sirve ahí.
- **El firmware arranca probando 921600.** Si no responde `$PQTMVERNO` en unos 200 ms, prueba 115200, manda `$PAIR864,0,0,921600*10`, guarda y reinicia el módulo (`$PQTMSRR*4B` en la AA, §2.3.19, p. 59; o un ciclo de VCC).

### Qué mensajes prender y cuáles apagar

- **Estándar:** `$PAIR062,<Type>,<N>` (§2.4.13, pp. 101–102). Tipos: 0 GGA, 1 GLL, 2 GSA, 3 GSV, 4 RMC, 5 VTG, 6 ZDA, 7 GRS, 8 GST, 9 GNS. N = cada cuántas épocas sale (0 = apagado). Por defecto salen GGA, GLL, GSA, GSV, RMC y VTG. **BA, CA, DA y EA solo aceptan los tipos 0–5**, y la **EA solo acepta N = 0 o 1**. `$PAIR062,-1,…` vuelve todo a los valores de fábrica.
- **PQTM:** `$PQTMCFGMSGRATE,W,<Name>,<N>,<MsgVer>` (§2.3.5, pp. 40–43; tabla 6). N va de 1 a 20 y, para los PQTM, `<MsgVer>` es obligatorio. Actúa "on the current port".
- **Recomendado en la AA a 10 Hz** (estimación de bytes por época):
  - `$PQTMPVT` en cada época (unos 150 B);
  - `$PQTMVEL` en cada época (unos 90 B);
  - `$PQTMEPE` (versión 2) en cada época (unos 50 B);
  - GSV y `$PQTMDOP` a 1 Hz (N = 10), para la C/N0 por satélite y banda que mira el pod;
  - `$PQTMJAMMINGSTATUS` a 1 Hz;
  - RTCM MSM7 + efemérides;
  - todo lo demás, apagado.

  Son unos 3 kB/s de PVT, alrededor de 1,5 kB/s de GSV y 10–15 kB/s de MSM7: en total, **un 20–25 % de 921600 bps** (estimación, se mide en el banco).

### Fuente de la velocidad

| Mensaje | Campos | Unidad | Variantes |
|---|---|---|---|
| `$PQTMPVT` (§2.3.12, pp. 50–52) | `VelN`, `VelE`, `VelD`, `Spd` (velocidad en el suelo), `Heading`, más posición, `FixMode`, satélites, HDOP y PDOP | m/s | Todas, con el límite de 1 Hz en BA, CA y DA |
| `$PQTMVEL` (§2.3.27, pp. 68–69) | `VelN`, `VelE`, `VelD`, `GrdSpd` (2D), `Spd` (3D), `Heading`, **`GrdSpdAcc`, `SpdAcc`, `HeadingAcc`** (precisión estimada) | m/s, grados | Sin nota de variante |
| RMC (§2.2.1, p. 16) | `SOG` y `COG` | nudos | Todas |
| VTG (§2.2.5, p. 26) | `SOGN` (nudos) y `SOGK` (km/h) | — | Todas |
| `$PQTMEPE` (§2.3.4, p. 40) | Error estimado de la posición N, E, abajo, 2D y 3D | m | Todas |
| GST (§2.2.9, pp. 32–34) | Desvío de latitud, longitud y altura, y elipse | m | Todas, desde la v1.5 en BA, CA, DA y EA |
| `$PQTMPL` (§2.3.15, p. 56) | Niveles de protección de la posición y la velocidad | mm, mm/s | Sin nota de variante |
| `$PQTMSTD` (p. 89) | Desvío de la velocidad | m/s | Solo LC79H(AL): **no sirve** |

- **La velocidad vertical** sale solo de `VelD` en `$PQTMPVT` y `$PQTMVEL`; RMC y VTG no la tienen.
- **Que la velocidad salga del Doppler, no lo dice la especificación:** solo da los campos. El banco lo infiere de la latencia y el ruido contra la derivada de la posición, y compara con el Doppler de los MSM7.
- **Decimales:** con `$PQTMCFGNMEADP` (§2.3.13, p. 53), la velocidad de las NMEA estándar tiene 2 decimales por defecto en la AA y 3 en BA, CA, DA y EA. Al pod no le afecta: usa los PQTM.

## 3. Constelaciones, bandas y dinámica

- **Constelaciones:**
  - **`$PQTMCFGCNST,W,<GPS>,<GLO>,<GAL>,<BDS>,<QZSS>,<NavIC>`** (§2.3.21, pp. 60–62), para todas las variantes. Tiene efecto después de `$PQTMSAVEPAR` y un reinicio;
  - **`$PAIR066`** (§2.4.15, pp. 104–105), solo en la AA y la AL. "The setting is valid if the NVRAM data are valid";
  - **solo se pueden elegir algunas combinaciones**:
    - **AA:** GPS+GLO+GAL+BDS+NavIC+QZSS; GPS+GLO+GAL+BDS+QZSS; GPS+GLO+GAL+QZSS; GPS+GLO+BDS+QZSS; GPS+GAL+NavIC+QZSS; GPS+GAL+BDS+QZSS; GPS+GLO+QZSS; GPS+GAL+QZSS; GPS+BDS+QZSS; GPS+QZSS; solo BDS; solo NavIC. En la AA, QZSS se puede prender o apagar dentro de cada combinación;
    - **BA, CA, DA y EA:** otra lista (p. 62). GLONASS entra solo junto con GPS, Galileo y BeiDou (con QZSS o con NavIC). NavIC "currently unsupported on LC29H (DA, EA)".
- **Para el pod en Argentina:**
  - **AA:** GPS + GLONASS + Galileo + BeiDou + QZSS (`$PAIR066,1,1,1,1,1,0*3B`). NavIC no se ve, y QZSS casi no, pero no molesta y la combinación sin QZSS no está en la lista;
  - **EA:** la misma combinación, que está en su lista: `$PQTMCFGCNST,W,1,1,1,1,1,0*2A` (con `$PQTMSAVEPAR` y un reinicio).
- **L5:**
  - `$PAIR104,1` (§2.4.29, pp. 117–118), solo en la AA y la AL: doble banda, con el GNSS apagado (`$PAIR382,1` + `$PAIR003` antes, `$PAIR002` después). `$PAIR105` lo consulta;
  - la EA no tiene el comando: es de doble banda fija;
  - las señales que reporta GSV salen en la tabla 11 (p. 145): GPS L1 C/A = 1 y L5 = 8; Galileo E5a = 1 y E1 = 7; BeiDou B1I = 1 y B2a = 5; QZSS L1 = 1 y L5 = 8; NavIC L5 = 1. **Ojo: en Galileo, el 1 es E5a.**
- **SBAS (no hay cobertura en Argentina), apagado:**
  - `$PAIR410,0` (§2.4.35, p. 124), para AA y, desde la v1.5, EA;
  - `$PAIR400,0` (§2.4.33, p. 122, solo AA): sin fuente de DGPS;
  - `$PQTMCFGSBAS` (p. 59, solo AA) elige los sistemas;
  - en los modos fitness y natación, SBAS no funciona (nota de p. 124).
- **Modo de navegación** (`$PAIR080`, §2.4.23, pp. 111–113, solo AA y AL; tabla 7, p. 112):
  - 0 = normal (hasta 100 m/s);
  - 1 = **fitness**: "for running and walking activities, the low-speed (< 5 m/s) movement will have a greater effect on the position calculation. It reduces measurement noise caused by arm movement", hasta 30 m/s;
  - 4 = estacionario, 5 = vuelo, 7 = natación, 9 = bicicleta.

  `$PQTMCFGNAVMODE` es solo de la CA (p. 86).
  - **Decisión para el pod:** arrancar en **normal (0)**. El modo fitness filtra el ruido de los brazos y le da peso al movimiento lento: puede **suavizar las aceleraciones y el pico de los sprints**, que es justo lo que mide el pod (aceleraciones de más de 2 m/s², Vmax).
  - El banco compara normal contra fitness en los sprints de 40 m, contra la referencia del LG290P, y se queda con el que mejor da la Vmax y las aceleraciones.
- **Umbral estático:**
  - `$PAIR070,<SpeedThreshold>` (§2.4.17, pp. 106–107, solo AA y AL): debajo del umbral, la posición queda fija y la velocidad sale 0. "If the threshold value is set to 0, this function is disabled". Viene en 0 por defecto, y **el firmware igual lo manda en 0**: un jugador caminando a 0,5 m/s no puede salir quieto;
  - **error de la especificación:** `$PAIR070` da la unidad en **dm/s** (0–20) y `$PAIR071` la responde en **m/s** (0–2, con el ejemplo "0.4"). Con 0 da lo mismo.
- **Máscara de elevación:** `$PAIR072,<°>` (p. 108, solo AA), 5° por defecto. Se deja en 5°: el cuerpo ya tapa los satélites bajos.
- **SNR mínima:** `$PAIR058` (p. 99, solo AA), 9 dB por defecto. Se deja así.

## 4. EA como rover RTK

- **Modo rover:** `$PQTMCFGRCVRMODE,W,1*2A` (§2.3.14, pp. 54–55), después `$PQTMSAVEPAR` y un reinicio. "When set the module to this mode, the receiver will restore to default NMEA messages output state". El 2 es base: apaga las NMEA y saca MSM4 + 1005. **Se manda solo si `$PQTMCFGRCVRMODE,R` no da 1**, porque pide reinicio.
- **RTCM que acepta** (tabla 8): 1005 y 1006 (posición de la base), MSM4, MSM5 y MSM7 de GPS, GLONASS, Galileo, QZSS y BeiDou, y NavIC MSM4/5/7. **La base LG290P manda 1005 (o 1006) + MSM4** de las constelaciones que usa el pod. MSM4 alcanza para RTK y ocupa menos en LoRa ([ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), presupuesto de la bajada).
- **Por dónde entra:** por el mismo UART1, mezclado con los comandos NMEA (tabla 1). `$PQTMCFGPROT` no existe en la EA, así que la entrada RTCM está prendida de fábrica (a confirmar en el banco).
- **Edad máxima de la corrección:** **no lo dice la especificación.** Está en el *DR&RTK Application Note* (documento [1] de la tabla 9, p. 142). Mientras tanto, el firmware lee la edad de GGA.
- **Estado del RTK en la salida:**
  - GGA `<Quality>` (p. 18): 4 = RTK fijo, 5 = RTK flotante, 2 = diferencial, 1 = autónomo;
  - RMC, VTG y GLL `<ModeInd>` (pp. 17, 26 y 28): R = fijo, F = flotante;
  - **GGA `<DiffAge>` y `<DiffStation>`** salen en BA, DA y EA, **no en la AA** (nota de p. 21).
- **Tasa:** 100 ms por defecto (10 Hz; ver "Posición a 10 Hz"). Pero **arriba de 1 Hz solo salen RMC y GGA**: "Other NMEA messages will not be output" (nota 2, p. 98). La especificación no aclara si eso incluye los PQTM (`$PQTMPVT`, `$PQTMVEL`, `$PQTMEPE`):
  - la revisión 1.3 dice que agregó una nota sobre la tasa de `$PQTMPVT` en "BA, CA, DA, EA", pero la nota vigente (p. 43) nombra solo BA, CA y DA;
  - **el banco de la v0 lo resuelve**;
  - si en la EA solo quedan RMC y GGA a 10 Hz, la velocidad sale de RMC (`SOG` en nudos con 3 decimales, sin la vertical ni su precisión).
- **Salida RTCM de la EA:** también saca MSM y efemérides (tabla 8), así que puede grabar crudo para el PPK de respaldo como la AA.
- **`$PAIR062` en la EA** acepta solo N = 0 o 1 (p. 102).
- **Survey-in** (`$PQTMCFGSVIN`): es para usar la EA como base. Al pod no le hace falta.

## 5. Backup, arranques y asistencia

- **`$PAIR650,<s>`** (§2.4.47, pp. 133–134): apaga todo menos el reloj. "The CPU core will be set to the Backup mode… in which it cannot receive any commands".
  - `<s>` = 0 (sin temporizador) o de 10 a 62208000 s;
  - si sale bien, responde `$PAIR001,650,0` y `$PAIR650,0`; si hay un error de parámetro, solo `$PAIR001`;
  - para entrar y salir, remite al Hardware Design (documento [3]).
- **`$PQTMBKP[,<s>]`** (§2.3.39, pp. 83–84, solo AA y AL): lo mismo, sin respuesta. "The module can exit Backup mode either via the WAKEUP pin or the timer. When the module exits Backup mode, all system resources are re-initialized".
- **Secuencia del pod** (la especificación más el Hardware Design §3.3.3, ya en [`pod-v0.md`](pod-v0.md)):
  1. *(Opcional, antes del modo envío, que corta V_BCKP)*: guardar los datos de navegación en la NVM con `$PAIR511` (§2.4.45, pp. 131–132). A más de 1 Hz va entre `$PAIR382,1*2E` + `$PAIR003*39` y `$PAIR002*38`. Sin V_BCKP, el próximo arranque es tibio o frío igual, porque la hora se pierde.
  2. `$PAIR650,0*25`, y esperar `$PAIR001,650,0*38` (unos 100 ms de tiempo límite).
  3. Bajar GNSS_EN (cortar VCC) con V_BCKP prendido.
  4. Para salir: GNSS_EN arriba y **WAKEUP en alto ≥ 10 ms**. Esperar la primera NMEA o `$PQTMVER` (en la AA sale "immediately after the module is powered on", §2.3.36, p. 78).
  5. Mandar `$PAIR382,1` otra vez si se va a apagar el GNSS: "This configuration will not be saved in the flash or RTC RAM. Please send this command every time after the GNSS subsystem or main power reboots" (§2.4.31, p. 120).
- **`$PAIR002` y `$PAIR003`** (§2.4.2–2.4.3, pp. 93–94): prenden y apagan el GNSS, sin backup. "Wait more than two seconds before powering on/off the GNSS system". **El firmware respeta esos 2 s entre `$PAIR003` y `$PAIR002`.** Si se manda `$PAIR382,1` antes de `$PAIR003`, el módulo sigue aceptando comandos con el GNSS apagado (nota 2, p. 120); si no, no.
- **Arranques:**
  - `$PAIR004` en caliente (p. 94): "powered down for less than 2 hours (RTC must be alive) and its ephemeris is still valid";
  - `$PAIR005` tibio;
  - `$PAIR006` frío;
  - `$PAIR007` frío completo, **que vuelve todo a fábrica** (p. 96);
  - `$PQTMHOT`, `$PQTMWARM` y `$PQTMCOLD`: lo mismo, sin respuesta (pp. 56–58).
- **Tiempo al primer fix:** **no lo dice la especificación.** La [página del producto](https://www.quectel.com/product/gnss-lc29h/) da para AA, BA, CA, DA y EA, sin AGNSS, **26 s en frío, 16 s tibio y 1 s en caliente**, con 25 µA de backup.
- **AGNSS y EPO:**
  - la especificación solo trae **`$PAIR010`** (§2.4.8, pp. 96–97): sale al encender y avisa qué asistencia venció. `<Type>` 0 = EPO, 1 = hora, 2 = posición; `<GNSS_System>` 0–4; más semana y TOW;
  - **los comandos para inyectar EPO, hora o posición no están en esta especificación**: están en el *L89 R2.0 & LC02H & LC29H & LC79H Series AGNSS Application Note* V1.5 (ver la lista de descargas). Hasta leerlo, la inyección al sacar el pod de la base ([ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md)) sigue **no verificada**;
  - el firmware ya puede leer `$PAIR010` para saber qué pedirle a la base.

## 6. PPS

- **`$PAIR752,<PPSType>,<PulseWidth>`** (§2.4.48, pp. 134–135):
  - tipo: 0 = apagado, 1 = después del primer fix, 2 = solo con fix 3D, 3 = con fix 2D o 3D, 4 = siempre;
  - **por defecto vale 2 en la AA y 1 en BA, CA, DA y EA**;
  - el ancho va de 1 a 999 ms, con 100 por defecto.
- **`$PQTMCFGPPS,W,1,<Enable>,<Duration ms>,<Mode>,<Polarity>,0`** (§2.3.24, pp. 65–66, **solo AA y AL**):
  - modo: 1 = siempre, 2 = fix 2D, 3 = fix 3D;
  - **polaridad: 0 = baja, 1 = alta**;
  - el ejemplo usa `1,1,100,1,1,0` (siempre, en alto, 100 ms);
  - desde la v1.5, el último campo es reservado (antes era un intervalo).
- **Decisión para el pod:**
  - **tipo 1, después del primer fix** (`$PAIR752,1,100*3A`): el pulso sigue aunque el jugador tape el cielo un rato, y la TDMA de LoRa necesita continuidad;
  - el firmware **marca cada PPS como confiable solo si la época de ese segundo tiene fix**, y si no, lo trata como reloj en retención;
  - en la AA, además, `$PQTMCFGPPS,R,1` para ver la polaridad (en alto, por el flanco que captura el PPI de [`pod-v0.md`](pod-v0.md));
  - si el banco muestra que el pulso sin fix se corre mucho, se pasa al tipo 2.
- **Precisión del PPS:** **no lo dice la especificación.** Está en la hoja del módulo o en el Hardware Design. Se mide contra el LG290P en el banco.

## 7. Guardar, volver a fábrica y versión

- **Guardar:** `$PAIR513*3D` (§2.4.46, pp. 132–133) o `$PQTMSAVEPAR*5A` (§2.3.2, pp. 38–39) pasan la configuración de la RTC RAM a la NVM.
  - **A más de 1 Hz va con el GNSS apagado** (`$PAIR382,1*2E`, `$PAIR003*39`, guardar, `$PAIR002*38`; nota 2, p. 133);
  - "If the backup domain cannot be powered after the power supply of the module is cut off, this command needs to be sent every time the parameters are modified" (nota 1).
- **Qué persiste:**
  - lo guardado en la NVM, más lo que queda en la RTC RAM mientras haya V_BCKP;
  - **`$PAIR382` nunca** se guarda;
  - el odómetro tampoco (`$PQTMODO`, p. 72), pero el pod no lo usa;
  - la especificación no da la lista completa. Por eso, como pide el [ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), el firmware **manda la configuración completa en cada arranque**;
  - **para no gastar la NVM**, consulta antes (`$PAIR051`, `$PAIR105`, `$PAIR067`, `$PAIR433`, `$PAIR437`, `$PAIR081`, `$PAIR865,0,0`) y **guarda solo si algo cambió**.
- **Volver a fábrica:**
  - `$PQTMRESTOREPAR*13` (§2.3.3, pp. 39–40) "takes effect after a reboot". En la AA restaura todos los comandos; en BA, CA, DA y EA, solo los PQTM, `$PAIR050` y `$PAIR062`;
  - `$PAIR007*3D` hace un frío completo y vuelve a fábrica (p. 96);
  - **ojo:** si la velocidad del UART vuelve a la de fábrica, el firmware tiene que volver a negociarla (ver UART).
- **Versión del firmware del GNSS** (para `firmware_info` del log, ASCII ≤ 64, [ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md)):
  - **`$PQTMVERNO*58`** (§2.3.1, pp. 37–38), sin nota de variante, responde `$PQTMVERNO,<VerStr>,<BuildDate>,<BuildTime>`; por ejemplo `LC29HAANR01A04S,2022/11/04,16:39:48`. **Se guarda la línea entera** (unos 36 caracteres);
  - `$PQTMVER` sale una sola vez al encender, en la AA y la AL (p. 78);
  - `$PQTMQVER` es solo de BA y CA (p. 88);
  - **`$PQTMUNIQID*16`** (p. 77, solo AA y AL) da el id único del chip, y `$PQTMSN` (p. 89, solo AA y AL) el número de serie del módulo. Los dos sirven para la tabla de dispositivos.
- **Respuestas:**
  - los PAIR responden `$PAIR001,<id>,<res>` (§2.4.1, pp. 92–93): 0 = ok, 1 = procesando (esperar otra respuesta), 2 = falló, 3 = no soportado, 4 = error de parámetro o de checksum, 5 = ocupado (reintentar);
  - los PQTM responden `,OK` o `,ERROR,<código>`: 1 = parámetro inválido, 2 = falló, 3 = no soportado (tabla 5, p. 37);
  - **el firmware registra cada comando no soportado**: así se detecta un cambio de variante o de firmware del módulo.

## 8. Interferencia y convivencia con LoRa

- **`$PAIR391,1*2C`** (§2.4.32, pp. 120–122): prende la detección de interferencia. Saca `$PAIRSPF,<s>` (L1) y `$PAIRSPF5,<s>` (L5, solo si se rastrea L5) **a 1 Hz**. Estados: 0 = desconocido, 1 = bien, 2 = aviso, 3 = crítico. Con interferencia continua pasa de 1 a 2 y después a 3.
- **`$PQTMJAMMINGSTATUS`** (§2.3.31, pp. 72–73, solo AA y AL): el mismo estado, por `$PQTMCFGMSGRATE`.
- **AIC** (cancelación activa de interferencia): `$PAIR074,1` (§2.4.21, p. 110, sin nota de variante) y `$PAIR075` para consultar. El valor por defecto **no lo dice la especificación**. `$PQTMCFGAIC` es solo de la LC79H(AL).
- **Para el pod:**
  - prender `$PAIR391` y guardar el estado en los eventos de salud del log, junto con las épocas marcadas con TX de LoRa;
  - el paso 19 del arranque de la v0 ([`pod-v0.md`](pod-v0.md)) mira si el E22 a potencia máxima mueve el `$PAIRSPF` o el `$PAIRSPF5`, y compara la C/N0 con AIC prendido y apagado;
  - la AIC actúa sobre portadoras angostas dentro de la banda. La TX de 915 MHz está fuera de banda, y lo que la frena es el SAW antes del LNA ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md)), no la AIC.

## Comandos de arranque recomendados

> **Derivado de la especificación y no probado.** Se valida en el banco ([`banco-gnss.md`](banco-gnss.md), B-901) y en la v0 antes de pasarlo al firmware (B-904).

**Checksum:** XOR de 8 bits de todos los caracteres entre `$` y `*`, sin incluirlos, en dos dígitos hexadecimales en mayúscula, y después `\r\n` (§2.1, pp. 13–15). Los de abajo se calcularon así y se probaron contra los ejemplos de la especificación (`$PQTMVERNO*58`, `$PAIR050,1000*12`, `$PAIR382,1*2E`, `$PAIR432,1*22`, `$PAIR752,2,100*39`, `$PQTMCFGPROT,W,1,1,5,1*3C` y otros). El firmware los arma con la misma función, sin tablas fijas.

**Reglas:**
- después de cada PAIR, esperar `$PAIR001,<id>,0`. Si llega `,1`, esperar otra respuesta; si llega `,5`, reintentar;
- tiempo límite de unos 500 ms por comando;
- entre `$PAIR003` y `$PAIR002`, al menos 2 s.

### LC29H(AA)

```text
# 0. Enlace y versión (siempre)
#    - Abrir UARTE0 a 921600. Esperar $PQTMVER (sale solo al encender) o mandar:
$PQTMVERNO*58                         -> guardar la respuesta entera en firmware_info
$PQTMUNIQID*16                        -> id del chip (tabla de dispositivos)
#    - Si no responde a 921600: abrir a 115200, mandar
$PAIR864,0,0,921600*10
#      y después guardar ($PAIR513*3D) y reiniciar ($PQTMSRR*4B o ciclo de VCC); volver a 0.

# 1. Consultar y comparar con la configuración esperada (si todo coincide, saltar al 4)
$PAIR051*3E      $PAIR105*3E      $PAIR067*3B      $PAIR081*33      $PAIR071*3C
$PAIR433*3E      $PAIR437*3A      $PQTMCFGPROT,R,1,1*3D

# 2. GNSS apagado, con los comandos todavía habilitados
$PAIR382,1*2E
$PAIR003*39

# 3. Configuración que necesita el GNSS apagado, y guardado
$PAIR050,100*22                       # 10 Hz
$PAIR104,1*22                         # doble banda L1 + L5
$PAIR066,1,1,1,1,1,0*3B               # GPS + GLONASS + Galileo + BeiDou + QZSS
$PAIR080,0*2E                         # modo normal (fitness, a evaluar en el banco)
$PAIR070,0*21                         # sin umbral estático
$PAIR410,0*23                         # SBAS apagado
$PAIR400,0*22                         # sin fuente de DGPS
$PQTMCFGPROT,W,1,1,1,5*3C             # UART1: entra NMEA, sale NMEA + RTCM3
$PAIR513*3D                           # guardar en la NVM
#    - esperar al menos 2 s desde $PAIR003
$PAIR002*38                           # GNSS prendido

# 4. Mensajes, crudo, PPS e interferencia (con el GNSS prendido)
$PAIR062,0,0*3E                       # GGA apagado
$PAIR062,1,0*3F                       # GLL apagado
$PAIR062,2,0*3C                       # GSA apagado
$PAIR062,3,10*0C                      # GSV a 1 Hz (C/N0 por banda)
$PAIR062,4,0*3A                       # RMC apagado
$PAIR062,5,0*3B                       # VTG apagado
$PAIR062,6,0*38                       # ZDA apagado
$PAIR062,7,0*39                       # GRS apagado
$PAIR062,8,0*36                       # GST apagado
$PAIR062,9,0*37                       # GNS apagado
$PQTMCFGMSGRATE,W,PQTMPVT,1,1*1C      # PVT en cada época
$PQTMCFGMSGRATE,W,PQTMVEL,1,1*11      # velocidad con su precisión
$PQTMCFGMSGRATE,W,PQTMEPE,1,2*1D      # error estimado de la posición (versión 2)
$PQTMCFGMSGRATE,W,PQTMDOP,10,1*25     # DOP a 1 Hz
$PQTMCFGMSGRATE,W,PQTMJAMMINGSTATUS,10,1*21
$PAIR432,1*22                         # RTCM3 MSM7 (crudo); el firmware guarda 1 Hz
$PAIR436,1*26                         # efemérides en RTCM
$PAIR434,0*25                         # sin 1005
$PAIR752,1,100*3A                     # PPS después del primer fix, 100 ms
$PQTMCFGPPS,R,1*6A                    # ver polaridad (1 = en alto)
$PAIR391,1*2C                         # detección de interferencia ($PAIRSPF / $PAIRSPF5 a 1 Hz)
$PAIR074,1*24                         # AIC prendida (comparar con 0 en la v0)

# 5. Registrar en el log config_applied (PVT 10 Hz, crudo 1 Hz, máscara de constelaciones y de bandas)
```

**Pendientes del banco:**
- si los comandos del paso 4 necesitan guardar o el GNSS apagado (la especificación no lo dice para `$PQTMCFGMSGRATE`, `$PAIR432` ni `$PAIR436`);
- si la AA acepta `$PQTMCFGPROT` sin reiniciar;
- si `$PAIR066` tiene efecto sin guardar ni reiniciar ("valid if the NVRAM data are valid").

Si hace falta guardar o reiniciar, el paso 4 pasa adentro del 3.

### Diferencias con la LC29H(EA)

```text
$PQTMCFGRCVRMODE,R*32                 # si no da 1:
$PQTMCFGRCVRMODE,W,1*2A               #   rover; después $PQTMSAVEPAR*5A y reiniciar
$PQTMCFGCNST,W,1,1,1,1,1,0*2A         # constelaciones (en vez de $PAIR066); guardar y reiniciar
$PAIR062,0,1*3F                       # GGA en cada época (calidad 4/5, edad de la corrección)
$PAIR062,4,1*3B                       # RMC en cada época (velocidad si no salen los PQTM)
$PAIR410,0*23                         # SBAS apagado (desde la v1.5 la EA lo soporta)
```

En la EA **no existen** `$PAIR104`, `$PAIR066`, `$PAIR080`, `$PAIR070`, `$PQTMCFGPROT`, `$PQTMCFGPPS`, `$PQTMBKP`, `$PQTMSRR`, `$PQTMVER` ni `$PQTMUNIQID`. El cambio de `$PAIR050` necesita un reinicio más. Las correcciones RTCM de la base se escriben tal cual por el mismo UART, entre comandos.

## Documentos de la página del LC29H

Lo que lista la [página del producto](https://www.quectel.com/product/gnss-lc29h/) (leída el 08/11/2026; la mayoría de las descargas pide una cuenta en el Download Zone de Quectel). Para el firmware del pod, marcados con ★ los que faltan leer:

**Especificación y folleto**
- LC29H Series GNSS Module Specification V2.0 ([PDF](https://www.quectel.com/content/uploads/2024/03/Quectel_LC29H_Series_GNSS_Module_Specification_V2.0.pdf)) ★ (precisión del PPS, consumos y TTFF por variante)
- Quectel Product Brochure V8.6

**Hardware y mecánica**
- LC29H Series Hardware Design V1.4 ★ (el repo citó la V1.0: confirmar que no cambiaron los pines ni el backup, punto 14 de [`pod-v0.md`](pod-v0.md))
- LC29H Series Reference Design V1.4
- LC29H(AA,AI,BA,CA,DA,EA,TI) Footprint & Part V1.4
- LC29H(AA,AI,BA,CA,DA,EA,TI) 3D Dimensions V1.3 y 2D Dimensions V1.3
- L89 R2.0 & LC29H(AA,BS) & LC79H(AL) EASY & EPOC Difference Introduction V1.0 ★ (EASY y EPOC son las órbitas extendidas propias del módulo)
- L26-T & LC29H(AI) Hardware Difference Introduction V1.0
- LC29D(C) & LC29H(CA) Hardware Difference Introduction V1.0

**Protocolo**
- LC29H & LC79H Series GNSS Protocol Specification V1.5 (este documento)
- L89(HD) & LC29H(AI) GNSS Protocol Specification V1.1

**Notas de aplicación**
- L89 R2.0 & LC02H & LC29H & LC79H Series **AGNSS** Application Note V1.5 ★ (inyección de EPO, hora y posición al sacar el pod de la base)
- LC29H & LC79H Series **Low Power Mode** Application Note V1.0 ★ (secuencia de backup)
- GNSS Low Power Mode Application Note V2.0
- LC29H(BA,CA,DA,EA) & LC79H(EL) **DR & RTK** Application Note V1.6 ★ (rover de la EA, edad máxima de la corrección)
- GNSS **RTK** Application Note V1.0 ★
- LC29H(EA) Moving Base Application Note V1.1
- LC29H(AA,BA,CA,DA) & LC79H(AL) OSNMA Application Note V1.1 (autenticación de Galileo)
- L89 R2.0 & LC29H Series & LC79H(AL) I2C Application Note V1.5
- LC29H Series SPI Application Note V1.0
- GNSS Antenna Application Note V1.0
- Convert NMEA Coordinates into Google Earth Application Note V1.0

**Herramientas, placas de evaluación y firmware**
- **QGNSS V2.5** ★ (el banco)
- L89 R2.0 & LC29H & LC79H Series **Firmware Upgrade Guide** V1.8 ★ (fijar y actualizar el firmware del módulo, [ADR 0106](../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md))
- LC29H Series EVB User Guide V1.1
- High Precision GNSS-DHAA-KIT EVB Kit User Guide V1.0
- List of EVB Applicable Modules V1.8
- GNSS Android HAL Driver User Guide V1.0

**Lo que no está en la página:** las **notas de versión del firmware** y los archivos de firmware del módulo. Se piden a Quectel (support@quectel.com o el FAE) junto con la pregunta de la tasa del crudo de la AA.
