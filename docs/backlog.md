# Backlog Sport Performance (borrador para revisión, v2)

> Fuente: documento de traspaso + maqueta (`orc-performance.html`) + decisiones del 01/11/2026.
> v2: review feature por feature. **(nuevo)** = item agregado en la review; **(cambia)** = item existente con alcance ampliado.
> Numeración: B-0xx = M0, B-1xx = M1, y así. Cuando esté aprobado, cada item se convierte en un issue.
> ORC (Olivos Rugby Club) es el primer tenant: rugby masculino y hockey femenino.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Lenguaje | TypeScript estricto en todo (API, worker, web, mobile, dominio) |
| Monorepo | pnpm workspaces + Turborepo |
| Infra | Railway: Postgres con HA y PITR, API, worker, web y buckets (S3-compatible). Ambientes `staging` y `production` |
| Auth | Better Auth montado en la API, login por código (OTP) al email, tablas en nuestra base |
| Email | Resend + plantillas con React Email |
| Web del staff | React + Vite + TanStack Router + TanStack Query. Gráficos en SVG propio, como la maqueta |
| Mobile | Expo (React Native) con dev builds. EAS Build para binarios y **EAS Update** para cambios de JS sin pasar por la tienda. Una sola app para todos los clubes (regla 4.2.6 de Apple) |
| Sin conexión (mobile) | SQLite (`expo-sqlite` + Drizzle) + cola de mutaciones con `client_uuid` y timestamps HLC; resolución por campo (gana el último cambio); los intentos de test son solo de agregado |
| API | Fastify + Drizzle + `zod`. Contratos compartidos en `packages/contracts` (OpenAPI generado) |
| Jobs | `apps/worker` con pg-boss (cola sobre Postgres, sin Redis) |
| Multi-tenant | `club_id` en todas las tablas + RLS. La API hace `SET LOCAL app.club_id / app.user_id / app.role` por transacción; las políticas usan funciones propias (`app.current_club_id()`), nunca funciones de un proveedor |
| Usuarios | Un usuario global con membresías por club (un preparador físico o un padre puede estar en más de un club) |
| Datos de salud | Esquema `medical` separado, con políticas propias y log de auditoría de accesos |
| Pod (Fase 3) | El crudo va a storage como archivo; a Postgres solo métricas derivadas. Sin TimescaleDB |
| Multi-deporte y sexo | `sport` y `sex` en el modelo desde el día uno. Lo específico de hockey y femenino se implementa al final (M8) |
| Observabilidad | Sentry (web, mobile, API, worker) + logs estructurados (pino) |

## Labels

- Área: `area:infra`, `area:domain`, `area:db`, `area:api`, `area:worker`, `area:web`, `area:mobile`, `area:firmware`, `area:hardware`
- Tipo: `type:feature`, `type:decision` (ADR), `type:research`, `type:club` (tarea con el club, no es código), `type:legal`
- Estado: `blocked`
- Transversal: `privacy`, `a11y`, `security`, `sport:hockey`, `sex:female`

## Milestones

| Milestone | Contenido |
|---|---|
| M0 · Club y definiciones | Lo que hay que conseguir o decidir con el club |
| M1 · Fundaciones | Repo, CI, ADRs, paquetes base |
| M2 · Dominio | `packages/domain`: fórmulas y reglas con tests |
| M3 · Datos y API | Esquema, RLS, auth, endpoints, sincronización, worker, notificaciones |
| M4 · Web del staff | Las 6 pantallas de la maqueta + las que faltan |
| M5 · Mobile | App del jugador, modo kiosco y staff en cancha |
| M6 · Integraciones e informes | Catapult, PDF, video del CMJ, foto-finish, reacción, gimnasio |
| M7 · Producción y piloto | Deploy, monitoreo, tiendas, privacidad, piloto |
| M8 · Hockey y femenino | Batería, posiciones, umbrales y módulos específicos |
| F2 · Hardware compartido | Epic (se desglosa más adelante) |
| F3 · Pod GNSS + IMU | Epic (se desglosa más adelante) |

---

## M0 · Club y definiciones

