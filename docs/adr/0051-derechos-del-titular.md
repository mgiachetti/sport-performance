# 0051. Derechos del titular: exportación desde el catálogo, supresión por la administración y borrado o anonimización de la cuenta

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #60 (B-329)

## Contexto

La Ley 25.326 le da al titular de los datos tres derechos que esta plataforma tiene que poder cumplir:

- acceso (art. 14): recibir todos sus datos;
- rectificación y supresión (art. 16): el responsable tiene 5 días hábiles para suprimirlos;
- revocar el consentimiento, que ya resuelve el ADR 0043.

Además, Apple exige que una app que permite crear cuentas permita borrarlas desde la app (guía 5.1.1(v)).

Ya estaba decidido:

- la matriz de permisos tenía `data_export.export` (jugador mayor, tutor de un menor, administración con consentimiento de datos; nunca el superadmin);
- el ADR 0023 fijó que borrar una cuenta borra en cascada sus membresías, vínculos de tutor y sesiones y deja `NULL` como autor en las tablas del club;
- el ADR 0029 dejó la exportación y la supresión de los datos de salud "sobre el esquema `medical` y su log, separados";
- el ADR 0030 dejó la supresión de un jugador como "un flujo propio que también purgue su historial como dueño".

Faltaba decidir:

- quién suprime y cómo;
- qué tablas cubre la exportación y la supresión, y cómo no se olvida una tabla nueva;
- cómo se salta la inmutabilidad del historial solo en ese caso;
- qué pasa con la cuenta de quien firmó consentimientos (la clave `RESTRICT` de `consent.signed_by` la protege como evidencia);
- qué evidencia queda de que la supresión se pidió y se hizo.

## Decisión

### Quién pide y quién suprime

- **El club es el responsable de la base** (como en los consentimientos, ADR 0043). El titular pide (el jugador mayor, el tutor de un menor), y la administración del club ejecuta o rechaza. Nueva entrada de la matriz `data_erasure`:
  - `read` y `request`: el jugador mayor (lo suyo), el tutor de un menor y la administración (para pedidos que llegan por otro medio);
  - `execute`: solo la administración.
  - El superadmin nunca exporta ni suprime: el soporte no borra jugadores de un club.
- **Pedidos en `data_subject_request`** (migración `0026_data_subject_rights`): tipo `access` o `erasure`, estado `pending` / `completed` / `rejected` / `cancelled`, quién pidió y con qué rol, nota, resolución (quién, cuándo, motivo) y, para una supresión, las filas borradas por tabla.
  - Hay un pendiente por jugador (índice único parcial).
  - Una exportación se registra completada al entregarse.
  - Un rechazo exige motivo, por ejemplo una obligación legal de conservar (art. 16.5).
  - **`player_id` no tiene clave foránea, a propósito:** el pedido es la evidencia de la supresión y sobrevive al jugador, con su id y nada más.
  - Un trigger guard solo deja resolverlo una vez y nunca borrarlo. Solo se aceptan, después, los autores a `NULL` por el `ON DELETE SET NULL`.
  - RLS: la administración lee todo el club; el jugador y el tutor, los que pidieron ellos, también después de la supresión. Insertan como sí mismos; quien pidió cancela y la administración rechaza. Nadie inserta ni completa una supresión desde la aplicación.
- **Vencimiento legal** (`dueOn`): 5 días hábiles desde el día del club del pedido (`erasureDueOn` del dominio, lunes a viernes, sin feriados: es una cota que la administración puede ver uno o dos días antes).

### Qué cubre: el catálogo, no una lista

