# Sport Performance

Plataforma de rendimiento para deportes juveniles (desde M13 hasta M19), "estilo Catapult". Trackea tests físicos, carga de entrenamiento, bienestar, gimnasio y maduración **con las mismas métricas y definiciones que usa la primera del club**, para que un jugador que llega a primera traiga 5 o 6 años de historia comparable.

- **Modelo:** white-label multi-tenant. Una sola app y una sola web para todos los clubes; la marca (logo, colores) se aplica en runtime por club.
- **Primer tenant:** Olivos Rugby Club (ORC), Munro, Buenos Aires. Arranca con **rugby masculino y hockey femenino**. El modelo soporta deporte y sexo desde el día uno; lo específico de hockey y femenino está en el milestone M8.
- **Fases:** Fase 1 software sin hardware. Fase 2 hardware compartido (bandas de FC BLE, fotocélulas, luces de reacción, dinamómetro). Fase 3 pod GNSS + IMU por jugador con firmware propio sobre hardware genérico (RAK WisBlock).
- **Backlog:** `docs/backlog.md` (IDs `B-xxx`) ↔ issues de GitHub en `mgiachetti/sport-performance` (cada issue dice su `B-xxx`). ADRs en `docs/adr/`.
- **Maqueta:** `mockups/orc-performance.html` es un boceto básico para ver la idea (pantallas, paleta, tono). Sirve de referencia de intención, **no** de diseño final ni de código a copiar.

## Principios de producto (no negociables)

1. **Mismo diccionario de métricas que la primera.** Cada métrica tiene código canónico, unidad y definición. Si la primera usa Catapult, se copia su configuración (zonas) y se importan sus exportaciones.
2. **Doble lectura de cada métrica:** absoluta (comparable con primera) y relativa (a la capacidad del jugador, por ejemplo % de su Vmax, y a su maduración, años desde el PHV).
3. **Cada etapa mide lo que puede entrenar.** M13/M14 no hacen tests máximos con carga. M17/M19 replican la batería de primera.
4. **Cada resultado guarda cómo se midió:** método (manual, video, fotocélula, pod, app, histórico), evaluador, condiciones y versión del protocolo. Nunca se comparan métodos distintos sin avisar.
5. **Fricción mínima:** el jugador carga bienestar y RPE en menos de 20 segundos; el staff carga un día de test sin conexión.
6. **Menores de edad:** consentimiento de padres o tutores (Ley 25.326), roles estrictos, datos de salud separados, nada de rankings con nombres visibles para jugadores de M13 a M16.
7. **No es un dispositivo médico.** Monitorea carga; nunca diagnostica. La conmoción la gestiona el staff médico con su protocolo.

## Usuarios y roles

| Rol | Ve | Hace |
|---|---|---|
| `player` | Su propia ficha, racha, récords, percentiles (desde M15) | Carga bienestar y RPE |
| `parent` | Ficha resumida de su hijo/a, consentimientos | Firma consentimientos, informa altura de los padres |
| `coach` | Sus categorías asignadas: panel, plantel, sesiones | Crea sesiones, carga minutos y contactos |
| `sc` (preparador físico) | Categorías asignadas, tests, gimnasio | Días de test, rutinas, configuración de batería |
| `medical` | Datos de salud, lesiones, conmociones | Carga lesiones y altas; bloquea jugadores |
| `admin` | Todo lo del club | Usuarios, marca, categorías, importaciones |
| `superadmin` | Todos los tenants | Alta de clubes, soporte con auditoría |

Un usuario es global y tiene **membresías por club** (rol por club). Las categorías que ve cada staff salen de `staff_assignment`. El entrenador ve "no disponible" de un jugador lesionado, nunca el diagnóstico.

## Especificación del dominio

### Etapas

| | M13 / M14 | M15 / M16 | M17 / M19 |
|---|---|---|---|
| Foco | Velocidad, coordinación, técnica con peso corporal o palo | Fuerza con carga progresiva, potencia, capacidad intermitente | Espejo de primera |
| Fuerza | Sin cargas máximas; repeticiones con buena técnica + nota técnica 1–3 | 1RM **estimado** desde series submáximas (3–5 reps con RIR ≥ 2) | 1RM o 3RM directo |
| Antropometría | Cada 4–6 semanas | Trimestral | Trimestral + pliegues (ISAK) |
| Bienestar | 3 ítems con caritas | 5 ítems | 5 ítems + CMJ semanal |
| Rankings | Solo el staff | Staff; el jugador ve sus percentiles | Como en primera |

La etapa se asigna **por maduración** (años desde el PHV) además de la categoría, y el staff puede fijarla a mano.

