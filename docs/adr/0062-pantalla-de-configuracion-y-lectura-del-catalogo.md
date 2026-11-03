# 0062. Pantalla de configuración: matriz por etapa, cambios con vigencia y lectura del catálogo del club

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #72 (B-409)

## Contexto

B-409 es la pantalla 6 de la web del staff: la batería de tests, las zonas de velocidad, las reglas de alerta y las referencias de primera. Los endpoints de escritura ya estaban (ADR 0040, ADR 0041), pero la pantalla necesita elegir de qué test programar una entrada y para qué métrica cargar una referencia, y el catálogo del club (`test_definition`, `metric_definition`, sembrados por club en B-306) no tenía lectura por la API. Sin eso, la web tendría que llevar una lista fija de tests y métricas, que se desincroniza del club en cuanto agregue un test propio o archive una métrica, y no sabría qué unidad lleva cada referencia. También había que decidir cómo se muestra y se edita configuración con vigencia sin reescribir la historia.

## Decisión

- **Lectura del catálogo.** Dos listas por cursor (ADR 0032) con `configuration.read`, como el resto de la configuración: `GET /v1/catalog/tests`, un ítem por código de test con la versión del protocolo vigente en `onDate` (por defecto, hoy en el club) o, si no hay ninguna, la última marcada con `inForce: false`, con deportes, cargas máximas, intentos y las métricas que produce; y `GET /v1/catalog/metrics`, el diccionario (unidad, sentido, origen, test, deportes, alias de Catapult, si es canónica), filtrable por deporte, origen, test y archivo. Son de solo lectura: el diccionario lo escriben los seeds, y su edición es otra decisión (las métricas canónicas no cambian su definición, principio 1). RLS de las tablas como piso.
- **Una pantalla, cuatro secciones con URL.** `/configuration?section=battery|speed-zones|alert-rules|references`, hija del layout del club. El deporte sale del selector del layout (con más de uno visible, la pantalla pide elegir) y la rama se elige en la pantalla. Leen `coach`, `sc`, `medical` y la administración; los controles de edición solo aparecen con `configuration.update`.
- **La batería como matriz test × etapa.** Cada celda es la batería resuelta (`/effective`) para el deporte, la rama, la etapa y, si se eligió, la categoría: lo que el grupo hace de verdad, no las filas sueltas. Debajo, la lista de entradas del deporte muestra qué fila pisa a cuál. Los tests de cargas máximas no se ofrecen para etapas que no los permiten.
- **Editar respeta la vigencia (ADR 0041).** Una entrada o configuración planificada se edita o se retira; una vigente se cambia "desde…" (alta con `closePrevious`, por defecto desde hoy en el club) o se deja de aplicar desde una fecha (`validTo`); una celda que hereda de una fila más general crea su propia entrada para esa etapa (y categoría). Las zonas nuevas se guardan para el deporte y la rama elegidos.
- **Validación en el cliente con el dominio.** El editor de zonas valida con `validateSpeedZoneSet` y el de reglas con `parseAlertRule` antes de enviar, las mismas funciones que usa la API, así el error aparece en el campo y no como un `400`. Una regla nueva parte de los valores por defecto de su tipo (`DEFAULT_ALERT_RULES`); la pantalla no tiene umbrales propios.
- **Textos en su archivo.** `packages/i18n/src/messages/web-configuration.ts` con claves `configuration.*`, incluidos los nombres de las métricas canónicas y de las zonas por defecto; un código sin nombre se muestra como código.

## Consecuencias

- La ficha del jugador, el día de test y la importación de Catapult pueden leer el catálogo por los mismos endpoints en vez de listas propias.
- La pantalla no muestra los umbrales propios de un jugador (filas de zonas con `playerId`): son de su ficha.
- La importación de una planilla de referencias (`POST /v1/reference-values/import`) queda para el importador de Catapult (#90), que arma el mismo payload; la pantalla carga, corrige, archiva y restaura de a una.
- Editar el diccionario de métricas o agregar versiones de protocolo desde la web necesita su propio issue y endpoints de escritura.
