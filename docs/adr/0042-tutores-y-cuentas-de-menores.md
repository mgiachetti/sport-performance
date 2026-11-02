# 0042. Tutores y cuentas de menores: vínculo, invitación del hijo/a y código o link de un solo uso

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #41 (B-310)

## Contexto

Los jugadores tienen de 12 a 19 años. Un menor no siempre tiene email, y la Ley 25.326 pide que su tutor consienta y responda por él. El modelo ya tenía el vínculo `guardian` (ADR 0007), la matriz de permisos ya definía `guardian_link` (ver y gestionar vínculos) y `player_account.invite` ("la cuenta de un jugador sin email: código o link que genera el tutor", ADR 0025), y las invitaciones por link existían para el staff (ADR 0028). Faltaba decidir:

- quién crea el vínculo y cómo llega un tutor a tenerlo;
- cómo un tutor le da acceso a su hijo/a, con email y sin email, sobre Better Auth (que exige email en la cuenta y solo abre sesiones por OTP, ADR 0010);
- qué garantías de seguridad tiene un código corto que abre una sesión;
- dónde quedan los ganchos de la mayoría de edad (B-311, #42).

## Decisión

### El vínculo

- **Lo crea la administración** (`guardian_link.manage`): `POST /v1/players/{id}/guardians` con una membresía `parent` activa del club y la relación (`mother`, `father`, `legal_guardian`, `other`, ahora vocabulario del dominio). Es idempotente por `clientUuid`, y un vínculo abierto repetido responde `409` (`guardian_active_key`).
- **O llega con la invitación del tutor:** `POST /v1/invitations` acepta `playerId` y `relationship` para el rol `parent`, y aceptarla crea el vínculo desde el día del club (`invitation.player_id`, `invitation.guardian_relationship`). Así la madre de un jugador entra al club y queda vinculada en un solo paso. `invitation_pending_key` incluye el jugador/a: la misma persona invitada para dos hijos tiene dos links abiertos.
- **Se edita la relación** con `version` (`PATCH /v1/guardians/{id}`). **Se termina, no se borra:** `POST /v1/guardians/{id}/end` fija `valid_to` en el día del club. Un vínculo que empieza ese día (por ejemplo, el tutor equivocado) queda como rango vacío `[d, d)` y nunca vale: `guardian_validity` acepta `valid_to = valid_from`, a diferencia de los demás rangos. Al terminar el vínculo se anulan los códigos y las invitaciones de jugador que ese tutor dejó abiertos para el hijo/a. No hay `restore`: un vínculo nuevo es otra fila, y así queda la historia.
- **Quién lo ve:** la administración, el propio jugador/a y sus tutores (matriz más RLS de 0004). El email del tutor solo lo ve la administración.
- **El tutor ve a sus hijos/as** con `GET /v1/me/children` (solo rol `parent`): vínculos vigentes, si el hijo/a es mayor, si ya tiene cuenta y si este tutor puede gestionarle el acceso (`can('invite', player_account)` con los hechos del jugador/a).

### El tutor le da acceso a su hijo/a

- **Con email:** `POST /v1/players/{id}/invitations` (`player_account.invite`: el tutor de un menor, o la administración) manda la invitación de ADR 0028 con rol `player` atada al jugador/a. Aceptarla con ese email (`app.accept_invitation`, reemplazada en la migración 0020) crea la membresía `player` y fija `player.user_id`. Hay dos casos que la función rechaza sin escribir nada (`player_taken`, `409`): un jugador/a que ya tiene otra cuenta, y un usuario que ya es otro jugador/a del club. Tampoco acepta una invitación `parent` sobre un jugador/a abierta por la cuenta de ese mismo jugador/a (`own_guardian`, `409`): nadie es su propio tutor. La RLS de `invitation` suma políticas para el `parent`: lee, crea (como sí mismo) y anula solo invitaciones `player` de sus hijos/as. Nunca ve las del staff ni las de otros tutores.
- **Sin email:** `POST /v1/players/{id}/access-codes` genera a la vez un **código** para tipear y un **link** (universal link `<WEB_APP_URL>/player-access/<token>` y deep link `sportperformance://player-access/<token>`) para compartir por WhatsApp o mostrar como QR en el teléfono del tutor. La app del hijo/a manda uno de los dos a `POST /v1/auth/player-access` (público), que abre una sesión **bearer** (mobile). La primera vez crea la cuenta del jugador/a. La web no la necesita: es del staff (ADR 0012), y el link abre la app.
- **El código solo abre la cuenta sin email del propio jugador/a** (la creada por un código anterior, o una nueva). Si el jugador/a tiene una cuenta con email, ingresa con ese email (OTP), y el código no sirve: emitirlo responde `409` y canjear uno emitido antes responde `409` (`has_account`, solo al log). Una sesión de Better Auth es del usuario, no del club: con `X-Membership-Id` elige cualquiera de sus membresías activas. Si un código del club A abriera una cuenta con email, quien lo emite (un admin del club A, o un tutor) actuaría como esa persona en el club B, o como superadmin si lo es. Sería una escalada entre clubes y tomar una cuenta sin su consentimiento. Por eso la base solo canjea si `player.user_id` es nulo o es justo el usuario `player.<id del jugador>@no-email.invalid` (y no es superadmin), en `app.is_player_no_email_account`. La API pregunta antes de emitir con `app.player_takes_access_codes(player_id)` (`SECURITY DEFINER`: el tutor no ve el email de la cuenta; responde solo por jugadores del club del contexto).
- **La cuenta sin email** es un usuario de Better Auth con la dirección reservada `player.<id del jugador>@no-email.invalid`. `.invalid` es un dominio reservado (RFC 2606), así que nunca llega correo. La API además nunca le manda un código OTP (responde `202` igual que para cualquier dirección) ni el aviso de dispositivo nuevo. Los clientes la reconocen con `isUndeliverableEmail` / `NO_EMAIL_ACCOUNT_DOMAIN` del dominio. Cuando el jugador/a tenga email propio, B-311 le cambia la dirección a esa misma cuenta, así conserva su historia.
- **El canje es atómico en la base:** `app.redeem_player_access(code_hash, token_hash)` (`SECURITY DEFINER`, ejecutable solo por `sport_performance_app`, sin club en el contexto) busca exactamente la fila del hash, la bloquea (`FOR UPDATE`) y, si sigue pendiente, en una misma transacción:
  - crea el usuario sin email o usa `player.user_id`;
  - vincula al jugador/a;
  - crea la membresía `player` (`invited_by` = quien emitió el código);
  - marca el código como usado.

  Después la API abre la sesión con el adaptador de Better Auth (`internalAdapter.createSession`, con el mismo hook de sesión que el OTP: tipo de cliente, dispositivo, sin IP). Si abrir la sesión falla después del commit, el código queda usado y hay que pedir otro. Es raro, y el costo es acotado. La API lo loguea como error con el id del código, el club y la membresía, para que soporte lo encuentre.

### Seguridad del código

- **Vencimiento corto:** 15 minutos (`PLAYER_ACCESS_CODE_EXPIRES_IN_S`), con el reloj de la base. Un `CHECK` impide más de una hora aunque la API se equivoque.
- **Un solo uso:** el código y su link son la misma fila. Usar uno quema los dos; un segundo canje responde `409`.
- **Uno abierto por jugador/a:** índice único parcial. Generar otro anula el anterior, y dos tutores generando a la vez se serializan con un advisory lock. Se puede anular a mano (`DELETE …/access-codes/{id}`, idempotente). Uno ya usado no se anula (`409`): para cortar el acceso se cierra la sesión (ADR 0033).
- **Entropía y límites:** 8 caracteres de un alfabeto de 31 sin ambiguos (`0 O 1 I L`), es decir 31⁸ ≈ 8,5·10¹¹ (≈ 39,6 bits), sorteados con `crypto.randomInt`. El canje por código está limitado a 10 intentos cada 15 minutos por IP y a 1000 cada 15 minutos en total (sujeto `all`), sobre el contador de Postgres de ADR 0028. Con 1000 códigos abiertos a la vez en toda la plataforma, la probabilidad de acertar alguno en una ventana completa de intentos globales es ≈ 1000 · 1000 / 8,5·10¹¹ ≈ 1,2·10⁻⁶. El límite global solo cuenta los intentos que el límite por IP dejó pasar: una sola IP no gasta el presupuesto de la plataforma ni bloquea los códigos de todos los clubes. El link (token de 256 bits) tiene su propio límite por IP y no comparte el global: una inundación de códigos inventados no deja sin servicio a quien usa el link. Emitir códigos e invitaciones de jugador está limitado a 20 cada 15 minutos por usuario.
- **Hasheado en reposo:** del código se guarda el HMAC-SHA-256 con `AUTH_SECRET`. Un hash simple de 40 bits se revierte en minutos desde un dump; el HMAC necesita además el secreto. Del token se guarda el SHA-256, como en las invitaciones. Ninguno de los dos viaja en la URL de la API ni se loguea. La respuesta que los trae es `Cache-Control: no-store` y no es idempotente a propósito: el código no se guarda, así que un reintento genera otro (y anula el anterior).
- **Revalidación al canjear:** el código no sirve si el jugador/a se dio de baja (`left_on`). Tampoco si quien lo emitió ya no es `admin` activo, superadmin, o `parent` con vínculo vigente con un jugador/a **menor** en el día del club. El código puede tener minutos y el vínculo pudo terminar, o el jugador/a cumplir 18, en el medio.
- **Respuestas:** código inexistente `404`; usado, anulado, vencido, ya no permitido o de un jugador/a con cuenta con email `409`, todos con el mismo mensaje. El motivo concreto va solo al log.
- **Auditoría:** las filas no se borran. `GET /v1/players/{id}/access-codes` le muestra al tutor y a la administración quién generó cada código, cuándo y si se usó. El canje loguea el código, el club y la membresía (solo ids, ADR 0016).

### Mayoría de edad (ganchos para B-311)

- La matriz decide en cada handler. `player_account.invite` exige `minor` para el tutor (emitir códigos, invitar al hijo/a, listar y anular códigos), y la base lo vuelve a mirar al canjear (18 años, `AGE_OF_MAJORITY_YEARS`).
- `loadPermissionSubject` arma las tutelas con `confirmedByAdultPlayer: false`: el tutor de un mayor queda afuera de lo que la matriz condiciona por edad. B-311 agrega la confirmación del adulto (dato en `guardian`), y con ella el tutor recupera lo que el adulto acepte.
- Listar los códigos también pide `player_account.invite`, así que cuando el hijo/a cumple 18 el tutor deja de ver incluso los códigos que él mismo generó. La administración los sigue viendo, y las filas no se borran. B-311 decide si el tutor conserva esa auditoría (con la confirmación del adulto o como permiso aparte).
- `GET /v1/me/children` sigue mostrando al hijo/a mayor (`ofAge: true`, `canManageAccess: false`) para que el tutor entienda por qué no puede gestionarlo. No muestra más datos que su nombre y su fecha de nacimiento.

## Alternativas descartadas

- **`email` nulo en `user` para los menores.** Better Auth exige email único en su modelo y en su adaptador. Romperlo obligaba a adaptar cada flujo (OTP, aviso de dispositivo, invitaciones) y a mantener un fork del esquema. Una dirección reservada `.invalid` cumple el modelo y no entrega nada.
- **Solo link, sin código.** Un chico con el teléfono en la mano y el tutor al lado tipea más rápido que lo que tarda en llegarle un WhatsApp, y el link necesita otra app en el medio. Se dan los dos, y los dos son la misma fila.
- **Código más largo, o numérico de 6 dígitos como el OTP.** El OTP vale contra un email conocido y tiene 3 intentos por código. El código del tutor no nombra a nadie, así que cada intento prueba contra todos los códigos abiertos a la vez. Con 6 dígitos no alcanzan los límites. Con 10 o más caracteres un chico se equivoca seguido. 8 caracteres sin ambiguos, con límite por IP y global, más el vencimiento corto, cierran la cuenta.
- **Plugins de Better Auth (`magicLink`, `anonymous`, `oneTimeToken`).** El magic link manda un email, que es justo lo que falta. `anonymous` crea usuarios sin dueño y los vincula después. `oneTimeToken` canjea una sesión existente, no crea una de otro usuario. Además, ninguno guarda hashes con HMAC, revalida al tutor ni bloquea la fila del jugador/a. Se usa el adaptador de Better Auth solo para abrir la sesión, con los mismos hooks.
- **Vincular tutores desde el propio tutor** (que un `parent` sume a otro `parent`). Es dar acceso a datos de un menor; lo decide la administración, o una invitación que la administración emitió.
- **Restaurar un vínculo terminado.** Reabrir el rango borraría el período sin tutela; un vínculo nuevo deja la historia completa.

## Consecuencias

- Migración `0018_guardians_and_player_access`:
  - la tabla `player_access_code` con su RLS (la administración y los tutores del jugador/a; `UPDATE` solo de la anulación);
  - las columnas `invitation.player_id` y `guardian_relationship`, con sus `CHECK` y la clave foránea compuesta;
  - las políticas del tutor sobre `invitation`;
  - `app.accept_invitation` reemplazada, y `app.redeem_player_access`, `app.player_takes_access_codes` y `app.is_player_no_email_account` (interna) nuevas;
  - el `CHECK` de `guardian_validity` relajado.
- La app Expo registra el path `player-access/<token>` en el esquema y en los dominios asociados. La web sirve `/player-access/<token>` con el pedido de instalar la app.
- Rotar `AUTH_SECRET` invalida los códigos abiertos (su HMAC cambia). Duran 15 minutos, así que no se migran.
- Un mismo chico en dos clubes son dos jugadores con dos cuentas sin email. Unirlas es parte de B-311, cuando tenga su propio email.
- Sin worker todavía (ADR 0011), los emails de invitación salen dentro de la transacción, igual que en ADR 0028.