### Batería de tests (frecuencia en ventanas por año; "2 V" = V1 y V3)

| Código | Test | M13/14 | M15/16 | M17/19 | Dato guardado |
|---|---|---|---|---|---|
| `anthro` | Antropometría + altura de los padres | 4–6 sem | trimestral | trimestral + pliegues | height_cm, sitting_height_cm, weight_kg, phv_offset, pct_adult_height |
| `sprint_40` | Sprint 10/20/40 m | 4 V | 4 V | 4 V | t10, t20, t40 (s); vmax = 20/(t40−t20) (m/s) |
| `cmj` | Salto con contramovimiento | 4 V | 4 V | 4 V + semanal | altura_cm (mejor de 3) |
| `cod_505` | 505 | 2 V | 4 V | 4 V | t_left, t_right (s), asimetría % |
| `ift_3015` | 30-15 IFT | 2 V | 4 V | 4 V | vift_kmh |
| `bronco` | Bronco (si lo usa primera) | — | — | 2 V | tiempo_s |
| `strength` | Fuerza por etapa | flexiones, dominadas, plancha, nota técnica | e1RM (goblet/trap-bar, banca, dominadas) | 1RM/3RM | kg, kg/kg, nota |
| `mobility` | Knee-to-wall, cadera | 2 V | 2 V | 2 V | cm por lado |
| `reaction` | Reacción simple y go/no-go | 2 V | 2 V | 2 V | ms (solo contra el mismo jugador, mismo equipo) |
| `neck` | Isométrico de cuello 4 direcciones | — | 2 V | 4 V | N por dirección (Fase 2) |

**Protocolos** (la versión del protocolo se guarda con cada resultado):
- Sprint: salida parado a 0,5 m detrás de la línea, 3 intentos con 3 min de pausa, vale el mejor. Vmax del tramo 20–40 m.
- CMJ: manos en la cintura, 3 intentos, celular fijo a 1,5 m. `h = g·t²/8` (t = tiempo de vuelo en s, g = 9,81).
- 30-15 IFT: la VIFT se usa para prescribir pasadas.
- e1RM (M15/M16): Epley con RIR, `e1RM = peso × (1 + (reps + RIR)/30)`. Nunca al fallo.
- Reacción: siempre el mismo equipo (la latencia táctil varía 30–80 ms entre equipos).
- General: entrada en calor estandarizada, misma superficie y calzado; registrar método, evaluador y condiciones.

### Calendario (temporada marzo–octubre; se ajusta al fixture de cada club y deporte)

V1 febrero (batería completa + movilidad + bases de reacción y cuello) · V2 abril (sprint, CMJ, 505, 30-15, fuerza) · V3 julio (completa) · V4 noviembre (sprint, CMJ, 505, 30-15, fuerza, movilidad) · Continuo: antropometría, CMJ semanal M17/M19.

### Monitoreo y cálculos (todo configurable por club)

- Bienestar antes de entrenar: 5 ítems 1–5 (sueño, fatiga, dolor muscular, estrés, ánimo); M13/M14 3 ítems con caritas. RPE CR-10 15–30 min después (o a la mañana siguiente).
- `sRPE = RPE × minutos` (UA).
- **EWMA** (Williams et al. 2017): `EWMA_hoy = carga_hoy·λ + (1−λ)·EWMA_ayer`, `λ = 2/(N+1)`. Aguda N = 7, crónica N = 28. `ACWR = EWMA_aguda / EWMA_crónica`. Con < 28 días de historia: estado "historia insuficiente", sin alertas de ACWR.
- **Monotonía** (Foster) = media de la carga diaria de la semana / desvío estándar (los días sin carga cuentan como 0). **Strain** = carga semanal × monotonía.
- **Alertas por defecto** (heurísticas, no predictores de lesión; editables por club): rojo si ACWR > 1,4 o bienestar < 3,0; amarillo si ACWR > 1,3 o < 0,8, bienestar < 3,3, CMJ más de 7% por debajo de la base del jugador, o velocidad de crecimiento en zona de pico. Bienestar también contra la media móvil propia (z-score).
- "El día" se calcula en la zona horaria del club.

### Maduración (verificar coeficientes contra los papers antes de producción)

