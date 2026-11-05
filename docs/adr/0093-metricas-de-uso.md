# 0093. Métricas de uso: instrumentación propia en la API, uso por miembro con retención y conteos semanales sin miembros

- Estado: Aceptado
- Fecha: 2026-11-04
- Issue: #105 (B-707)

## Contexto

B-707 pide medir la adopción (respuestas de bienestar, días de test cargados, uso del panel) con instrumentación propia y respetuosa de la privacidad, sin SDK de terceros en la app de menores. Es lo que el piloto de 4 semanas revisa (B-709) y lo que después dice si un club usa la plataforma. Faltaba decidir qué se mide y de dónde sale, quién lo registra (la app, la web o la API), qué se guarda de cada uso y cuánto tiempo, quién lo lee, y cómo no mezclar el soporte del superadmin ni el club demo (ADR 0055) con el uso real.

## Decisión

- **Dos fuentes, sin eventos inventados.** Los resultados de la adopción se cuentan de los datos que ya existen: bienestar (`wellness`), RPE (`participation`), días de test y resultados (`test_result` con su `test_session`), con el canal del kiosco que ya guarda cada fila (ADR 0086). Solo el uso de las pantallas necesita registro propio, porque no deja datos.
- **Lo registra la API al servir la pantalla, no un SDK del cliente.** Una ruta de la API se marca con `usage: <superficie>` (`registerEndpoint`), y cuando el handler responde bien se llama a `app.record_usage(superficie, cliente)` en la misma transacción del pedido: un pedido que se revierte no registra nada. Ni la web ni la app suman código ni dependencias, la app de menores no habla con terceros y el registro no depende de que el cliente coopere. El cliente es `app` si el pedido trae los headers de la app (ADR 0045) y `web` si no.
- **Una lectura canónica por superficie**: `panel` (`GET /v1/panel/weekly`, web y tablero del staff en la app), `player_profile` (seguimiento diario de la ficha), `test_day_sheet` (planilla del día de test), `player_home` (`GET /v1/me/player`), `guardian_home` (hijos/as del tutor) y `kiosk` (plantel del kiosco). Una pantalla que hace varios pedidos registra uno solo; `events_n` cuenta pedidos, no tiempo de uso.
- **El registro nunca rompe el pedido**: corre en un savepoint; si falla, se revierte el savepoint, se loguea el código sin datos y la respuesta sigue (como el último uso de la sesión, ADR 0033).
- **`app.record_usage` es la única escritura** (`SECURITY DEFINER`, `search_path` fijo, solo para `sport_performance_app`). Toma la membresía y el rol del contexto validado (`app.current_role()`) y el día de `app.club_today()`: nadie registra por otro, en otro club ni en otro día. El rol de conexión de la API no tiene `INSERT`, `UPDATE` ni `DELETE` sobre las tablas. El superadmin con acceso de soporte no registra: el soporte no es uso del club.
- **Lo mínimo por uso** (`usage_activity`): membresía, rol, día del club, superficie, cliente y cantidad de veces, una fila por miembro, día, superficie y cliente. Nunca qué se leyó, de qué jugador, la IP ni el dispositivo. Las columnas de auditoría de toda tabla del club (ADR 0023) dejan la hora del primer y del último uso del día; se van con la fila.
- **Retención de 91 días y conteos semanales sin miembros.** Las semanas ISO enteras que terminaron hace 91 días o más (`usageRetainedFrom`, sobre el día del club) se pliegan en `usage_weekly`: por semana, superficie, cliente y rol, miembros distintos, días de uso y veces, sin ninguna membresía. El plegado y el borrado van en una sola sentencia del job `usage-fold-club` del worker (un job por club, `stately`, reintentos y cola de muertos, cron diario `usage-daily` como la retención de archivos, ADR 0046). El worker es el único que borra filas de uso. Una semana nunca queda partida entre las dos tablas; si un plegado posterior encontrara filas de una semana ya plegada (un club que cambió de zona horaria), suma sus conteos.
- **La lectura** es `GET /v1/usage/summary?weekOf=&weeks=` (1 a 26 semanas, por defecto 4), permiso nuevo `usage_metrics.read` solo para la administración (y el superadmin con acceso de soporte). Nunca el staff: los conteos de quién usa qué son sobre el staff mismo. Bajo RLS solo `admin` y `superadmin` leen las dos tablas. La respuesta son solo conteos por semana: sesiones, jugador × día con sesión y con bienestar ese día, participaciones con y sin RPE, cargas en el kiosco, plantel y bienestar por categoría, días de test con resultados, resultados (los importados aparte), jugadores medidos, uso por superficie, cliente y rol, y membresías activas por rol de cada semana como denominador. Las tasas (bienestar en días de sesión, RPE) las calcula `trainingAdoptionRates` del dominio, igual en la API y en la web. Ninguna fila nombra a un miembro ni a un jugador, y no hay rankings.
- **El club demo** se lee igual pero la respuesta dice `isDemo` y la web lo avisa: nunca se mezcla con los clubes reales.
- **Web**: sección "Uso" (`/usage`) de la administración con las cuatro tablas (bienestar y RPE, bienestar cargado, días de test, uso de las pantallas), el período elegible y el aviso de la retención.

## Alternativas descartadas

- **Un SDK de analítica (PostHog, Amplitude, Firebase, Sentry como analítica)**: datos de uso de menores en un tercero, otra dependencia en la app y un consentimiento más que pedir. Lo que el piloto necesita son conteos por semana que la base ya puede dar.
- **Eventos desde el cliente (`POST /v1/usage/events`)**: mediría también las pantallas abiertas sin señal desde la caché, pero suma código y una cola en cada cliente, y un cliente puede mandar cualquier cosa. El uso sin señal deja su huella en los datos que se sincronizan (bienestar, RPE, resultados), que son lo que importa.
- **Solo conteos agregados desde el primer día, sin miembros**: no permite contar miembros distintos por semana, que es la pregunta ("¿cuántos entrenadores abrieron el panel?"). Se guardan los miembros lo justo para el período del piloto y un trimestre, y después solo conteos.
- **Seudónimos rotativos (hash del miembro con sal por semana)**: dan miembros distintos sin guardar la membresía, pero la sal tiene que vivir en algún lado y la RLS por membresía (borrar la cuenta borra su uso) se pierde. La retención corta logra lo mismo con menos piezas.
- **Contar los pedidos en los logs (pino)**: los logs no tienen datos personales (ADR 0016) y no son una base consultable por club.

## Consecuencias

- Una pantalla nueva que interese medir suma su superficie al dominio (`USAGE_SURFACES`), un valor al enum `usage_surface` (migración) y `usage: '<superficie>'` en su ruta canónica; el mensaje `usage.surface.<superficie>` lo exige un test.
- La exportación de datos del titular (ADR 0051) no incluye el uso: no cuelga del jugador sino de la membresía, y se borra con la cuenta (`ON DELETE CASCADE`) o a los 91 días.
- Una vista de la plataforma que cruce clubes (adopción de todos los clubes reales, sin el demo) queda para cuando haya más de un club en uso; hoy el superadmin lee cada club con su acceso de soporte.
- El uso de la app sin señal no se ve como uso de pantalla hasta que la pantalla vuelve a pedir datos; sus cargas sí se ven en los resultados cuando sincronizan.
