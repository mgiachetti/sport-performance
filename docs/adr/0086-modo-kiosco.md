# 0086. Modo kiosco: carga del staff por el jugador con permiso propio, canal guardado en la fila, PIN local y nada de datos en pantalla

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #82 (B-504)

## Contexto

Muchos jugadores de M13 y M14 no tienen celular propio (B-007), y el bienestar y el RPE son diarios (principio 5). B-504 pide una tablet o un celular del club donde esos jugadores carguen lo suyo, o el staff por ellos, sin ver datos de nadie. ADR 0038 dejó el hueco: la matriz no deja que el staff cargue bienestar ajeno, "el modo kiosco lo resolverá con su propio permiso". Faltaba decidir con qué identidad se carga desde un dispositivo compartido, qué se guarda de cada carga, cómo trabaja sin señal (ADR 0015, 0050, 0069), qué ve quien toca un nombre y cómo se impide que un jugador salga del kiosco a la app del staff.

## Decisión

- **El kiosco es la sesión de un miembro del staff, no una identidad nueva.** Un `coach`, `sc` o `admin` ingresa en el dispositivo del club con su cuenta (OTP, ADR 0010) y abre el kiosco desde Inicio. No hay un rol `kiosk` ni una credencial de dispositivo: cada carga queda con un autor real (`created_by`, `updated_by` y el historial de cambios, ADR 0030), el alcance es el de sus asignaciones y la RLS sigue siendo la de siempre (`wellness` y `participation` ya aceptan escrituras del staff dentro de su alcance).
- **Permiso propio en la matriz:** `wellness.kiosk_submit` y `rpe.kiosk_submit`: `coach` y `sc` en sus asignaciones, `admin` en el club, siempre con el consentimiento `data` vigente del jugador. Se niega a `player` y `parent` (cargan lo suyo con `submit`), a `medical` (no es su herramienta) y al `superadmin` (el soporte no carga datos de jugadores). `submit` no cambia: el jugador sigue cargando solo lo propio.
- **Mismos endpoints, con `playerId`.** `POST /v1/wellness` y `POST /v1/training-sessions/{id}/rpe` aceptan un `playerId` opcional. Con él, el handler autoriza `kiosk_submit` sobre ese jugador y aplica las mismas reglas que a la carga propia: ventana de hoy o ayer, ítems de la etapa del día, ventana del RPE, "sin participación no hay carga", categoría del jugador e idempotencia por `clientUuid`. Así la cola offline (`wellness.submit` y `rpe.submit`) los manda por `POST /v1/sync/push` sin operaciones nuevas, y el resolvedor del push bloquea y resuelve el RPE del jugador nombrado. Un rol que nunca carga en el kiosco recibe `403` antes de saber si el jugador existe; un jugador fuera del alcance es `404` (RLS), como en el resto de la API.
- **El kiosco no corrige.** Un RPE ya cargado es `409` en vez de pedir motivo, y el bienestar del día ya cargado también (`409` por la clave única). Las correcciones son del jugador desde su cuenta, con motivo (ADR 0038), o quedan como nota para el staff.
- **El canal queda en la fila** (principio 4): `wellness.via_kiosk` y `participation.rpe_via_kiosk` (migración `0044_kiosk_channel`, `false` por defecto; un `CHECK` impide la marca sin RPE). Los DTO lo exponen como `channel` / `rpeChannel` (`player_account` o `kiosk`, `REPORT_CHANNELS` del dominio). El canal del RPE sigue al RPE: lo pisa una carga posterior desde la cuenta del jugador y se borra con una ausencia; el del bienestar no cambia nunca (la corrección del jugador conserva cómo se cargó).
- **Plantel del kiosco:** `GET /v1/categories/{categoryId}/kiosk-roster`, paginado por apellido, solo para quien tiene `kiosk_submit` en esa categoría. Por jugador: nombre y apellido, si se le puede cargar (`canReport`, sin decir por qué), los ítems de bienestar de su etapa de hoy y si ya cargó, y las sesiones de ayer y de hoy con la ventana de RPE sin cerrar con su estado (`pending`, `reported`, `not_taking_part`). Nunca puntajes, valores, disponibilidad ni causas. La página trae además `today` y la zona horaria del club, para calcular "hoy" sin señal.
- **En el dispositivo** (`src/kiosk`):
  - El estado del kiosco (membresía, categorías, PIN) vive en el almacenamiento seguro, atado al usuario, a la membresía y a la huella SHA-256 del token de la sesión. Matar la app o reiniciar el equipo vuelve a abrir el kiosco; otro ingreso (la sesión cerrada desde la web, ADR 0033, u otra persona) lo descarta.
  - El PIN de 4 a 6 dígitos (no triviales: ni repetidos ni seguidos) se guarda solo como SHA-256 con sal. Lo que frena adivinarlo es el límite: después de 5 intentos fallidos la salida se bloquea 30 s, el doble en cada fallo siguiente, hasta 15 min, y el contador sobrevive a matar la app.
  - Con el kiosco activo, la raíz de la app solo muestra el kiosco: sin pestañas, sin Cuenta, sin volver atrás (botón de Android y gesto de iOS). El sistema operativo se fija aparte con Acceso guiado (iOS) o fijar pantalla (Android): la app no lo puede hacer por su cuenta.
  - El plantel se guarda en la caché de lecturas de la base local cifrada (ADR 0074) por membresía y se refresca con señal. Las cargas van por la cola (ADR 0069) con `playerId`, `clientUuid` y el `localDate` explícito. Lo que el kiosco encoló o lo que trajo el pull cuenta como cargado al instante, para que nadie cargue dos veces; el "ya cargó" del plantel guardado solo vale el día en que se trajo.
  - **Nada queda entre jugadores.** El turno de un jugador (confirmar el nombre, bienestar, RPE de cada sesión abierta, "Listo") vive en el estado de un componente que se monta de nuevo en cada turno y se descarta al terminar, al tocar "No soy yo" o tras 60 s sin tocar la pantalla. El kiosco nunca muestra un valor cargado, ni propio ni ajeno: si ya cargó, solo dice "Ya cargaste…". La lista muestra nombres (apellido abreviado salvo para desambiguar), nunca quién cargó.

