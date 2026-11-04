# 0080. Sesión del entrenador en cancha: plantel guardado en el teléfono, borrador local antes de la cola, reloj de quién está en cancha y ediciones por campo

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #87 (B-509)

## Contexto

El entrenador carga minutos y contactos de cada jugador durante la sesión o después, muchas veces sin señal en la cancha (principio 5). La web ya tenía la planilla de participación (B-407, `GET /v1/training-sessions/{id}/roster` y `POST …/participations/batch`), y la base local con su cola (ADR 0069) ya sincroniza `training_session` y `participation` y sabe encolar `participation.record` y `participation.update`. Faltaba decidir:

- de dónde salen los jugadores de una sesión sin conexión, si `player` no es una colección sincronizada;
- cómo se cuentan los contactos y los minutos durante la sesión sin que cada toque sea una corrección (ADR 0030 pide motivo para cambiar un valor ya cargado);
- cómo se miden los minutos de un partido con cambios;
- qué se manda al guardar, para no pisar lo que otro cargó mientras tanto.

## Decisión

- **Quién.** La pestaña "Sesiones" la ven los roles con `participation.record` en la matriz (`coach` en sus categorías y la administración); la API y la RLS siguen decidiendo por jugador.
- **Sesiones de la base local.** La lista lee `training_session` sincronizada: las de hoy (día del club, en su zona horaria) por hora de inicio y las de los últimos `SYNC_RECORDED_AT_MAX_AGE_DAYS` días, sin archivadas. Crear o editar una sesión sigue en la web: no es una operación de la cola.
- **Plantel guardado en el teléfono.** El plantel de cada sesión (el DTO del endpoint, con la disponibilidad derivada y nunca la causa) se guarda en la caché de lecturas de la app (ADR 0074: `services.readCache`, tabla `cached_read`, por membresía, borrada al cerrar sesión) y se valida con el contrato al leerlo. Con señal, la lista baja sola el plantel de las sesiones que muestra (cada 15 minutos como mucho) y borra los de sesiones que salieron de ella, solo si la base local viene de una sincronización terminada (nunca antes del primer pull ni mientras un reset vuelve a bajar las sesiones, cuando la lista puede estar vacía o incompleta); la planilla lo refresca al abrirse. Sin plantel guardado y sin señal, la pantalla lo dice en vez de mostrar una lista vacía. La hora y la zona del club y los nombres de las categorías se guardan igual. Agregar `player` a la sincronización (ADR 0050) habría movido toda la ficha de cada jugador al teléfono del entrenador para usar dos campos.
- **Lo que el teléfono conoce de cada jugador.** La fila sincronizada con la cola superpuesta (`LocalStore`); si no hay fila (todavía no bajó), la del plantel; encima, las altas y ediciones de este teléfono que el servidor todavía no devolvió, en orden de cola (la base local no puede superponer sobre una fila que no tiene). Con eso se decide qué cambió, qué es una corrección y qué falta enviar.
- **Borrador local antes de la cola.** Lo que el entrenador cambia (estado, minutos, contactos) es un borrador guardado en el teléfono en cada cambio: matar la app no pierde nada. Solo "Guardar" lo pasa a la cola. Si cada toque de "+1" se encolara, desde el segundo sería una corrección de un valor ya cargado y pediría motivo, y un partido dejaría cientos de mutaciones. El borrador guarda solo las filas tocadas y, de cada una, **los campos que el entrenador cambió**: los demás campos de esa fila y las filas no tocadas siguen lo que el teléfono conoce, también si llega un pull mientras tanto. Así, si el entrenador suma un contacto y después un pull trae los minutos que cargó otro, se guardan los minutos nuevos y se envían solo los contactos (una copia vieja de un campo que nadie tocó acá nunca se envía ni pide motivo).
- **Reloj de quién está en cancha.** Arrancar, pausar (entretiempo) y terminar; cada jugador entra y sale. Se guarda en el borrador con la hora del reloj del teléfono (no un reloj monótono): sigue contando aunque se cierre la app, y un reloj que vuelve atrás nunca da un tramo negativo. Al terminar, los minutos de cada jugador que estuvo en cancha (redondeados al minuto) pasan a la planilla, con "Presente" si estuvo toda la sesión (un minuto de tolerancia) o "Limitado" si estuvo una parte, salvo que el entrenador ya hubiera elegido un estado con carga. Un jugador que el staff médico marcó no disponible y figura jugando (en cancha o con un estado con carga) muestra un aviso con ícono y texto: el entrenador decide, pero no pasa sin que se vea.
- **Guardar por campo.** Las participaciones nuevas van en lotes de `participation.record` (hasta 100 filas, un `clientUuid` por fila). Las que el teléfono ya conoce van como un `participation.update` por jugador con **solo los campos que cambiaron** y su fila por `id` o, si la creó este teléfono y no volvió, por `clientUuid`. El servidor resuelve cada campo por su reloj (ADR 0050): si otro entrenador cargó los contactos mientras este corregía los minutos, no se pisan. Un lote con `status` obligatorio estamparía el estado aunque no cambiara.
- **Motivo de las correcciones.** Si una edición cambia un valor ya cargado (el estado, o minutos o contactos que tenían valor), la pantalla pide el motivo y lo manda como `changeReason` solo en esas ediciones. Todas las escrituras de un guardado se validan con el contrato y se encolan en una sola transacción de la base local (`enqueueAll`): nunca entra media planilla, ni por un error de la pantalla ni por una falla de SQLite. El plan del guardado es una función pura; el `clientUuid` de cada alta se genera al encolar.
- **Misma lectura que la web.** Ausente y no disponible no llevan minutos ni contactos; un jugador que el staff médico marcó no disponible arranca como "No disponible" (sugerencia que se guarda con el resto); jugadores sin consentimiento de datos o que quien carga no puede registrar quedan en solo lectura con el motivo; el RPE lo carga el jugador y se muestra como lectura, con el sRPE cuando volvió del servidor.
- **Textos** en `packages/i18n/src/messages/mobile-coach-session.ts`, con el prefijo `coachSession.`.

- **Borradores de sesiones que salieron de la lista.** Si una sesión con cambios sin guardar sale de la semana, la lista la sigue mostrando en "Sin guardar de días anteriores" para guardarla o descartarla. Solo se borra el borrador de una sesión que ya no está en el teléfono (con la base local de una sincronización terminada), porque no se puede abrir ni guardar.

## Alternativas descartadas

- **Encolar cada cambio al instante.** Convierte cada "+1" en una corrección con motivo y llena la cola.
- **Un solo `participation.record` con todas las filas.** Obliga a mandar `status` en cada fila y lo estampa aunque no cambie; las ediciones por campo respetan lo que otro cargó.
- **Minutos por un temporizador del sistema o por notificaciones.** Necesitaría correr en segundo plano; con la hora de entrada y salida guardada alcanza para calcularlos al volver.
- **Sincronizar `player`.** Más datos personales de menores en más teléfonos de lo necesario, y una colección nueva en el servidor, para mostrar nombre y disponibilidad que el plantel ya trae.

## Consecuencias

- Un plantel guardado puede estar desactualizado sin señal (un jugador nuevo en la categoría): la pantalla muestra desde cuándo es y lo refresca al volver la señal.
- Si el servidor ya tenía un valor que el teléfono no conocía, una edición sin motivo puede volver rechazada; queda en los avisos de la sincronización (ADR 0069).
- La tabla `cached_read` es la misma caché de lecturas que usan las otras pantallas sin conexión de la app; esta pantalla usa sus propias claves (`coachSession.*`).
