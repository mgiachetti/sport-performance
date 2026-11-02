# 0049. Cambio de temporada: propuesta por año de nacimiento, revisión obligatoria y aplicación única

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #47 (B-316)

## Contexto

B-316 pide el pase de categoría por año de nacimiento al iniciar la temporada, con revisión manual, y que la historia quede en `player_category`. El plantel (B-315, ADR 0035) ya tenía el pase individual (`POST /v1/players/{id}/categories`), con sus reglas: una pertenencia por categoría sin superposición, de la rama del jugador, el lock por jugador y `valid_to` exclusivo. El calendario (B-317, ADR 0036) define la temporada como el año de planificación del deporte. Las franjas de edad del dominio (`DEFAULT_AGE_BANDS`) cuentan la edad "alcanzada en el año de la temporada" (`año − año de nacimiento`), y cada categoría del club apunta a una franja (`age_band_code`).

Faltaba decidir qué año decide la categoría, qué pasa con los casos que no son automáticos (un club con "M15 A" y "M15 B", un jugador que juega "para arriba", el que pasó la edad de juveniles), cómo se revisa y aplica un cambio que toca a todo el plantel de un deporte sin pisar lo que el staff hizo a mano entre la propuesta y la aplicación, y quién lo hace.

## Decisión

- **El año que decide es el del primer día de la temporada** (`seasonRolloverYear`). En Argentina la temporada (febrero a noviembre) no cruza de año; un club cuya temporada cruza cuenta el año de inicio.
- **La propuesta es una función pura del dominio** (`proposeSeasonRollover`): para cada jugador, la franja de su edad y la única categoría activa de **su rama** (deporte y sexo) con esa franja. El motivo queda en `proposal`: `birth_year` (pasa), `already_there` (ya está), `ambiguous` (más de una categoría activa para la franja: el club la dividió), `no_category`, `aged_out` (mayor que toda franja) y `too_young`. Solo `birth_year` propone mover; el resto propone `stay`. Así la puede reutilizar el worker (#57) para crear el borrador solo.
- **Revisión obligatoria donde no hay automatismo.** `needs_review` marca a los que la propuesta no resuelve (`ambiguous`, `no_category`, `aged_out`, `too_young`), a los que juegan en más de una categoría y a los que el pase bajaría de franja (jugaban para arriba). No se aplica mientras alguno de ellos no fue revisado (`409`). Revisar es decidir `move` (con una categoría activa de la rama del jugador) o `stay`; confirmar la propuesta también cuenta como revisión. La baja del que terminó juveniles (`graduated`) la sigue haciendo la administración en la ficha (ADR 0035): el cambio de temporada no da bajas.
- **Modelo** (migración `0024_season_rollover`): `season_rollover` (temporada, `effective_on`, año usado, estado `draft` / `applied` / `cancelled` con quién y cuándo) y `season_rollover_item` (una fila por jugador: edad, franja, propuesta, categoría propuesta, `needs_review`, decisión y categoría destino, revisión, resultado y la pertenencia creada). Un solo borrador por temporada (índice único parcial). Lo que calculó la propuesta no cambia; la decisión, la revisión y el resultado cambian solo en borrador, y una propuesta aplicada o cancelada queda fija como registro (triggers `season_rollover_guard` y `season_rollover_item_guard`, también para el dueño; los `*_by` pueden pasar a `NULL` cuando se borra la cuenta del autor). No se borra: un borrador que no se aplica se cancela.
- **Quién.** Solo la administración: `season.manage` para el cambio y `category.manage` para cada categoría destino (la misma regla del pase individual). Es el plantel de un deporte entero con fechas de nacimiento: la RLS de las dos tablas también es solo de `admin` y `superadmin` (y el worker en su club).
- **Participan** los jugadores activos del deporte de la temporada dados de alta hasta `effective_on` (por defecto, el primer día de la temporada; siempre dentro de ella). Sus categorías "actuales" para la propuesta son las vigentes el día anterior o que empiezan ese día.
- **La aplicación es única, atómica y decide con el estado de ese momento.** `apply` exige la `version` de la propuesta (cada revisión la cambia: se aplica lo que se revisó) y corre en una transacción con el lock del plan de la temporada y el lock de cada jugador (el mismo `player:<id>` de los pases manuales, en orden de id para no cruzarse). A cada jugador con `move` le cierra las pertenencias vigentes en `effective_on` (`valid_to = effective_on`) y le abre la nueva desde ese día con `season_id`. El borrador puede tener días: un jugador que se dio de baja queda `skipped_left`; uno con una pertenencia que empieza ese día o después (un pase manual ya hecho) o dado de alta después, `skipped_later_membership` (se corrige a mano, nunca se pisa); una categoría destino archivada o de otra rama, `skipped_category_unavailable`; uno que ya está en la categoría, `stayed`. Volver a aplicar devuelve el cambio como está. La temporada tiene que seguir activa y contener el día (`409` si no).
- **La historia queda en `player_category`:** las pertenencias anteriores se cierran, nunca se borran, y los resultados ya cargados conservan la categoría en la que se midieron. Los ítems muestran las categorías previas (vigentes el día anterior al pase) también después de aplicar.
- **Endpoints** (tag `players`, convenciones del ADR 0032): `POST`/`GET /v1/seasons/{seasonId}/rollovers`, `GET /v1/season-rollovers/{id}` (con contadores de revisión y de resultados), `GET …/items` (paginado por nombre o nacimiento, filtros por propuesta, decisión, resultado, `needsReview`, `reviewed` y categoría destino), `PATCH …/items/{itemId}` con `version`, `POST …/apply` y `POST …/cancel`.

## Alternativas descartadas

- **Pasar a todos automáticamente con un job y corregir después.** Un pase equivocado cambia lo que ve cada entrenador (`app.visible_player_ids`) y la categoría de lo que se mida desde ese día; los casos no automáticos (categorías divididas, jugadores que juegan para arriba) son justo los que el club decide a mano.
- **Revisar en la web y mandar la lista final en un solo `POST`.** Pierde quién revisó qué, no deja revisar entre varias personas ni en varios días y obliga a la web a recalcular la propuesta.
- **Aplicar sin la `version` de la propuesta.** Dos administradores revisando a la vez podrían aplicar algo que ninguno vio completo.
- **Recalcular la propuesta al aplicar.** Pisaría las revisiones; en cambio cada jugador se decide con su estado de ese momento y lo que cambió queda salteado con su motivo.
- **Usar el pase individual (`addPlayerCategory`) por cada jugador desde la web.** Cientos de requests sin atomicidad: un corte a mitad deja medio plantel pasado.

## Consecuencias

- El worker (#57) puede crear el borrador cuando se acerca el inicio de cada temporada con `proposeSeasonRollover`, y las notificaciones (#59) avisar a la administración que hay una propuesta para revisar; ninguno de los dos está en este issue.
- La etapa por defecto de un jugador cambia con su categoría (ADR 0035, B-204): el recálculo de etapas y de cálculos derivados que dependen de la categoría lo hace el worker (#57) después de aplicar.
- La web del staff (#69) tiene una sola lista paginada para revisar, con filtros por lo pendiente.
- Un club que necesite franjas propias (otra edad de corte) las tiene que modelar como datos del club; hoy las franjas son las del dominio.