- **B-001 Nombre y marca del producto** (nuevo) · `type:decision`. El repo pasó a `sport-performance`: definir el nombre comercial para las tiendas, el dominio y los emails. "ORC Performance" queda como la marca del tenant.
- **B-002 Catapult de primera (rugby y hockey)** · `type:club`. Producto (Vector/OpenField), configuración de zonas de velocidad y aceleración, y un CSV de exportación de ejemplo por deporte. Bloquea B-601.
- **B-003 Batería actual de primera (rugby y hockey)** · `type:club`. Tests de campo (¿Bronco, Yo-Yo, 30-15?), levantamientos, protocolos.
- **B-004 Referencias de primera** (nuevo) · `type:club`. Valores de primera por test, posición y sexo para las líneas de referencia de la ficha. Bloquea B-321.
- **B-005 Categorías y fixture por deporte** · `type:club`. Nombres de las categorías de hockey, años de nacimiento, fixture → fechas de V1 a V4.
- **B-006 Quién carga qué en cada categoría** · `type:club`. Responsable por tipo de dato; define los roles y las asignaciones en la práctica.
- **B-007 Dispositivos y acceso a celular** (nuevo) · `type:club`. Qué celulares o tablets tiene el staff y qué jugadores (sobre todo M13/M14) no tienen celular propio. Define el alcance del modo kiosco (B-504).
- **B-008 Padrón e históricos** (nuevo) · `type:club`. Conseguir el padrón de jugadores y tutores y las planillas de tests de temporadas anteriores. Alimenta B-330 y B-331.
- **B-009 Protocolo de conmoción y permisos sobre salud** · `type:club`. Quién ve qué del módulo médico; etapas del retorno progresivo que usa el club.
- **B-010 Consentimiento y política de privacidad (Ley 25.326)** · `type:legal` `privacy`. Borrador nuestro + revisión legal. Incluye transferencia internacional (hosting en EE. UU.), inscripción de la base ante la AAIP, retención y borrado, y el paso a la mayoría de edad.
- **B-011 Contrato con el club** (nuevo) · `type:legal` `privacy`. El club es responsable de la base y nosotros encargados del tratamiento: acuerdo de tratamiento de datos, confidencialidad, qué pasa con los datos si el club se va.
- **B-012 Cuentas de desarrollador de Apple y Google** · `type:club`. Titular de las cuentas (persona o empresa, D-U-N-S).
- **B-013 Categorías piloto** · `type:club`. Propuesta: una de rugby y una de hockey.

## M1 · Fundaciones

- **B-101 Monorepo y tooling** (cambia) · `area:infra`. pnpm + Turborepo, TS estricto, ESLint, Prettier, Vitest; estructura `apps/{api,worker,web,mobile}`, `packages/{domain,contracts,ui-tokens,i18n,config}`, `mockups/`, `assets/`, `firmware/`, `docs/adr/`. (La maqueta ya está en `mockups/` y el escudo en `assets/clubs/orc/`.)
- **B-102 CI en GitHub Actions** · `area:infra`. Lint, typecheck, tests y build por paquete con caché de Turborepo; Postgres de servicio para los tests de integración.
- **B-103 CLAUDE.md y ADRs** · `type:decision`. Pasar el documento de traspaso a `CLAUDE.md` actualizado; un ADR por cada decisión de la tabla de arriba.
- **B-104 `packages/ui-tokens`** (cambia) · `area:web` `area:mobile`. Paleta, tipografía, estados y rayas de la camiseta como tokens; salida a variables CSS y a un tema de RN; tema por club en runtime. **Más una variante clara de alto contraste para usar el celular al sol en la cancha.**
- **B-105 `packages/i18n` y formatos es-AR** · Mensajes ICU compartidos por web y mobile; formateo de números, fechas y unidades (coma decimal, dd/mm/aaaa).
- **B-106 `packages/contracts`** · `area:api`. Esquemas `zod` de requests y responses, generación de OpenAPI y cliente tipado para web y mobile.
- **B-107 Seguridad del repo** (nuevo) · `security`. Renovate o Dependabot, secret scanning, CodeQL, protección de `main`.
- **B-108 Tests de punta a punta** (nuevo) · `area:infra`. Playwright para la web y Maestro para mobile, corriendo en CI contra el club demo.