- `app_admin.player_references()` lista, desde `pg_constraint`, toda tabla de `public` y `medical` con una clave foránea `(club_id, x) → player (club_id, id)`. **Exportar y suprimir recorren esa lista:** una tabla nueva con su clave al jugador (las tablas `*_daily` del worker) entra sola, sin editar las funciones. Un test de integración verifica que, después de una supresión, ninguna tabla de esa lista tiene filas del jugador.
- **Exportación** (`app.export_player_data`, `SECURITY DEFINER`), con cada fila de cada tabla de `public` de esa lista, por `esquema.tabla`. Las columnas van como están guardadas (`to_jsonb`: `snake_case`, fechas ISO, días del club `aaaa-mm-dd`). Incluye además:
  - los valores de sus resultados;
  - las sesiones y días de test en los que participó;
  - los textos de los consentimientos firmados.

  Es una función del dueño porque el derecho de acceso cubre filas que la RLS le oculta al titular (sus alertas), y por eso valida ella misma a quien llama: jugador o tutor con el jugador visible, o la administración, y repite la regla de edad de la matriz como segunda barrera (el jugador, solo una vez mayor; el tutor, solo mientras el jugador es menor, aunque el adulto haya conservado el vínculo, ADR 0048). La API pregunta antes a la matriz (edad, tutela, consentimiento). Incluye también los pedidos sobre el jugador (`data_subject_request`, el de esa exportación incluido).

  Quedan fuera, con motivo:
  - `invitation` y `player_access_code`: son gestión de acceso, con hashes de tokens y emails de otras personas, no datos sobre el jugador;
  - el esquema `medical`;
  - los objetos del bucket: la exportación lleva las filas de `file` (tipo, estado, fechas), no el video ni los links.
  - el log de la sincronización sin conexión (`sync_change`, `sync_mutation`, ADR 0050): son ids, relojes y resultados de mutaciones para los dispositivos, no datos sobre el jugador; las filas que sincronizan (bienestar, participaciones, resultados) ya están en la exportación.
- **Datos de salud en la exportación:** solo por las funciones auditadas de lectura (`medical.read_injuries`, `read_concussions`, `read_concussion_stages`, `read_notes`, ADR 0029), en la misma transacción, y solo si la matriz deja `medical_record.read` (el jugador con consentimiento de salud, el tutor de un menor con ese consentimiento; solo las notas `shared`). Los bloqueos (`medical.hold`) no salen: son decisiones del staff médico, con notas para el staff, y el ADR 0029 deja `read_holds` solo a `medical`; lo que el titular puede saber de ellos es su disponibilidad (`medical.availability`), que ya ve en la app. Un test exige que toda tabla de `medical` con jugador esté en la exportación o en esa excepción. Para la administración la sección dice `included: false` con `not_holder`; sin consentimiento de salud, `no_health_consent`.
- **Proyecciones:** `test_result.not_done_reason = 'injured'`, también dentro del historial, sale como `unavailable` para quien no es `medical` (ADR 0029). La cuenta propia del jugador (nombre y email) la reciben el jugador y la administración, nunca el tutor (ADR 0042).
- **Formato versionado:** `format = sport-performance.player-data`, `formatVersion = 1`, `generatedAt`, club, jugador y el id del pedido `access` que lo registra.
  - Se entrega en la respuesta con `Content-Disposition: attachment` y `Cache-Control: no-store`.
  - `POST /v1/players/{id}/data-exports` (no `GET`, porque registra un pedido), idempotente por `clientUuid`: un reintento devuelve los datos de nuevo con el mismo pedido.

### Supresión

- `app.erase_player(request_id)` (`SECURITY DEFINER`, solo `admin` validado del club del contexto, pedido `erasure` pendiente del club), en la transacción del request:
  1. bloquea al jugador (`FOR UPDATE`: lo que se intente escribir sobre él espera y después falla);
  2. marca sus archivos como borrados y los desprende del jugador (abajo);
  3. borra cada tabla de la lista, en `public` y `medical`, y las filas que solo existen a través de una de ellas (todas las columnas de su clave `NOT NULL`, a cualquier profundidad: los valores de un resultado, las etapas de una conmoción, las categorías de una invitación), primero las hijas según las claves entre ellas (orden topológico calculado del catálogo; un ciclo es un error). Una hija se borra antes que su padre, así el historial que escribe todavía nombra al jugador y se purga con el resto;
  4. purga su historial de cambios;
  5. borra al jugador;
  6. completa el pedido con las filas borradas por tabla.
