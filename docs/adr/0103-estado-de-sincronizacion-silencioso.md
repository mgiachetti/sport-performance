# 0103. Estado de sincronización silencioso: nada cuando todo está bien, una línea discreta cuando no y "Sin enviar" en lo que falta mandar

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #80 (B-502)

## Contexto

El ADR 0069 definió el indicador de sincronización (`SyncIndicator`) como una pila de mensajes de estado con borde y fondo de color ("Todo sincronizado hace 5 minutos.", "3 cambios sin enviar", "Sin conexión…") más un botón "Sincronizar ahora", arriba de cada pantalla principal. Además, cada fila de varias listas llevaba su propia etiqueta de estado: "Sincronizada.", "Enviada", "Enviado, esperando la confirmación", "Guardado en el servidor", "Guardado", "Sin enviar", "Pendiente de sincronizar", "Guardado en el teléfono, sin enviar". Y algunas pantallas sumaban su propio cartel de "Sin conexión" al lado del indicador.

Probándolo en un teléfono, el pedido fue sacarlo: "todos los carteles de sincronizado y no sincronizado quedan feos, no me parece un patrón muy común". Las apps que funcionan sin conexión no muestran nada cuando todo anda, y avisan con una sola señal discreta cuando algo queda en el teléfono. Un cartel permanente de "todo bien" no informa nada y acostumbra a no leer los carteles, incluidos los que sí piden algo.

## Decisión

Esto modifica la parte del indicador y de los avisos del [ADR 0069](0069-base-local-y-motor-de-sincronizacion-mobile.md); el motor, la cola y la lista de avisos de Cuenta no cambian.

- **Silencio cuando todo está bien.** El indicador no muestra nada si el motor está quieto sin nada pendiente, o sincronizando sin nada pendiente. Esto incluye el primer ciclo después de ingresar: no se avisa "Este teléfono todavía no se sincronizó" mientras se está sincronizando. Ese aviso sale solo si no hay señal (`sync.quiet.offlineNever`).
- **Una sola línea discreta cuando algo falta** (`quietSyncLine` en `src/offline/presenter.ts`). Se arma con un ícono chico y un texto corto, sin tarjeta, borde ni fondo de color: "Sin señal · 3 cambios sin enviar", "3 cambios sin enviar", "Enviando 3 cambios…", "No pudimos sincronizar · 3 sin enviar". Es un botón ("Sincronizar ahora" como `accessibilityHint`) que pide un ciclo forzado y reemplaza al botón aparte. Mientras envía no se puede tocar. Los íconos son el reloj dibujado con vistas (`ClockIcon`) para lo pendiente, el indicador de actividad para lo que se está enviando y el ícono de atención para sin señal y para el servidor que falla. El texto siempre está, nunca solo el color (CLAUDE.md). Un lector de pantalla oye "Atención:" antes de sin señal o de una falla.
- **Sin señal según la sesión también.** Las rutas que tienen la sesión le pasan al indicador `offline` (la sesión no pudo llegar al servidor), y el indicador lo dice como sin señal aunque la cola todavía no haya intentado. Las pantallas que mostraban su propio cartel "Sin conexión" al lado del indicador (inicio del staff, gimnasio y lista de días de test) dejan de mostrarlo. Lo dice esa línea.
- **Lo que pide una acción sigue a la vista** (`syncAlerts`), con el mensaje de estado de siempre: la pausa hasta actualizar la app o volver a ingresar, y cuántos cambios no se aplicaron (revisarlos en Cuenta).
- **Cuenta guarda el detalle** (`detailed`). Ahí se ven las alertas, la línea discreta si la hay, una línea apagada con la última sincronización ("Sincronizado hace 5 minutos", o "Sincronizando…") y el botón "Sincronizar ahora", más la lista de avisos del ADR 0069.
- **Por ítem, el silencio quiere decir que está guardado.** Una fila sincronizada, enviada o guardada en el servidor no lleva etiqueta. "Enviado, esperando la confirmación" también se va: si está enviado, el servidor lo tiene. Lo que todavía está en el teléfono lleva `PendingMark` (`src/ui/primitives.tsx`): reloj chico y "Sin enviar", apagado y en línea. Es la misma marca en antropometría, carga externa, día de test (resultado e intento), CMJ semanal, gimnasio, sesión del entrenador, reacción y el bienestar y el RPE del jugador. Donde distinguirlo cuesta poco, el `accessibilityLabel` dice más y empieza igual que lo visible: "Sin enviar: corrección guardada en el teléfono".
- **Las confirmaciones de guardado no cambian.** Avisos de un momento como "Guardado en el teléfono. Se envía cuando haya conexión." siguen como estaban: responden a lo que el usuario acaba de hacer, no son el estado permanente de una fila.

## Consecuencias

- Una pantalla nueva no agrega su propio cartel de sincronización ni de "Sin conexión" si muestra el indicador, y una fila nueva marca solo lo pendiente con `PendingMark`, nunca lo sincronizado.
- Se borraron los textos que quedaron sin uso (`sync.idleSummary`, `sync.failed`, los estados "sincronizado/enviado/guardado" por ítem y sus "Sin enviar" propios) y se sumaron `sync.quiet.*` y `sync.item.pending`.
- Si no hay nada pendiente, el usuario no ve cuándo fue la última sincronización salvo en Cuenta. Es a propósito. Lo que todavía no llegó al servidor se ve en la fila misma y en la línea discreta.
- Las pantallas sin indicador que avisan "Sin conexión" porque sin señal no pueden leer algo (CMJ semanal, CMJ y sprint por video, 30-15, protocolos, selector de club) siguen igual. Ese aviso explica por qué falta un dato, no el estado de la cola.