## M2 · Dominio (`packages/domain`, funciones puras con tests)

- **B-201 Tipos base, unidades y tiempo** (cambia) · Tipos para métricas, tests, etapas, deporte y sexo; unidades en los nombres (`heightCm`, `speedMs`). **"El día" se define en la zona horaria del club** (importa para bienestar, rachas y cargas diarias).
- **B-202 Carga de entrenamiento** · sRPE, EWMA aguda y crónica (N configurable), ACWR, monotonía y strain de Foster; manejo de días sin datos y estado "historia insuficiente" (< 28 días).
- **B-203 Maduración** · Mirwald 2002 y Moore 2015 **para varones y mujeres**, Khamis-Roche 1994 (coeficientes como datos, no en el código), velocidad de crecimiento y zona de pico. Tests contra ejemplos publicados; checklist de verificación de coeficientes contra los papers.
- **B-204 Etapa del jugador** · Asignación por offset de PHV + categoría, con posibilidad de fijarla a mano; bio-banding.
- **B-205 Tests físicos** · CMJ por tiempo de vuelo, Vmax 20–40, mejor intento o promedio según la definición, asimetría del 505, e1RM de Epley con RIR, relativo al peso corporal, VIFT del 30-15.
- **B-206 Rangos plausibles** (nuevo) · Rango esperado por métrica, edad y sexo para avisar de errores de tipeo al cargar (por ejemplo, un 40 m en 3 s) sin bloquear la carga.
- **B-207 Motor de reglas de alerta** · Reglas declarativas (parámetros en JSON) con valores por defecto: ACWR, bienestar absoluto y z-score contra la propia media móvil, caída del CMJ contra la base, crecimiento en zona de pico. Severidad, texto y sugerencia.
- **B-208 Percentiles y referencias** · Percentiles por grupo (posición o línea, categoría, sexo, temporadas acumuladas) con tamaño mínimo de muestra; comparación contra la referencia de primera.
- **B-209 Zonas de velocidad** · Umbrales absolutos (de Catapult) y relativos (% de Vmax), con vigencia por fecha, por club, deporte, sexo y jugador.
- **B-210 Exposición y lesiones** (nuevo) · Horas de exposición (entrenamiento y partido) desde la participación; incidencia de lesiones por 1000 horas.

## M3 · Datos y API