- **Solo filas de ese club y ese jugador.** Cada borrado filtra por `club_id` del contexto y por el jugador (o por las claves de filas ya filtradas así). Una fila que solo apunta a una del jugador con una clave que admite `NULL` (por ejemplo el escudo del club a un archivo) no es parte del jugador: frena la supresión, que se deshace entera, en vez de borrar algo de otro. La función solo corre con un pedido `erasure` pendiente del club (que la API crea y lista) y la llama solo `POST …/execute`. Si una fila así frena la supresión, la función responde `erasure_blocked` (con el nombre de la clave, sin valores) y la API `409`: no se borra nada. Para que eso no pase con datos de otro jugador, una serie de gimnasio cargada contra el programa de un jugador tiene que ser de ese jugador (trigger `gym_set_program_guard`); un programa de categoría acepta series de cualquiera.
- **Archivos (ADR 0044).** Las filas de `file` quedan como registro de un objeto del bucket, y la base no puede borrar el objeto. La supresión las pasa a `deleted`, sin jugador ni nombre de archivo (`file_subject` admite un archivo borrado sin jugador), con `expires_at` calculado como `deletedFileExpiresAt`: cuando ya no hay link de subida que el bucket acepte. El job de retención borra el objeto después, como con cualquier archivo borrado. En las filas borradas el pedido cuenta `public.file` como los archivos desprendidos.
- **La inmutabilidad del historial tiene una sola excepción.** `change_history_guard` deja borrar una fila solo si en `app_admin.erasure_in_progress` hay una marca de **esta** transacción (`pg_current_xact_id()`), de ese club y de ese jugador. Una fila del historial es del jugador por su `player_id`, nada más: una fila que se pasó de un jugador a otro guarda al primero en `old_values`, pero su historial es del segundo, y suprimir al primero no lo toca. `erase_player` la escribe y la quita. La aplicación no llega a `app_admin` (sin grants), así que no la puede falsificar con un setting. Una marca de otra transacción no abre nada. Para el dueño, fuera de una supresión, el historial sigue siendo inmutable.
- Borrar filas seguidas escribe su historial (trigger del ADR 0030), y `erase_player` lo purga enseguida. Fija un motivo para que el login de la API no lo pida.
- **La cuenta del jugador:**
  - si es la cuenta sin email (`player.<id>@no-email.invalid`, ADR 0042), que solo existe para ese jugador, se borra con él;
  - una cuenta con email propio es global (puede estar en otros clubes): queda, y su membresía `player` en el club se cierra.
- **Log de sincronización (ADR 0050).** `sync_change` no tiene clave al jugador. Borrar sus filas convierte cada entrada suya en una marca de borrado (el trigger del log). La supresión las deja como marcas, sin los relojes de los campos: así un dispositivo que sincronizó una fila del jugador recibe la baja. Hace falta porque los dispositivos de la administración ven todo el club y no reciben un reset cuando un jugador se va. `sync_mutation` no tiene jugador: guarda la operación, el reloj y el resultado de cada push de un usuario.
- **Evidencia que queda, sin datos del jugador más que su id:** `medical.access_log` (ADR 0029: la evidencia sobrevive al jugador), `support.access_log` y los pedidos.
- **Confirmación explícita:** `POST /v1/data-subject-requests/{id}/execute` exige el `playerId` en el body. Si no coincide con el del pedido, responde `409`. No se deshace, así que pide además una sesión reciente, como borrar la cuenta (`reauthentication_required`). La matriz se consulta antes de buscar el pedido: el staff recibe `403`, exista o no. Un reintento de una supresión completada devuelve el pedido completado.
- **Borrados de datos de salud auditados.** El ADR 0029 no dejaba `DELETE` en el esquema `medical` para nadie. Esto lo modifica en un punto: la supresión, que corre como dueño, borra las filas clínicas del jugador. Los roles de conexión siguen sin `DELETE`. Cada fila borrada deja su línea `delete` en `medical.access_log` (quién, con qué rol, qué registro; sin valores), igual que los `insert` y `update`, también en una tabla clínica nueva (`app_admin.secure_medical_table`).

### Borrado de la cuenta

- `POST /v1/me/account-deletion` (sesión; con o sin club elegido: la cuenta es global) llama a `app.delete_own_account(request_erasure)`. Esa función borra la cuenta de `app.user_id` con `app_admin.delete_user_account`:
  - **Si nada la retiene, se borra la fila de `user`**, y la cascada se lleva sesiones, cuentas de Better Auth, dispositivos conocidos, membresías (con sus asignaciones) y vínculos de tutor. En las tablas del club su id queda en `NULL` (ADR 0023).
  - **Si una clave `RESTRICT` la retiene como evidencia legal** (firmó o revocó un consentimiento, dio un alta médica, levantó un bloqueo), se anonimiza: se hace lo que haría la cascada (cada clave `ON DELETE CASCADE` a `user`, leída del catálogo) y la fila queda solo con su id, nombre vacío, email `deleted.<id>@deleted.invalid` (dominio `.invalid` reservado, RFC 2606: nunca recibe correo ni códigos) y sin imagen. La función prueba el borrado en una subtransacción y, ante `23503`, anonimiza. Así una clave `RESTRICT` nueva queda cubierta sola.
  - En los dos casos su email sale de las invitaciones (las pendientes se anulan) y de las verificaciones pendientes.
  - La respuesta dice `deleted` o `anonymized`.
