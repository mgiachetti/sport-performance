# 0067. Ayuda y protocolos: lectura de los tests para todo miembro, material por versión solo para el staff y guía de uso en el catálogo de mensajes

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #78 (B-415)

## Contexto

B-415 pide el protocolo de cada test con texto e imagen o video, y una guía de uso para el staff, en la web y en la app. El texto del protocolo ya existía como dato del club: `test_definition.protocol` (resumen, pasos, pausa, equipo y parámetros), sembrado por versión desde el dominio (B-306, ADR 0027), con la versión guardada en cada resultado (principio 4). Pero ningún endpoint lo exponía, no había dónde guardar imágenes ni videos, y la matriz ya tenía `metric_catalog.read` ("diccionario de métricas, definiciones de tests y protocolos") para todo miembro del club. Faltaba decidir quién ve el material, a qué se ata, cuánto se guarda y dónde vive la guía.

## Decisión

### Lectura de los protocolos

- **`GET /v1/test-definitions`** (cursor, máximo 100; filtros `code`, `sport` y `validOn`, por defecto hoy en la zona del club) y **`GET /v1/test-definitions/{id}`**: cada versión con su protocolo completo (los campos que falten en el JSON salen vacíos, nunca ausentes) y las métricas que produce, con unidad y si se calculan. Permiso `metric_catalog.read`: el texto de un protocolo no es un dato personal y le sirve también al jugador (la app lo muestra).
- Editar el texto o crear una versión nueva no entra acá: es configuración del club (B-322) y cambia la comparabilidad de los resultados.

### Material: imágenes y videos

- **Tipo de archivo nuevo `protocol_media`** en la política del dominio (ADR 0044): PNG, JPEG, WebP, MP4 y WebM, hasta 100 MiB, del club (sin jugador ni categoría), `inline`, subido por el cliente con `PUT` firmado. Nunca SVG. Sube, confirma y borra quien tiene `configuration.update` (`sc` y la administración); lo ve quien tiene `configuration.read` (el staff).
- **Solo el staff ve el material**: un video de cómo se hace un test suele mostrar a una persona, a veces un jugador menor. El jugador y la familia leen el texto. La RLS lo sostiene igual: la política de `file` deja `protocol_media` al staff (como las planillas), y la tabla nueva también.
- **El material se ata a una versión del protocolo** (`test_protocol_media`: versión, archivo, descripción obligatoria y orden), no al código del test: si la versión 2 cambia la distancia de la cámara, el video de la 1 ya no la explica. Un mismo archivo puede ilustrar varias versiones o tests, una vez por versión. Una versión nueva arranca sin material hasta que se lo adjunte (B-322 decidirá si copia el de la anterior).
- **La descripción es obligatoria**: es el texto alternativo de la imagen y la descripción del video (accesibilidad, AA).
- **Archivar en vez de borrar** (ADR 0032): sacar una imagen del protocolo la archiva; se puede restaurar mientras el archivo exista.

### Retención

- **"Mientras se usa", como el escudo** (`while_in_use`, 30 días): confirmado y sin adjuntar vence a los 30 días; al adjuntarlo a un protocolo activo `expires_at` queda en `NULL`; al archivar el último adjunto activo vuelve a vencer a los 30 días. Adjuntar, archivar y restaurar toman el `FOR UPDATE` del archivo, el mismo que `DELETE /v1/files/{id}`, que responde `409` mientras un protocolo activo lo muestra.
- **El job de retención nunca purga material en uso** aunque `expires_at` diga otra cosa (misma defensa que el escudo): `purgeExpiredFiles` excluye los archivos con un adjunto activo.

### Guía de uso

- **La guía es texto del producto, no dato del club**: vive en el catálogo de mensajes (`packages/i18n/src/messages/web-help.ts`, `help.guide.*`), en rioplatense y con los términos de CLAUDE.md (bienestar y RPE, carga, días de test, maduración, alertas como heurísticas, privacidad de menores). Cambia con el producto, se traduce como el resto de la interfaz y un club la puede ajustar con sus overrides de terminología (ADR 0019).
- El vocabulario de un protocolo que comparten la web y la app (intentos y cuál vale, pausa, equipo, métricas) vive en `protocols.ts`; lo propio de la web, en `web-help.ts`.

### Pantallas

- **Web**: sección "Ayuda" (`/help`, permiso `metric_catalog.read`) con dos partes, Protocolos (los vigentes del deporte elegido) y Guía de uso; la ficha de un protocolo (`/help/protocols/$id`) con pasos numerados, intentos, pausa, equipo, métricas, versión y vigencia, y el material para el staff (URL firmada pedida al momento; si vence mientras la pestaña está abierta, se pide otra). `sc` y la administración suben desde el navegador: SHA-256 con `crypto.subtle`, `PUT` firmado sin cookies (`uploadToStorage` en los servicios de la web), confirmación y adjunto con `clientUuid`.
- **App**: pestaña "Protocolos" con la lista y la ficha en texto, para leer en la cancha. El material queda en la web.

## Alternativas descartadas

- **Material visible para todo miembro.** Un video de demostración puede mostrar a un menor; exigiría consentimiento de imagen de quien aparece, que el sistema no conoce. El texto alcanza para jugadores y familias.
- **Material por código de test.** Sobrevive a las versiones, pero mostraría una técnica que el protocolo vigente ya no pide sin que nadie lo note.
- **Links externos (YouTube) en lugar de archivos.** Sin control de quién ve ni de cuánto se guarda, y con datos de menores en un tercero.
- **La guía como datos del club en la base.** Agrega un editor y versiones de un texto que es del producto; los overrides de i18n ya cubren el ajuste de terminología.
- **Un recurso nuevo en la matriz para el material.** `configuration` ya expresa quién configura el club y quién lo lee.

## Consecuencias

- Migración `0035_protocol_media`: valor `protocol_media` del enum `file_kind`, tabla `test_protocol_media` (RLS: lee el staff, escriben `sc` y la administración, sin `DELETE`) y las políticas de `file` rehechas con el material solo para el staff. La política compara `kind::text` porque el valor nuevo del enum no se puede usar como literal en la transacción que lo agrega.
- B-322 (versiones de protocolo) define si una versión nueva copia el material de la anterior; B-505 (día de test en la app) muestra el protocolo en la estación desde estos endpoints o desde la sincronización, que ya baja `test_definition`.
- El material no se guarda sin conexión en la app: si hace falta en la cancha, se suma con la cola de archivos de B-604.
