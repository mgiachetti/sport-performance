# 0090. Datos de cancha de hockey: reglas de cancha por deporte en el dominio, minutos por tramo con su suma en la base, sin contactos y alias de Catapult por deporte

- Estado: Aceptado
- Fecha: 2026-11-04
- Issue: #110 (B-803)

## Contexto

El modelo tiene `sport` desde el día uno (ADR 0017) y M8 suma lo específico de hockey sin bifurcar el código. En la cancha, hockey se distingue de rugby en cuatro cosas:

- **Cambios ilimitados.** Una jugadora entra y sale muchas veces en un partido. Un total de minutos esconde cuánto jugó en cada cuarto, que es como el cuerpo técnico mira la rotación.
- **No hay contactos.** `contacts_n` es una métrica de rugby (tackles, rucks, scrums) y el nivel de contacto de un bloque también. Hasta ahora la API, la web y la app los pedían igual en hockey.
- **Otra cancha.** El mapa de calor (pod, Fase 3; ADR 0005 y 0061) necesita las medidas del lienzo, que en hockey son 91,4 × 55 m.
- **Otra exportación de Catapult.** La primera de hockey exporta desde OpenField con los mismos nombres de columnas para lo común. Una exportación de hockey nunca debe llenar una métrica de rugby, aunque traiga una columna "Contacts" o "Scrum Count".

Faltaba decidir:

- dónde viven esas reglas;
- cómo se guardan los minutos por tramo sin que el total se desvíe;
- qué pasa con el reloj por campo de la sincronización (ADR 0050) cuando total y tramos se escriben desde dos teléfonos;
- qué se rechaza;
- cómo se resuelven los alias de Catapult por deporte.

## Decisión

- **Reglas de cancha por deporte como datos del dominio.**
  - `SPORT_FIELD_RULES` en `packages/domain/src/training/field-rules.ts` tiene, por deporte:
    - la modalidad de cambios (`limited` o `rolling`);
    - si registra contactos;
    - los tramos de un partido reglamentario;
    - la cancha en metros;
    - la fuente de cada valor.
  - Rugby: cambios limitados, contactos, 2 tiempos, 100 × 70 m (World Rugby, Leyes 1, 3 y 5). Hockey: cambios ilimitados, sin contactos, 4 cuartos, 91,4 × 55 m (FIH, Rules of Hockey). Hay que verificar los valores contra el reglamento vigente antes de producción.
  - La API, la web y la app evalúan los mismos datos (`sportRecordsContacts`, `recordsPeriodMinutes`, `periodMinutesIssues`). Sumar un deporte es sumar una fila, nunca un `if` por nombre.
  - **No son configuración del club.** Son reglas del deporte, no umbrales ni referencias: la base no guarda una copia por club. Si un formato juvenil cambia la cantidad de tramos, la participación acepta de 1 a `MATCH_PERIODS_MAX` (8) tramos. La cancha de una sede real (orientación, esquinas) la calibra el pod en cada sesión (F3); la reglamentaria es el lienzo por defecto.
- **Minutos por tramo en la participación.**
  - `participation.period_minutes smallint[]` guarda los minutos de cada tramo en orden. Solo va en partidos de deportes con cambios ilimitados.
  - `minutes` es siempre la suma de los tramos. Un `CHECK` lo garantiza: el arreglo es de una dimensión, empieza en 1, tiene de 1 a 8 tramos sin huecos y cada tramo va de 0 a 600. Ausente y no disponible no llevan tramos, igual que con los minutos.
  - En la API, mandar `periodMinutes` fija los minutos como su suma; mandar `minutes` sin tramos guarda un total y borra los tramos; `periodMinutes: null` los borra y deja el total.
  - El contrato rechaza minutos que no sean la suma y tramos que sumen más de 600 minutos (el tope de cualquier participación), así que la suma nunca llega al `CHECK` de la base como un error interno. La API rechaza tramos en un entrenamiento o en rugby, y un tramo más largo que el partido planificado entero (`validation_failed` en el campo). Ese tope por tramo es deliberadamente laxo: comparar cada tramo con la duración planificada dividida por la cantidad de tramos rechazaría prórrogas, tiempo agregado y formatos juveniles con tramos desparejos.
  - El historial de cambios (ADR 0030) registra la columna como cualquier otra: corregir un tramo ya cargado pide motivo.
  - La exportación del club suma la columna `minutos_por_tramo`.
- **Total y tramos son un solo campo en la sincronización.**
  - El trigger del log de cambios estampa `period_minutes` con su propio reloj. Un cambio de tramos que deja la misma suma no toca `minutes`, así que el reloj de `minutes` solo no lo registraría.
  - El motor (`apps/api/src/sync/operations.ts`) resuelve el campo `minutes` de una mutación (total o tramos) contra el reloj más nuevo de los dos y, si gana, estampa los dos.
  - Así, un total cargado a mano en un teléfono y los tramos del reloj de cancha de otro nunca quedan mezclados: gana la edición más nueva entera.
  - La app superpone la cola con la misma regla (los tramos fijan el total y un total borra los tramos).