- **B-301 Esquema base y migraciones** (cambia) · `area:db`. Modelo de la sección 4 corregido: `club_id` en todas las tablas, `sport`, `sex`, `test_result_value` (varias métricas por resultado), `alert_rule`, `player_stage`, `position` por deporte, auditoría (`created_*`, `updated_*`, `client_uuid`). **Más:** `membership` (usuario × club × rol), `staff_assignment`, `reference_value`, `season`, estado del resultado (`done`, `not_done` con motivo).
- **B-302 RLS y roles de base** · `area:db` `privacy`. Funciones `app.current_*()`, rol de conexión sin privilegios, políticas por tabla, tests de aislamiento entre clubes.
- **B-303 Matriz de permisos** (nuevo) · `area:api` `privacy`. Una sola fuente de verdad de quién ve y hace qué: por rol, por categoría asignada, por etapa (sin rankings con nombres para jugadores de M13 a M16) y por consentimiento. Un test automático por cada celda.
- **B-304 Esquema `medical` y auditoría** · `area:db` `privacy`. Lesiones, conmociones, bloqueos y notas médicas separados; log de cada lectura y escritura.
- **B-305 Historial de cambios** (nuevo) · `area:db`. Toda corrección de un resultado, sesión o medición guarda valor anterior, autor, fecha y motivo. Visible para el staff.
- **B-306 Seeds** · `area:db`. Diccionario de métricas con `catapult_aliases`, definiciones de tests y protocolos versionados, batería de la sección 3.2, tablas de Khamis-Roche, reglas de alerta por defecto, deportes y posiciones de rugby.
- **B-307 Datos de prueba y club demo** (cambia) · `area:db`. Generador con semilla, equivalente a los datos de la maqueta. **Más un club demo permanente en staging** para la revisión de las tiendas, los tests E2E y las demos a otros clubes.
- **B-308 API base en Fastify** · `area:api`. Estructura, contexto de tenant por request, manejo de errores, logs, Sentry, healthchecks.
- **B-309 Auth con Better Auth** (cambia) · `area:api`. OTP por email (Resend), sesiones para web y mobile, límites de intentos, superadmin. **Membresías por club, invitaciones por link (deep link a la app) y selector de club si el usuario tiene más de uno.**
- **B-310 Tutores y cuentas de menores** · `area:api` `privacy`. El tutor invita al jugador; el jugador sin email entra con un código o link que genera el tutor; vínculo `guardian`.
- **B-311 Mayoría de edad** (nuevo) · `area:api` `privacy`. Al cumplir 18, el jugador pasa a ser titular de sus datos: se le piden sus propios consentimientos y se revisa el acceso del tutor.
- **B-312 Consentimientos** · `area:api` `privacy`. Tipos (datos, imagen, salud), versiones del texto, firma y revocación; sin consentimiento vigente no se cargan datos del tipo correspondiente (por ejemplo, sin consentimiento de imagen no hay video de CMJ).
- **B-313 Clubes, marca, deportes y categorías** · `area:api`. CRUD; tema del club servido por la API.
- **B-314 Asignaciones del staff** (nuevo) · `area:api`. Entrenador a una o más categorías, preparador físico a varias, médico por deporte. Define qué ve cada uno.
- **B-315 Jugadores y plantel** · `area:api`. CRUD, posición, lado dominante, altura de los padres (con origen: medida o informada), alta y baja.
- **B-316 Cambio de temporada** (nuevo) · `area:api` `area:worker`. Pase de categoría por año de nacimiento al iniciar la temporada, con revisión manual; la historia queda en `player_category`.
- **B-317 Calendario: temporadas, ventanas y fixture** (nuevo) · `area:api`. Temporada por deporte, ventanas V1 a V4 con fechas, días de test programados y partidos.
- **B-318 Sesiones de entrenamiento y partidos** · `area:api`. Sesiones, drills con nivel de contacto, participación (minutos, estado, contactos), RPE del jugador.
- **B-319 Bienestar** · `area:api`. Carga diaria con versión de ítems (3 o 5 según la etapa).
- **B-320 Tests** (cambia) · `area:api`. Sesiones de test, resultados con intentos, método, evaluador, condiciones y versión del protocolo; aviso cuando se comparan métodos distintos. **Estado "no realizado" con motivo (ausente, lesionado, no corresponde a su etapa).**
- **B-321 Referencias de primera** (nuevo) · `area:api`. Valores de referencia por test, posición, sexo y deporte, con fuente y fecha; carga manual o desde la importación de Catapult.
- **B-322 Configuración** · `area:api`. Batería por club, deporte y categoría; zonas de velocidad; reglas de alerta editables; módulos activos por club.
- **B-323 Sincronización sin conexión** · `area:api`. Push de mutaciones idempotente (`client_uuid`) con resolución por campo vía HLC; pull incremental por cursor; tests de conflictos y reintentos.
- **B-324 Compatibilidad de versiones** (nuevo) · `area:api` `area:mobile`. Versión de la API, `runtimeVersion` de EAS Update, versión mínima soportada de la app y pantalla de "actualizá la app".
- **B-325 Archivos** · `area:api`. Subida con URLs firmadas al bucket (videos de CMJ, logos, PDFs); política de retención y borrado automático.
- **B-326 Worker y cálculos derivados** · `area:worker`. pg-boss; recálculo de cargas, maduración y alertas en cada sincronización y cada noche; tablas `*_daily` para el panel.
- **B-327 Alertas** · `area:api` `area:worker`. Generación, listado, acuse con nota e historial.
- **B-328 Notificaciones** (nuevo) · `area:api` `area:worker`. Push (Expo Push) y email (Resend). Al jugador: al terminar la sesión y a la mañana siguiente si no respondió (como dice la maqueta), en horario permitido para menores. Al staff: alertas críticas y un resumen antes de entrenar. Preferencias por usuario.
- **B-329 Derechos del titular** · `area:api` `privacy`. Exportar todos los datos de un jugador y borrar la cuenta (también lo exige Apple).
- **B-330 Importación de padrón** (nuevo) · `area:api`. CSV o Excel de jugadores, tutores y categorías, con validación, vista previa y detección de duplicados.
- **B-331 Importación de históricos** (nuevo) · `area:api`. Resultados de temporadas anteriores desde planillas, con método "histórico" para no mezclarlos sin aviso.
- **B-332 Seguridad de la API** (nuevo) · `area:api` `security`. Rate limiting, headers, CORS, validación estricta, manejo de secretos, revisión OWASP antes de producción.
- **B-333 Sesiones activas por dispositivo** (nuevo) · `area:api` `security`. Listar y cerrar sesiones propias (web y mobile), cierre por un admin al dar de baja a un miembro y aviso por email de un ingreso nuevo. Sale de la revisión OWASP de B-332.

