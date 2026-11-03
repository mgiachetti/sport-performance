# 0075. Gimnasio: programas por etapa, series con su tipo de carga y e1RM del protocolo de fuerza

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #96 (B-607)

## Contexto

B-607 pide programas de gimnasio por etapa, el registro de las series (peso × repeticiones × RIR), la nota técnica y el e1RM. CLAUDE.md fija las reglas de cada etapa: M13/M14 trabajan técnica con peso corporal o palo y sin cargas máximas, con una nota técnica 1–3; M15/M16 estiman el 1RM con Epley con RIR desde series submáximas (3 a 5 repeticiones con RIR ≥ 2), **nunca al fallo**; M17/M19 replican a la primera.

Ya estaba decidido:

- las tablas `gym_program` (con `plan` jsonb) y `gym_set` del esquema base, la RLS (el jugador carga sus propias series, el `sc` y la administración las del club) y el historial de cambios de `gym_set` (ADR 0030);
- la fórmula `epleyE1rmKg`, el protocolo del e1RM con valores por defecto en el test `strength` del club (`e1rmMinReps`, `e1rmMaxReps`, `e1rmMinRir`, ADR 0039) y `strengthAssessmentFor`, que combina la etapa con la franja de edad para que un M13/M14 madurado o fijado en otra etapa nunca levante cargas máximas;
- el módulo `gym` del club (ADR 0041), la sincronización sin conexión por los mismos handlers (ADR 0050, ADR 0069) y las convenciones de endpoints (ADR 0032).

Faltaba decidir: a quién apunta un programa, qué forma tiene el plan, qué se valida y dónde, qué guarda una serie, cómo se calcula el e1RM y cómo llega todo al teléfono sin señal.

## Decisión

### Programas

- **Destino**: exactamente una categoría (con `stage` opcional: solo los de la categoría en esa etapa, para separar por maduración) o un jugador. Lo chequea la base (`gym_program_target`, `gym_program_stage_target`). Un programa de etapa sin categoría (de todo el club) no existe: la categoría da el deporte, la franja de edad y el alcance del staff.
- **Plan** (`GymPlan` del dominio, validado por el contrato): hasta 7 días con clave estable (`a`, `b`…), cada uno con hasta 20 ejercicios con series, rango de repeticiones o segundos, RIR objetivo, carga sugerida, pausa y notas.
- **Ejercicios**: una biblioteca por defecto en el dominio (`GYM_EXERCISE_LIBRARY`: código, tipo de carga y medida; nombres en `packages/i18n`) más ejercicios propios del club dentro del plan, con nombre y tipo de carga. Un catálogo de ejercicios por club en la base queda para cuando haga falta compartirlo entre programas.
- **Tipo de carga**: `external` (kg), `bodyweight` (cuerpo o palo, sin kg) y `bodyweight_plus` (lastre: se cargan los kg agregados y el total suma la masa corporal).
- **Reglas de la etapa** (`gymPlanIssues`), por cómo se evalúa la fuerza en la etapa del destino (`strengthAssessmentFor`: la etapa indicada o la de la categoría, y la del jugador en ese día para un programa individual): en `technique_reps` (M13/M14) no hay ejercicios con carga externa ni lastre; en `estimated_rm` (M15/M16) todo ejercicio con carga prescribe un RIR objetivo y nunca menor al mínimo del protocolo del club; en `direct_rm` (M17/M19), libre. La API responde `validation_failed` con la ruta del campo (`body.plan.days[i].exercises[j].targetRir`), y la web la muestra en el campo.
- **A quién llega un programa de categoría**: a los jugadores de la categoría ese día en la etapa del programa (la fijada por el staff o por maduración, si no la de la categoría). Uno sin `stage` se validó contra la etapa por defecto de la categoría, así que llega solo a quien se evalúa igual (`strengthAssessmentFor` de su etapa = el de la etapa por defecto): un M15 de maduración tardía fijado en `foundation` no recibe el programa con cargas de su categoría ni un M17 fijado en `development` uno al fallo; reciben los de su etapa. La regla es la misma en la lectura, el pull y el registro de series.
- Se archivan (`archived_at`) en vez de borrarse; sus series se conservan.

### Series