- **Mirwald 2002, varones:** `offset = −9,236 + 0,0002708·(LP×TS) − 0,001663·(E×LP) + 0,007216·(E×TS) + 0,02292·(P/T×100)`
- **Mirwald 2002, mujeres:** `offset = −9,376 + 0,0001882·(LP×TS) + 0,0022·(E×LP) + 0,005841·(E×TS) − 0,002658·(E×P) + 0,07693·(P/T×100)`
- **Moore 2015, varones:** `offset = −8,128741 + 0,0070346·(E×TS)` · **mujeres:** `offset = −7,709133 + 0,0042232·(E×T)`
- LP = largo de piernas (talla − talla sentado, cm), TS = talla sentado (cm), E = edad decimal, P = peso (kg), T = talla (cm).
- **% de talla adulta predicha:** Khamis-Roche 1994; coeficientes por edad y sexo como **datos en la base** (seed), no hardcodeados. Requiere altura de los padres.
- Velocidad de crecimiento (cm/año) y alerta en zona de pico (sugiere bajar saltos y sprints, vigilar rodilla y talón). Bio-banding: agrupar por offset de PHV.

### Equivalencia con Catapult (métricas de cancha)

Códigos canónicos: `dist_m`, `dist_m_min`, `hsr_abs_m` (> 5,5 m/s por defecto o el umbral de primera), `hsr_rel_m` (> 60% de la Vmax del jugador), `vmax_ms`, `vmax_pct`, `acc_n`, `dec_n` (> 2 m/s²), `accel_load_au` (**nunca usar el nombre "PlayerLoad"**), `contacts_n`, `scrums_n`, `kicks_n`, `time_to_feet_s`, `big_time_s`, `hr_avg`, `hr_max`, `trimp`. `metric_definition.catapult_aliases` mapea columnas de OpenField ("Total Distance", "HSR Distance", "Max Velocity"…) a estos códigos.

## Arquitectura (decisiones tomadas; detalle en `docs/adr/`)

| Tema | Decisión | ADR |
|---|---|---|
| Lenguaje | TypeScript estricto en todo (salvo `firmware/`) | [0002](docs/adr/0002-typescript-estricto.md) |
| Monorepo | pnpm workspaces + Turborepo. `apps/{api,worker,web,mobile}`, `packages/{domain,contracts,db,ui-tokens,i18n,config}`, `mockups/`, `assets/`, `firmware/`, `docs/` | [0001](docs/adr/0001-monorepo-tooling.md) |
| Infra | Railway (no Supabase: Postgres estándar, sin auth ni helpers de RLS del proveedor): Postgres con HA y PITR, API, worker, web, buckets S3-compatibles. Ambientes `staging` y `production` | [0003](docs/adr/0003-infra-railway.md) |
| DB | PostgreSQL 16. Drizzle ORM + migraciones SQL versionadas en `packages/db`; datos de referencia como seeds; FK compuestas `(club_id, id)` y auditoría en toda tabla del club | [0004](docs/adr/0004-postgres-drizzle.md), [0023](docs/adr/0023-convenciones-del-esquema-de-base.md) |
| Pod (Fase 3) | Sin TimescaleDB: el crudo del pod va a storage como archivo inmutable, a Postgres solo métricas derivadas | [0005](docs/adr/0005-pod-crudo-en-storage.md) |
| Multi-tenant | `club_id` en **todas** las tablas + Row Level Security. La API abre una transacción por request y hace `SET LOCAL app.club_id / app.user_id / app.role`; las políticas usan funciones propias `app.current_club_id()`, `app.current_user_id()`, `app.current_role()`, nunca funciones de un proveedor. Roles de conexión `sport_performance_app` / `_worker` / `_auth`, rol validado contra la membresía | [0006](docs/adr/0006-multi-tenant-rls.md), [0025](docs/adr/0025-roles-de-conexion-y-politicas-rls.md) |
| Usuarios | Usuario global con membresías por club (rol por club); selector de club si tiene más de una | [0007](docs/adr/0007-usuarios-globales-membresias.md) |
| Salud | Esquema `medical` separado, políticas propias, log de auditoría de cada lectura/escritura | [0008](docs/adr/0008-esquema-medical.md) |
| API | Fastify + `zod`. Contratos en `packages/contracts` (OpenAPI generado, cliente tipado). Transacción por request con contexto de tenant, sobre de error único, probes `/health/live` y `/health/ready` | [0009](docs/adr/0009-api-fastify-zod.md), [0020](docs/adr/0020-convenciones-contratos-api.md), [0023](docs/adr/0024-estructura-de-la-api.md) |
| Permisos | Matriz declarativa recurso × acción × rol en `packages/domain` (alcance por club, asignación, jugador propio o tutelado; condiciones de etapa, consentimiento y mayoría de edad), evaluada igual en API, web y mobile; la RLS sigue como última barrera | [0025](docs/adr/0025-matriz-de-permisos.md) |
| Auth | Better Auth montado en la API: OTP por email; tablas en nuestra base. Email con Resend + React Email | [0010](docs/adr/0010-auth-better-auth.md) |
| Jobs | `apps/worker` con pg-boss (cola sobre Postgres, sin Redis) | [0011](docs/adr/0011-jobs-pg-boss.md) |
| Web staff | React + Vite + TanStack Router + TanStack Query; gráficos SVG propios | [0012](docs/adr/0012-web-staff-react-vite-tanstack.md) |
| Mobile | Expo (React Native) con dev builds; EAS Build + EAS Update (no PWA: BLE, cámara, offline y notificaciones en iOS) | [0013](docs/adr/0013-mobile-expo-eas.md) |
| White-label | Una sola app y una sola web para todos los clubes (guía 4.2.6 de Apple); marca aplicada en runtime | [0014](docs/adr/0014-app-unica-white-label.md) |
| Offline | Mobile: SQLite (`expo-sqlite` + Drizzle) + cola de mutaciones con `client_uuid` y timestamps HLC; servidor resuelve por campo (gana el último); intentos de test solo se agregan | [0015](docs/adr/0015-offline-sqlite-hlc.md) |
| Observabilidad | Sentry + logs estructurados (pino); sin datos personales ni de salud | [0016](docs/adr/0016-observabilidad-sentry-pino.md) |
| Multi-deporte y sexo | `sport` y `sex` en el modelo desde el día uno; lo específico de hockey y femenino en M8 | [0017](docs/adr/0017-deporte-y-sexo-en-el-modelo.md) |
| Sin facturación | No se cobra la app por ahora | [0018](docs/adr/0018-sin-facturacion.md) |
| i18n | ICU MessageFormat (FormatJS) con catálogo fuente `es-AR` tipado en `packages/i18n`; formateadores es-AR propios sobre `Intl`, con la zona horaria del club obligatoria | [0019](docs/adr/0019-i18n-y-formatos-es-ar.md) |
| Seguridad del repo | Dependabot, gitleaks en Actions, CodeQL condicionado al plan, workflows endurecidos y ruleset de `main` versionado (sin aprobaciones obligatorias; check `ci` requerido) | [0021](docs/adr/0021-seguridad-del-repo.md) |