## Alternativas descartadas

- **Un rol o una credencial de dispositivo `kiosk`.** Un dispositivo sin persona detrás no es un autor auditable, necesita su propio alta, rotación y revocación, y obligaría a tocar la RLS, la matriz de roles y las membresías. La sesión del staff ya trae todo eso.
- **Que el jugador ingrese con su código en la tablet.** Es lo que hace el código de la familia (B-310) en un celular propio; en un dispositivo compartido deja una sesión de un menor abierta que el siguiente puede usar, y cada jugador tarda más de 20 segundos.
- **PIN por jugador.** Sumaría un dato más que recordar para chicos de 12 años y no protege nada que la pantalla muestre: el kiosco no muestra datos. Quedó la supervisión del staff y el registro de autor y canal.
- **Endpoints `POST /v1/kiosk/...` y operaciones de sincronización nuevas.** Duplicarían las reglas del bienestar y del RPE; con `playerId` el handler es uno solo.
- **Dejar corregir desde el kiosco.** Mostraría lo cargado (un dato del jugador) a quien toque el nombre y mezclaría la corrección del jugador con la del staff.
- **Guardar el PIN con un KDF lento.** Con 10⁴ a 10⁶ combinaciones un KDF no salva un archivo robado; el PIN vive en el Keychain / Keystore y el límite de intentos es la defensa.

## Consecuencias

- La web del staff puede mostrar el canal (`channel`, `rpeChannel`) en el detalle del bienestar y de la participación; hoy no lo muestra.
- Un staff que abre el kiosco tiene su sesión en el dispositivo del club: el dispositivo debe quedar bajo supervisión y con el sistema fijado (Acceso guiado / fijar pantalla). Cerrar la sesión desde la web saca al dispositivo del kiosco y de la cuenta. La base local del dispositivo tiene lo que la sincronización trae para ese staff (cifrado, ADR 0069), que el kiosco no muestra; se borra al cerrar la sesión.
- El kiosco pide señal la primera vez para traer el plantel; después trabaja sin conexión, y la cola sale cuando vuelve.
- Si el club configura los ítems de bienestar (B-322), el kiosco los toma del plantel como hoy toma la cantidad.