## M4 · Web del staff

- **B-401 Estructura de la web** · `area:web`. Vite, router, login OTP, layout, tema del club en runtime, selector de deporte y categoría, permisos por rol, estado de sincronización.
- **B-402 Componentes de gráficos** · `area:web` `a11y`. Barras, líneas, mini gráficos y mapa de calor en SVG; tooltip; referencia de primera; tabla alternativa para cada gráfico.
- **B-403 Panel semanal** (cambia) · `area:web`. Pantalla 1 de la maqueta. **Más agrupar por maduración (bio-banding) en lugar de por categoría.**
- **B-404 Ficha del jugador** (cambia) · `area:web`. Pantalla 2: maduración, evolución por ventanas, percentiles, carga de 28 días. **Más historial de alertas y disponibilidad.**
- **B-405 Día de test** · `area:web`. Pantalla 3, versión web (la de cancha es B-505).
- **B-406 Calendario de temporada** (nuevo) · `area:web`. Ventanas, días de test y fixture por deporte y categoría.
- **B-407 Sesiones y carga del entrenador** · `area:web`. Crear sesiones y drills, cargar minutos, estado y contactos (no está en la maqueta).
- **B-408 Vista de sesión** (nuevo) · `area:web`. Pantalla 4 de la maqueta. Primero se alimenta de la importación de Catapult (B-601); después, de las bandas (F2) y del pod (F3).
- **B-409 Configuración** (cambia) · `area:web`. Pantalla 6: matriz de batería, zonas de velocidad. **Más editor de reglas de alerta y referencias de primera.**
- **B-410 Módulo médico** (cambia) · `area:web` `privacy`. Lesiones, conmociones, bloqueos y altas (no está en la maqueta). **El entrenador ve "no disponible" sin el diagnóstico. Retorno progresivo por etapas para conmoción. Estadísticas de lesiones por exposición.**
- **B-411 Administración** (cambia) · `area:web`. Usuarios, roles, asignaciones, invitaciones, marca del club, categorías, temporadas. **Más la importación de padrón.**
- **B-412 Antropometría** · `area:web`. Carga por lote para el día de mediciones, con offset de PHV y % de talla adulta al instante.
- **B-413 Vista para padres y tutores** (cambia) · `area:web` `privacy`. Ficha resumida y consentimientos. **Más la carga de la altura de los padres (la necesita Khamis-Roche).**
- **B-414 Consola de superadmin** (nuevo) · `area:web`. Alta de clubes, módulos activos por club, acceso de soporte con auditoría.
- **B-415 Ayuda y protocolos** (nuevo) · `area:web` `area:mobile`. El protocolo de cada test con texto e imagen o video; guía de uso para el staff.
- **B-416 Sistema de diseño de la web** (nuevo) · `area:web` `a11y`. Pasada de diseño con la identidad del club en runtime: escala tipográfica, tamaños, capas y rayas como tokens; primitivas de pantalla; shell como la maqueta (escudo, rayas, menú de usuario); el club demo con la marca y el escudo de ORC por el camino real; capturas de todas las pantallas. Fase 1 la base, inicio y panel; fase 2 el resto de las pantallas.
- **B-417 Sistema de diseño de la web, fase 2** (nuevo) · `area:web` `a11y`. El resto de las pantallas con las primitivas de B-416: lista de jugadores (filas de 48 px con avatar y columna de estado, sin links subrayados), ficha del jugador sin columnas a medio ancho (Disponibilidad/Maduración, Percentiles/Carga, Historial de alertas), sesiones, días de test, configuración, administración y área de familia; la tabla del panel a 390 px; las barras de marca del gráfico en el claro de alto contraste sin perder el naranja; el demo con 28 días de historia antes de la ventana visible para que el ACWR tenga sentido; capturas de la app mobile por el token `button`.