## Identidad visual (tenant ORC; todo como tokens en `packages/ui-tokens`)

Naranja `#F1882A`, negro `#050505`, fondo `#141210`, paneles `#1C1916` / `#24201C`, líneas `#332D27`, texto `#F3EEE7` / `#B9B0A5` / `#857B70`. Estado: bien `#5BBF7A`, atención `#E8C14A`, crítico `#E5604F` — **siempre con ícono y texto, nunca solo color**. Rayas horizontales naranja/negras de la camiseta como sello visual. Tipografía Barlow Condensed (números, títulos, cifras tabulares) + Barlow. Gráficos: jugador en color de marca, promedio de la categoría en gris, referencia de primera con línea blanca punteada y etiqueta directa, tooltip, un solo eje Y, tabla alternativa. Variante clara de alto contraste para usar al sol.

## Convenciones de código

- TypeScript `strict`. Fórmulas del dominio como funciones puras con tests (Vitest), **unidades explícitas en los nombres** (`heightCm`, `speedMs`, `timeS`).
- Códigos de métricas y tests en inglés `snake_case` (`hsr_abs_m`). Identificadores del código en inglés. Textos de UI en **español rioplatense (vos)**, externalizados en `packages/i18n`. Formato `es-AR`: coma decimal, punto de miles, fechas dd/mm/aaaa, unidades SI.
- Nada de reglas de alerta hardcodeadas: reglas declarativas con valores por defecto en seeds.
- Accesibilidad: estado con ícono + texto, foco visible, contraste AA, tabla alternativa por gráfico.
- Privacidad por defecto: el jugador solo ve lo suyo; rankings con nombres solo para el staff.
- Tests: unitarios con Vitest; integración de DB contra Postgres real (Docker local `postgres:16`, servicio en CI). Los tests de RLS son obligatorios para toda tabla nueva.

## Proceso de trabajo

- Un issue → una rama `feat/<issue>-<slug>` (o `fix/`, `chore/`) → un PR contra `main` con `Closes #<issue>`.
- Antes de abrir el PR: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en verde.
- El PR describe qué se hizo, cómo se probó y qué quedó fuera; si algo del issue no se pudo hacer, se dice explícitamente.
- Squash merge. No se commitean secretos; variables en `.env.example`.
- Si una decisión no está en este archivo ni en `docs/adr/`, se toma la opción más alineada con la solución final (no atajos temporales) y se documenta en un ADR nuevo (plantilla en `docs/adr/README.md`). Si cambia una decisión de la tabla de arquitectura, se escribe un ADR que reemplaza al anterior y se actualiza la fila. `pnpm docs:check` valida los ADRs y sus enlaces.