- Cada serie guarda el **tipo de carga con que se cargó** (`gym_set.load_kind`): cómo se midió (principio 4), aunque el programa cambie después. El ejercicio sale del programa (si se indica, y tiene que estar en vigor para el jugador ese día) o de la biblioteca; si no está en ninguno, `validation_failed`.
- **Errores** (`gymSetIssues`, `validation_failed`): repeticiones o segundos según el ejercicio, kg obligatorios con carga externa (> 0) y con lastre (≥ 0), prohibidos con peso corporal; RIR obligatorio en una serie con carga desde M15 (lo necesitan el e1RM y el control del fallo); ejercicios con carga rechazados en M13/M14.
- **Avisos** (`gymSetWarnings`, no frenan: la serie se guarda como se hizo): `to_failure` (RIR 0 antes de M17/M19), `rir_below_protocol`, `outside_e1rm_range`.
- La **nota técnica** la pone el staff: el jugador que la manda recibe `validation_failed`.
- **Ventana**: el jugador carga y corrige lo de la última semana (la cola sin conexión, `SYNC_RECORDED_AT_MAX_AGE_DAYS`), medida en el día del club en que el dispositivo registró la mutación; el staff, cualquier día pasado (una planilla en papel); nadie un día futuro.
- Una serie mal cargada **se anula** con motivo (`voided_at`, `voided_by`, `void_reason`), nunca se borra; deja de contar para el e1RM y las exportaciones. Corregir pide la `version` leída y el motivo (historial de cambios).
- Nuevo recurso de la matriz **`gym_set`** (`read`, `log`, `correct`): el jugador lo suyo con consentimiento de datos; `sc` en sus asignaciones; la administración en el club; el coach solo lee. `gym_program` mantiene su fila (lee jugador, coach y sc asignados; gestiona sc asignado y administración).

### e1RM

- **Se calcula al leer, no se guarda**: `gymSetE1rmKg` aplica `epleyE1rmKg` (la misma función del test de fuerza) con el protocolo del test `strength` vigente del club para el deporte y el día, la etapa del jugador ese día y la masa corporal medida más cercana antes (lastre). Así una corrección de la masa, de la etapa o del protocolo se refleja sin recálculos ni tablas derivadas.
- Solo estiman las series del protocolo: ejercicios con carga hechos por repeticiones, con su RIR, dentro del rango de repeticiones y, en M15/M16, con RIR ≥ el mínimo. Nunca en M13/M14. El resumen (`summarizeGymSets`) da por ejercicio la cantidad de series, el último día, el mejor e1RM y el mejor de cada día.
- El e1RM del gimnasio es un dato de entrenamiento: no reemplaza al resultado del test `strength` de la ventana, que sigue siendo el comparable con primera.

### Sin conexión

- Dos colecciones nuevas: `gym_set` (fila de jugador, reloj por campo en repeticiones, carga, RIR, nota técnica, duración y notas) y `gym_program` (solo lectura en el teléfono). Operaciones `gym_set.log` (alta en lote, idempotente por el `clientUuid` de cada serie), `gym_set.correct` (por campo) y `gym_set.void` (final, nunca en conflicto), por los mismos handlers.
- El log de un programa de categoría no tiene jugador: la política de `sync_change` lo deja ver a todo miembro, como la RLS de `gym_program`, y el pull lo filtra con la matriz (al jugador, los de su categoría y etapa de hoy y los suyos; al staff, los de sus categorías). La huella del cursor suma las categorías y la etapa de hoy de los jugadores del alcance: si cambian, el teléfono vuelve a bajar todo. Un programa archivado llega como baja.
- La migración no carga en el log filas previas: no existían (la API es la primera que las escribe) y los valores nuevos del enum no pueden usarse en la misma transacción.

### Pantallas

- **Web**: sección Gimnasio con la lista por alcance (aviso si el módulo está apagado), alta y edición del programa con sus días y ejercicios, archivar y restaurar; en la ficha del jugador, el mejor e1RM por ejercicio con su evolución (gráfico con tabla) y las últimas series con sus avisos, donde el `sc` carga una serie con nota técnica y anula otra con motivo.
- **Mobile**: pestaña Gimnasio del jugador que lee programas y series de la base local y carga cada serie por la cola (prellenada con lo indicado), con el aviso de "nunca al fallo" antes de cargar RIR 0 y lo pendiente marcado. El staff carga desde la web.

## Consecuencias

- Las reglas de etapa viven en el dominio y se evalúan igual en la API y, como avisos, en las pantallas; un cambio del protocolo del club se aplica al leer.
- Leer series cuesta cinco consultas por pedido (etapas, masas, protocolo y la categoría de sus programas), sin importar cuántas sean. Una serie de un programa de categoría se evalúa con la etapa de esa categoría (un jugador en dos ese día).
- Un programa de categoría deja ver su id en el log a cualquier miembro del club (no su contenido sin la RLS de `gym_program`, que ya lo permitía).
- Quedan para después: un catálogo de ejercicios por club en la base, plantillas de periodización entre temporadas y la detección de técnica por video o encoders (Fase 2).