- **Sin contactos en hockey.**
  - La API rechaza `contactsN` con valor en participaciones de hockey y un nivel de contacto distinto de `none` en bloques de hockey (`validation_failed`).
  - Mover una sesión a otro deporte o pasar un partido a entrenamiento cuando ya tiene datos que no corresponden (contactos o niveles de contacto en hockey, tramos fuera de un partido con cambios ilimitados) es `409`: primero se corrigen los datos.
  - La web oculta la columna de contactos y el nivel de contacto de los bloques. La vista de sesión en cancha no muestra la tarjeta "Contactos". La app oculta el contador.
- **Web.** En un partido de hockey, la planilla de participación tiene una columna por tramo y el total calculado. "Todos presentes" reparte los minutos planificados entre los tramos.
- **Mobile.** En un partido de hockey, cada pausa del reloj de cancha (ADR 0080) cierra un tramo: el botón dice "Terminar el tramo". Al terminar, a cada jugadora se le pasan los minutos de cada tramo, y el total es la suma de los tramos redondeados. Escribir un total a mano reemplaza los tramos. El borrador guarda los tramos y los cierres del reloj; un borrador de una versión anterior sigue leyéndose.
- **Cancha para el mapa de calor.** `GET /v1/training-sessions/{id}/field-metrics` devuelve `fieldRules` con la cancha del deporte, la modalidad de cambios, los tramos y si registra contactos. No incluye `source` (la cita del reglamento): es documentación para quien mantiene la tabla en el dominio, no un dato que la pantalla muestre, y mandarla en cada respuesta solo agrandaría el contrato. El mapa de calor la toma cuando haya posiciones x/y del pod (F3).
- **Alias de Catapult por deporte.**
  - `catapultAliasIndex(metricas, deporte)` es una función pura del dominio. Arma el índice columna normalizada → métrica con las métricas activas que aplican al deporte (`metric_definition.sports`).
  - Un alias de dos métricas del mismo deporte es un conflicto y no mapea a ninguna: el importador pregunta en vez de adivinar.
  - En hockey, "Contact Involvements", "Scrum Count", "Kick Count" y "Time to Feet" no mapean a nada.
  - `normalizeCatapultAlias` pasa al dominio. El paquete de la base la reexporta.
  - Las columnas propias de la exportación de la primera de hockey (parámetros personalizados) se suman como datos (`catapult_aliases`, o métricas del club con `sports = {hockey}`) cuando el club la mande (B-002).
- **Club demo.**
  - Los partidos de hockey cargan minutos por cuarto: la arquera juega todo y el resto rota.
  - Hockey nunca tiene contactos.
  - Las sesiones de M17 y M19 de hockey también tienen totales de Catapult, con más metros por minuto que rugby y sin contactos.

## Alternativas descartadas

- **Tabla de stints (entrada y salida de cada jugadora con hora).** Es más fino, pero es otra colección para sincronizar, otra RLS y otro historial para un dato que el cuerpo técnico lee por cuarto. Los cierres del reloj del teléfono ya dan los tramos, y el detalle por segundo lo traerá el pod.
- **Tramos sin `minutes` (total calculado al leer).** Rompe la columna generada `srpe_au`, la carga diaria del worker y todas las lecturas que ya usan `minutes`. El `CHECK` da el mismo resultado sin mover nada.
- **Total y tramos como campos independientes en la sincronización.** Dos teléfonos podían ganar uno cada uno y dejar un total que no es la suma; la base lo rechazaría y la mutación quedaría rechazada sin culpa de nadie.
- **Reglas de cancha por club en la base.** Agrega una tabla con RLS y una pantalla para datos que fija el reglamento. Lo que sí varía en juveniles (cantidad de tramos) ya lo admite la participación.
- **Una lista de alias por deporte en `metric_definition`.** OpenField nombra las columnas igual en los dos deportes. El deporte de la métrica ya dice qué puede llenar una exportación de hockey.
- **Dejar `contactsN` en hockey y ocultarlo en pantalla.** Una importación o un cliente viejo podría cargarlo y aparecería en la carga y en las exportaciones.

## Consecuencias

- El importador de Catapult (#90, B-601) usa `catapultAliasIndex` con el deporte de la sesión. También puede llenar `periodMinutes` desde los períodos de OpenField cuando la primera los exporte por cuarto.
- Un club con otro formato juvenil (por ejemplo, dos tiempos en hockey) carga tantos tramos como tenga el partido, hasta 8. La web muestra la cantidad reglamentaria o la mayor que ya se haya cargado.
- Las pantallas que muestran minutos no cambian: `minutes` sigue siendo el total.
