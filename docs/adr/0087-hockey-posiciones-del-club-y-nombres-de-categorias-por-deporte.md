# 0087. Hockey: posiciones del club dentro de líneas fijas del deporte y nombres de categoría por deporte como datos

- Estado: Aceptado
- Fecha: 2026-11-04
- Issue: #108 (B-801)

## Contexto

El deporte y el sexo están en el modelo desde el día uno (ADR 0017), y el seed ya trae las cuatro posiciones de hockey sobre césped con su línea (arquera, defensora, volante, delantera; ADR 0027). B-801 pide que el hockey tenga **sus posiciones y los nombres de categorías del club**. Faltaba:

- Las categorías de hockey se sembraban con la etiqueta de la franja de rugby (`M15`), cuando en el hockey juvenil argentino se habla de "Sub 15" o de las divisiones del club ("Séptima", "Sexta", "Quinta").
- La tabla `position` tenía `label` (texto del club) y `line_code`, pero ninguna API para cambiarlos: el club no podía llamar "Líbero" a una defensora, sumar una posición propia ni dejar de ofrecer una que no usa.

Las referencias de primera y los percentiles se agrupan por posición o por línea (ADR 0040), así que lo que el club cambie no puede romper esa comparación.

## Decisión

- **Nombres de categoría por deporte, como datos del dominio.** `DEFAULT_CATEGORY_NAMES` (`packages/domain/src/category.ts`) da el nombre por defecto de cada franja en cada deporte: rugby `M13`…`M19`, hockey `Sub 13`…`Sub 19`, con el mismo número que la franja (`Sub 15` = franja `m15`, 15 años cumplidos en el año de la temporada). `defaultCategoryName(sport, band)` lo usan el bootstrap del club (seed de ORC, alta de club y habilitar rama) y `POST /v1/categories` sin `name`. El bootstrap sigue sin renombrar nada que el club ya tenga.
- **El nombre es solo texto; la franja manda.** Edades, etapa, percentiles visibles y rankings salen de la franja (`age_band_code`), nunca del nombre. Los nombres reales de las divisiones de cada club ("Séptima (2013)") los carga la administración en la web (B-005 es un dato del club, no del código). La redacción "Sub N" se verifica con cada club antes de producción.
- **Líneas fijas por deporte.** `POSITION_LINE_CODES` (dominio): rugby `forwards` / `backs`; hockey `goalkeepers` / `defenders` / `midfielders` / `forwards`. Una posición siempre está en una línea de su deporte (lo valida la API con `isPositionLineOf`), así las referencias y los percentiles por línea siguen siendo comparables entre clubes.
- **Posiciones del club.** Solo la administración (`category.manage` de la matriz, como las categorías; la RLS de `position` ya deja escribir solo a `admin` y `superadmin`):
  - `PATCH /v1/positions/{id}`: texto propio (`label`, 1–40 caracteres; `null` vuelve al nombre del catálogo), línea y orden, con `version` y `409`. El deporte y el código no cambian.
  - `POST /v1/positions`: una posición propia (código `snake_case` en inglés, texto obligatorio, línea del deporte, orden por defecto al final), idempotente por `clientUuid`; código repetido en el deporte es `409`. El deporte tiene que tener una rama activa.
  - Una posición propia no tiene nombre en el catálogo de i18n: su `label` nunca puede quedar en `null`.
  - `POST …/archive` y `…/restore`, idempotentes; archivada no se edita (`409`). **Nunca se borra**: `position.archived_at` (migración `0045_positions_of_the_club`, con chequeo de formato del `label`).
- **Una posición archivada se conserva y no se asigna de nuevo.** Quien la tiene la sigue teniendo (y se muestra); el alta y la edición del jugador la rechazan si el jugador no la tenía, y la importación de padrón no la resuelve salvo para un jugador que ya la tiene. `GET /v1/positions` devuelve solo las activas por defecto (`status=active|archived|all`); las pantallas que nombran posiciones ya asignadas piden `all`.
- **La importación reconoce los nombres del catálogo** ("Arquera", "volante", "DELANTERA") además del código y del texto propio del club, siempre dentro del deporte de la fila.
- **Web:** Administración → Categorías suma "Posiciones de {deporte}" por cada deporte con rama activa: nombre, línea, orden y estado (ícono y texto), editar, sumar, archivar y restaurar. La ficha del jugador muestra el nombre de la posición (texto del club o del catálogo), no el código.

## Alternativas descartadas

- **Más posiciones de hockey en el seed** (líbero, lateral, volante central, enganche, wing…). Cada club las nombra distinto y no todos las usan; las cuatro líneas son lo común y el resto lo suma cada club con su nombre.
- **Líneas libres por club.** Romperían la comparación de referencias y percentiles por línea entre clubes y contra primera.
- **Divisiones de dos años como categoría** (por ejemplo, Sexta = 14 y 15 años). Una categoría mezclaría franjas con reglas distintas (percentiles propios desde M15, cargas máximas desde M15); el club crea una categoría por franja y la nombra como quiera.
- **Nombres de categoría en `packages/i18n`.** No son texto de interfaz: son el valor inicial de un dato del club que después se edita; viven en el dominio junto a las franjas.
- **Historial de cambios para posiciones.** `change_history` es por jugador (ADR 0030); la estructura del club (categorías, ramas, posiciones) queda con `updated_by` y `updated_at`, como hasta ahora.

## Consecuencias

- Un club existente conserva los nombres de categoría que ya tenía (`M15` en hockey incluido): el bootstrap no renombra. Si quiere "Sub 15", lo cambia en la web.
- La batería de hockey (B-802), los datos de cancha (B-803) y los umbrales femeninos (B-804) se apoyan en estas posiciones y líneas sin código distinto por deporte.
- Una referencia de primera cargada para una posición archivada sigue valiendo y se sigue mostrando con su nombre.
