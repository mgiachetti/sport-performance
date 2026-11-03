# 0063. Administración en la web: secciones por permiso del club, lector de Excel en el navegador y códigos estables de los problemas del padrón

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #74 (B-411)

## Contexto

La API ya tiene todo lo que administra un club: miembros y cambio de rol (ADR 0034), invitaciones (ADR 0028), asignaciones del staff (ADR 0034), perfil y marca del club con su escudo (ADR 0044), ramas y categorías, cambio de temporada (ADR 0049) e importación de padrón (ADR 0047). Faltaba la pantalla de la web del staff, y con ella tres decisiones que ninguna ADR tomaba:

- con qué permiso se muestra cada sección: varias acciones de la matriz son de categoría (`category.manage`, `data_import.run`), y un `sc` puede importar datos de Catapult en su categoría pero no el padrón del club;
- con qué se lee un `.xlsx`: ADR 0047 dejó el lector de Excel como dependencia de la web sin elegirlo;
- cómo se muestran en español los problemas que la API encuentra en cada fila del padrón: hasta ahora todos tenían el código `custom` y un mensaje en inglés para desarrolladores.

## Decisión

- **Una ruta `/admin` con una subruta por sección** (usuarios y roles, invitaciones, asignaciones, marca del club, categorías, temporadas, importar padrón), hija de `_club` como toda pantalla (ADR 0057), y una entrada "Administración" en la navegación con `membership.read`. Cada sección declara **todos** los permisos que necesita y se evalúan con `can()` **sobre el club entero**, sin categoría ni jugador: el alcance de la administración. Así un `coach`, `sc` o `medical` no ve ninguna sección aunque tenga `data_import.run` o `category.read` en lo suyo; si abre el link, ve "No tenés permiso". La API decide igual.
- **Temporadas:** la sección muestra las temporadas activas y lleva al **cambio de temporada** de cada una (pedir la propuesta, revisar jugador por jugador, aplicar con la `version` de la propuesta o descartarla). Crear y editar temporadas y ventanas es del calendario (B-406): una sola pantalla para cada cosa.
- **Excel con `read-excel-file`** (MIT, sin dependencias nativas, lee `.xlsx` en el navegador), cargado bajo demanda solo en esta pantalla. Se lee la primera hoja; las celdas de fecha llegan como fecha (medianoche UTC) y se pasan como `aaaa-mm-dd`, además del formato propio `dd/mm/yyyy` que usan casi todas las planillas en es-AR. Un `.xls` viejo no se lee: se pide guardarlo como `.xlsx`. El CSV se decodifica como UTF-8 y, si los bytes no lo son, como Windows-1252, que es lo que escribe Excel en castellano. Las dos lecturas terminan en `rosterRowsFromTable` del dominio; el archivo no sale del navegador.
- **Códigos estables por problema de fila** (`ROSTER_ROW_ISSUE_CODES` del dominio: `future_date`, `duplicate_row`, `resolution_required`, `category_not_found`, `position_not_found`, `self_guardian`…) en el `code` de cada problema de la vista previa y del `validation_failed` de la importación, en lugar de `custom`. El `path` sigue diciendo el campo y el `message` sigue siendo para desarrolladores. Los problemas del contrato (zod) conservan sus códigos y la web los muestra como "el dato no es válido" con el campo.
- **Filas que la planilla no pudo leer** (una fecha imposible, un sexo que no se entiende) no se mandan: se listan con fila, columna y valor, y para importar sin ellas hay que marcarlo a propósito. Lo demás es todo o nada, como dice ADR 0047.
- **Invitaciones de tutores después de importar:** la web manda una por cada `invitationsToSend` (rol `parent`, jugador y vínculo) a pedido del staff, con el resultado de cada una; reintentar manda solo las que faltan.
- **Escudo:** `POST /v1/files` con tipo, tamaño y SHA-256 calculado en el navegador, `PUT` directo a la URL firmada (el único pedido de la web que no va a la API: URL y headers vienen firmados de ella), confirmación y `PATCH /v1/club` con `logoFileId`. La web valida tipo y tamaño antes de pedir la subida.

## Consecuencias

- La web tiene una dependencia más (`read-excel-file`) que solo carga la pantalla del padrón; Dependabot la sigue como al resto.
- Un cliente nuevo (la app, otra web) puede mostrar los problemas del padrón en su idioma con el `code`; agregar un problema nuevo es agregar el código al dominio y su texto en `packages/i18n` (un test lo exige).
- El `connect-src` de la web en producción tiene que permitir el origen del bucket para el `PUT` del escudo (B-701, despliegue).

## Alternativas consideradas

- **SheetJS (`xlsx`)**: la versión de npm quedó vieja y con avisos de seguridad; la nueva se distribuye fuera de npm. `exceljs` pesa mucho más para leer una hoja.
- **Mostrar el `message` en inglés de la API** o traducirlo en la web por texto: frágil y sin idioma; el código estable es lo que ya hacen el resto de los errores (ADR 0020).
- **Una pantalla por sección en la navegación principal**: llenaba la barra lateral de entradas que solo usa la administración.