## M5 · Mobile (Expo)

- **B-501 Base de la app** · `area:mobile`. Expo con dev builds, EAS Build y EAS Update con canales por ambiente, navegación, login OTP, deep links de invitación, tema del club, Sentry.
- **B-502 Base de datos local y sincronización** · `area:mobile`. SQLite + Drizzle, cola de mutaciones, sincronización en segundo plano, indicador de pendientes.
- **B-503 App del jugador** (cambia) · `area:mobile`. Bienestar (3 ítems con caritas o 5 según la etapa) y RPE CR-10 en menos de 20 segundos, racha, récords, percentiles desde M15. **Más su historial de tests, los próximos días de test y sus consentimientos.**
- **B-504 Modo kiosco** (nuevo) · `area:mobile` `privacy`. Una tablet del club donde los jugadores sin celular cargan bienestar y RPE (o el staff por ellos), sin ver datos de los demás.
- **B-505 Día de test en cancha** (cambia) · `area:mobile`. Estaciones, intentos, varios evaluadores en simultáneo, sin conexión, método por fila, mejor intento resaltado. **Más resultado anterior (como en la maqueta), protocolo visible en la estación, estado "no realizado" y aviso de valores fuera de rango.**
- **B-506 CMJ semanal** (nuevo) · `area:mobile`. Flujo rápido de M17/M19, fuera de los días de test, contra la base de cada jugador.
- **B-507 Audio del 30-15 IFT** · `area:mobile`. Señales generadas por la app, pantalla encendida, el staff marca la etapa de cada jugador.
- **B-508 Antropometría en cancha** · `area:mobile`. Carga sin conexión.
- **B-509 Sesión del entrenador en cancha** · `area:mobile`. Minutos y contactos durante o después de la sesión.
- **B-510 Staff en el celular** (nuevo) · `area:mobile`. Alertas push y una vista rápida de quiénes están en alerta o no disponibles antes de entrenar.
- **B-511 Carga externa** (nuevo) · `area:api` `area:mobile`. Campo opcional para que el jugador informe otros deportes o educación física (tipo, minutos, RPE). Suma a la carga total con marca de "informada por el jugador", para que el ACWR refleje la carga real.

## M6 · Integraciones e informes

- **B-601 Importador de CSV de Catapult OpenField** · `area:api` `area:web` `blocked` (B-002). Mapeo por `catapult_aliases`, vista previa, asignación de jugadores, importación de zonas de primera.
- **B-602 Informe PDF del jugador por ventana** · `area:worker`. Para el jugador y su familia.
- **B-603 Informe de categoría por ventana** (nuevo) · `area:worker`. Para el staff y la subcomisión: evolución del grupo, cumplimiento de la batería, tasa de respuesta.
- **B-604 CMJ por video** · `area:mobile`. Grabación a alta velocidad con `react-native-vision-camera`, marcado manual de despegue y aterrizaje cuadro a cuadro; después, detección automática.
- **B-605 Foto-finish para el sprint** · `area:mobile` `type:research`. Celular en la llegada; tiempos de paso por línea.
- **B-606 Test de reacción** · `area:mobile`. Simple y go/no-go, atado a un equipo registrado; solo compara al jugador consigo mismo.
- **B-607 Gimnasio** · `area:web` `area:mobile`. Programas por etapa, registro de series (peso × repeticiones × RIR), nota técnica, e1RM.
- **B-608 Exportación CSV** · `area:api`. De todos los datos del club.
- **B-609 Reporte de dolor en el bienestar (opcional)** (nuevo) · `area:api` `area:mobile` `privacy`. Pregunta "¿te duele algo?" con mapa del cuerpo. Requiere consentimiento de salud; va directo al staff médico (esquema `medical`) y el entrenador no lo ve. Módulo activable por club.
- **B-610 Video de alta velocidad en Android e importación de la galería** (nuevo) · `area:mobile`. Módulo propio de sesión de alta velocidad de Camera2 (VisionCamera no la usa y Samsung no llega a 120 fps sin ella) y videos en cámara lenta del teléfono importados con su tasa de captura real (ADR 0102).