- **Sesión reciente:** la sesión tiene que haberse abierto hace menos de 10 minutos (`ACCOUNT_DELETION_FRESH_SESSION_S`). Si no, responde `403 reauthentication_required`, un código nuevo del catálogo, y el cliente vuelve a pedir el código. Un teléfono desbloqueado olvidado no alcanza para borrar una cuenta. Para la cuenta sin email de un menor, eso implica un código nuevo del tutor.
- **`requestErasure`:** además de borrar la cuenta, crea un pedido de supresión pendiente de cada jugador del que es titular, en cada club: su propio jugador si es mayor y sus hijos/as menores con vínculo vigente. Los pedidos conservan el rol, y su autor queda en `NULL` con la cuenta. Borrar la cuenta no suprime por sí solo los datos del jugador: son del club, que los suprime (o rechaza con motivo) en el plazo legal. Apple acepta conservar lo que la ley obliga, explicándolo.
- Un superadmin no se borra desde la app (`409`; un operador lo hace como dueño). La API responde `Clear-Site-Data: "cookies"`.

## Alternativas descartadas

- **Lista explícita de tablas en las funciones** (o un registro en TypeScript). Cada tabla nueva con datos del jugador obliga a acordarse de sumarla, y un olvido deja datos sin exportar o sin borrar, que es justo lo que la ley castiga. El catálogo de claves foráneas ya dice qué tablas tienen datos del jugador, y el test de supresión completa lo verifica.
- **Supresión inmediata por el titular.** El club es el responsable y puede tener una obligación legal de conservar (art. 16.5) o un reclamo en curso. La ley le da plazo para resolver, y un pedido con rechazo motivado deja la evidencia.
- **Anonimizar al jugador en vez de borrarlo** (conservar sus cargas sin nombre para los promedios del grupo). Con fecha de nacimiento, categoría, posición y la historia de un chico en un club de un barrio, la reidentificación es trivial. Borrar es la única supresión que se puede sostener.
- **Desactivar el guard del historial con `ALTER TABLE … DISABLE TRIGGER`.** Toma un lock exclusivo de toda la tabla y, si algo falla en el medio, deja la tabla sin protección para todos. La marca por transacción y jugador no abre nada más.
- **Un setting de la transacción (`app.erasing`) para abrir el guard.** Cualquier login puede fijar un setting propio con `set_config`. La tabla del esquema `app_admin`, sin grants, no se puede escribir desde la aplicación.
- **Borrar siempre la fila del usuario, poniendo `ON DELETE SET NULL` en `consent.signed_by`.** El consentimiento de un menor dejaría de decir quién lo firmó, y es la evidencia que el club necesita mientras usa esos datos. Anonimizar conserva el id (que con el vínculo y el pedido sigue probando quién firmó) sin dejar datos personales.
- **Exportación asíncrona a un archivo en storage.** Es la forma final para historias muy grandes (años de datos de pod), pero depende del worker (#57). La respuesta directa cubre hoy el volumen de un jugador, y el formato versionado no cambia si después se entrega como archivo.
- **`DELETE /v1/me`.** El ADR 0032 reserva `DELETE` para lo que la base deja borrar desde la aplicación. Esta es una operación con efectos en varias tablas y clubes, y un body (`requestErasure`).

## Consecuencias

- Una tabla nueva con datos de un jugador **tiene que** referenciarlo con la clave compuesta `(club_id, player_id) → player` (ADR 0023). Así queda exportada y suprimida sin cambios. Si guarda secretos o datos de otras personas, se agrega a las exclusiones de `app.export_player_data` con su motivo. Una referencia sin clave foránea (como `data_subject_request` o `medical.access_log`) es una decisión explícita de conservar evidencia.
- Una tabla nueva que, como `file`, registra algo fuera de la base, necesita su propio paso en `erase_player`; borrar la fila dejaría el objeto sin nadie que lo borre.
- La exportación da los metadatos de los archivos, no los videos. Darlos con links firmados (o en el archivo de la exportación asíncrona, #57) queda para cuando la exportación pase al worker.
- Cuando estén las notificaciones (#59), un pedido nuevo avisa a la administración y una resolución avisa al titular. Hasta entonces la administración ve los pendientes y su `dueOn` en la lista.
- La web del staff muestra los pedidos pendientes con su vencimiento y la ejecución con confirmación. La app ofrece "Descargar mis datos", "Pedir la supresión" y "Borrar mi cuenta" (con el código nuevo si hace falta).
- `AuthContext.session` ahora trae `createdAt` (cuándo se abrió la sesión).
- El catálogo de errores suma `reauthentication_required`; los clientes lo traducen y piden el código otra vez.