## M7 · Producción y piloto

- **B-701 Infra en Railway** · `area:infra`. Proyecto con `staging` y `production`, Postgres HA + PITR, buckets, dominios, variables, deploy desde CI.
- **B-702 Backups y recuperación** · `area:infra`. PITR verificado con una restauración de prueba documentada.
- **B-703 Monitoreo operativo** (nuevo) · `area:infra`. Uptime, errores de Sentry, jobs fallidos del worker y cola de sincronización, con avisos.
- **B-704 Políticas de tiendas para apps con menores** (nuevo) · `type:research` `privacy`. Google Play Families, guía 5.1.4 de Apple, clasificación por edad y SDKs permitidos. Hay jugadores de 12 años.
- **B-705 Publicación en tiendas** · `area:mobile`. App Store como no listada, Play Store, fichas de privacidad, cuenta de demo para la revisión.
- **B-706 Política de privacidad y términos en la app** · `privacy`. Depende de B-010.
- **B-707 Métricas de uso** (nuevo) · `area:api`. Instrumentación propia y respetuosa de la privacidad (sin SDK de terceros en la app de menores) para medir adopción: respuestas de bienestar, días de test cargados, uso del panel.
- **B-708 Onboarding del club piloto** · `type:club`. Alta del club, importación del padrón, consentimientos firmados, capacitación del staff.
- **B-709 Piloto de 4 semanas e iteración** · `type:club`. Revisión de las métricas de uso y lista de mejoras.

## M8 · Hockey y femenino (el modelo ya los soporta desde M3)

- **B-801 Hockey: deporte, posiciones y categorías** · `sport:hockey`. Posiciones (arquera, defensoras, volantes, delanteras), nombres de las categorías del club.
- **B-802 Hockey: batería de tests** · `sport:hockey`. Según B-003 (por ejemplo, Yo-Yo IR1 en vez de Bronco); fuerza por etapa.
- **B-803 Hockey: datos de cancha** · `sport:hockey`. Cambios ilimitados (minutos por tramo), sin contactos de rugby, cancha de 91,4 × 55 m para el mapa de calor, alias de Catapult de hockey.
- **B-804 Umbrales y referencias femeninas** · `sex:female`. Zonas de velocidad, reglas de alerta y referencias de primera por sexo.
- **B-805 Maduración femenina** · `sex:female` `privacy`. Validar las ecuaciones femeninas de B-203; registro opcional de la menarca como dato de salud.
- **B-806 Seguimiento del ciclo menstrual (opcional)** · `sex:female` `privacy`. Módulo opt-in con consentimiento específico, visible solo para quien la jugadora autorice. Requiere definición con el staff médico.
- **B-807 Prevención de LCA** · `sex:female` `type:research`. Evaluar sumar un test de aterrizaje (por ejemplo, video del drop jump) a la batería.

## F2 · Hardware compartido (epic)

Bandas de FC por BLE + TRIMP, fotocélulas ESP-NOW, luces de reacción, dinamómetro de cuello e isométricos, VBT. Se desglosa al terminar M7.

## F3 · Pod GNSS + IMU (epic)

Prototipo con WisBlock (RAK4631 + RAK12500), firmware de registro y descarga por BLE, DFU, pipeline en el worker (filtrado, zonas, aceleraciones, carga acelerométrica, contactos), validación contra video y contra Catapult, placa propia y chalecos. Se desglosa más adelante.

## Fuera de alcance

- **Facturación a clubes:** no hay plan de cobrar la app por ahora (decidido el 01/11/2026).
