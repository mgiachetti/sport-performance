# Architecture Decision Records

Una decisión por archivo, numerados `NNNN-titulo-corto.md`. Un ADR aceptado no se edita: si la decisión cambia, se escribe uno nuevo que lo reemplaza y se marca el anterior como `Reemplazado por NNNN`.

| # | Título | Estado |
|---|---|---|
| [0001](0001-monorepo-tooling.md) | Monorepo y tooling | Aceptado |
| [0002](0002-typescript-estricto.md) | TypeScript estricto en todo | Aceptado |
| [0003](0003-infra-railway.md) | Infraestructura en Railway | Aceptado |
| [0004](0004-postgres-drizzle.md) | PostgreSQL con Drizzle y migraciones SQL versionadas | Aceptado |
| [0005](0005-pod-crudo-en-storage.md) | Crudo del pod en storage, sin TimescaleDB | Aceptado |
| [0006](0006-multi-tenant-rls.md) | Multi-tenant con `club_id` y RLS sobre funciones propias `app.*` | Aceptado |
| [0007](0007-usuarios-globales-membresias.md) | Usuarios globales con membresías por club | Aceptado |
| [0008](0008-esquema-medical.md) | Datos de salud en un esquema `medical` separado y auditado | Aceptado |
| [0009](0009-api-fastify-zod.md) | API con Fastify, zod y contratos compartidos | Aceptado |
| [0010](0010-auth-better-auth.md) | Auth con Better Auth y OTP por email | Aceptado |
| [0011](0011-jobs-pg-boss.md) | Jobs en `apps/worker` con pg-boss | Aceptado |
| [0012](0012-web-staff-react-vite-tanstack.md) | Web del staff con React, Vite y TanStack; gráficos SVG propios | Aceptado |
| [0013](0013-mobile-expo-eas.md) | Mobile con Expo, dev builds, EAS Build y EAS Update (no PWA) | Aceptado |
| [0014](0014-app-unica-white-label.md) | Una sola app white-label para todos los clubes | Aceptado |
| [0015](0015-offline-sqlite-hlc.md) | Offline en mobile: SQLite, cola de mutaciones y resolución por campo con HLC | Aceptado |
| [0016](0016-observabilidad-sentry-pino.md) | Observabilidad con Sentry y logs estructurados con pino | Aceptado |
| [0017](0017-deporte-y-sexo-en-el-modelo.md) | Deporte y sexo en el modelo desde el día uno | Aceptado |
| [0018](0018-sin-facturacion.md) | Sin facturación por ahora | Aceptado |
| [0019](0019-i18n-y-formatos-es-ar.md) | i18n y formatos es-AR | Aceptado |
| [0020](0020-convenciones-contratos-api.md) | Convenciones de los contratos de la API | Aceptado |
| [0021](0021-seguridad-del-repo.md) | Seguridad del repositorio | Aceptado |
| [0022](0022-motor-de-reglas-de-alerta.md) | Motor de reglas de alerta declarativo | Aceptado |
| [0023](0023-convenciones-del-esquema-de-base.md) | Convenciones del esquema de base y del runner de migraciones | Aceptado |
| [0024](0024-estructura-de-la-api.md) | Estructura de la API: transacción con contexto de tenant, errores, probes y apagado | Aceptado |
| [0025](0025-matriz-de-permisos.md) | Matriz de permisos declarativa en el dominio | Aceptado |
| [0026](0026-roles-de-conexion-y-politicas-rls.md) | Roles de conexión, funciones `app.*` y políticas RLS por club y rol | Aceptado |
| [0027](0027-seeds-y-bootstrap-de-club.md) | Seeds y bootstrap de club | Aceptado |
| [0028](0028-auth-membresias-e-invitaciones-en-la-api.md) | Auth, membresías e invitaciones en la API | Aceptado |
| [0029](0029-esquema-medical-acceso-y-auditoria.md) | Esquema `medical`: acceso por funciones auditadas, disponibilidad derivada y soporte del superadmin auditado | Aceptado |
| [0030](0030-historial-de-cambios.md) | Historial de cambios por triggers en una tabla del club append-only | Aceptado |
| [0031](0031-endurecimiento-de-la-api.md) | Endurecimiento de la API: límites generales, headers, validación estricta, secretos y timeouts | Aceptado |
| [0032](0032-convenciones-de-endpoints.md) | Convenciones de endpoints: autorización, contexto de la transacción, soporte, listas, altas idempotentes, concurrencia y archivado | Aceptado |
| [0033](0033-sesiones-activas-por-dispositivo.md) | Sesiones activas por dispositivo y aviso de ingreso nuevo | Aceptado |
| [0034](0034-asignaciones-del-staff-y-membresias.md) | Asignaciones del staff y membresías: vigencia, fin, superposición y cambio de rol | Aceptado |
| [0035](0035-jugadores-y-plantel.md) | Jugadores y plantel: deporte del jugador, posiciones, altura de los padres, alta y baja, y pases de categoría | Aceptado |
| [0036](0036-calendario-temporadas-ventanas-y-fixture.md) | Calendario: temporadas como año de planificación, ventanas sin superponerse y fixture propio | Aceptado |
| [0037](0037-sesiones-participacion-y-rpe.md) | Sesiones, participación y RPE: ventana del jugador, carga masiva idempotente y sesiones archivables | Aceptado |
| [0038](0038-bienestar-diario.md) | Bienestar diario: versión de ítems por etapa, ventana de carga y corrección por el jugador | Aceptado |
| [0039](0039-tests-entradas-crudas-reglas-de-etapa-y-comparacion.md) | Tests: entradas crudas puntuadas en el servidor, reglas de etapa de la batería y aviso de comparación | Aceptado |
| [0040](0040-referencias-de-primera.md) | Referencias de primera: carga, corrección, archivo, importación y vista del jugador | Aceptado |
| [0041](0041-configuracion-del-club.md) | Configuración del club: vigencia de la batería y las zonas, reglas de alerta editables y módulos activos | Aceptado |
| [0042](0042-tutores-y-cuentas-de-menores.md) | Tutores y cuentas de menores: vínculo, invitación del hijo/a y código o link de un solo uso | Aceptado |
| [0043](0043-consentimientos.md) | Consentimientos: textos versionados del club, firma del titular, revocación y `consent_required` | Aceptado |
| [0044](0044-archivos-urls-firmadas-y-retencion.md) | Archivos: bucket S3 con URLs firmadas, tabla `file`, permisos por tipo y retención | Aceptado |
| [0045](0045-compatibilidad-de-versiones-de-la-app.md) | Compatibilidad de versiones: versión de la API, `runtimeVersion`, versión mínima de la app y "actualizá la app" | Aceptado |
| [0046](0046-worker-cola-outbox-y-tablas-derivadas.md) | Worker: pg-boss instalado por las migraciones, outbox de recálculos por triggers y tablas derivadas | Aceptado |
| [0047](0047-importacion-de-padron.md) | Importación de padrón: planilla leída en el cliente, vista previa, duplicados, decisiones por fila y registro sin datos personales | Aceptado |
| [0048](0048-mayoria-de-edad.md) | Mayoría de edad: el adulto decide el acceso de cada tutor y firma sus propios consentimientos | Aceptado |
| [0049](0049-cambio-de-temporada.md) | Cambio de temporada: propuesta por año de nacimiento, revisión obligatoria y aplicación única | Aceptado |
| [0050](0050-sincronizacion-sin-conexion.md) | Sincronización sin conexión: push por los handlers en línea, reloj por campo y log de cambios por transacción | Aceptado |
| [0051](0051-derechos-del-titular.md) | Derechos del titular: exportación desde el catálogo, supresión por la administración y borrado o anonimización de la cuenta | Aceptado |
| [0052](0052-importacion-de-historicos.md) | Importación de históricos: resultados `historical` con su importación, vista previa en un savepoint y reglas de etapa como avisos | Aceptado |
| [0053](0053-alertas-episodios-eventos-y-revision.md) | Alertas: episodios por regla y jugador, eventos append-only y revisión del staff | Aceptado |
| [0054](0054-notificaciones-push-y-email.md) | Notificaciones: push por Expo y email por Resend desde el worker, sin datos de salud | Aceptado |
| [0055](0055-club-demo-y-datos-de-prueba.md) | Club demo y datos de prueba: generador determinístico, filas con id estable, `club.is_demo` y guardas contra producción | Aceptado |
| [0056](0056-graficos-nucleo-compartido-y-renderer-web.md) | Gráficos: núcleo compartido sin plataforma y renderer web en SVG con variables de tema | Aceptado |
| [0057](0057-estructura-de-la-web-del-staff.md) | Estructura de la web del staff: rutas por sesión y club, datos por el cliente tipado, tema en runtime y estado de conexión | Aceptado |
| [0058](0058-base-de-la-app-mobile.md) | Base de la app mobile: Expo Router con guardas por sesión, variantes por ambiente, sesión bearer en el almacenamiento seguro y tests sin simulador | Aceptado |
| [0059](0059-panel-semanal-lectura-agregada-y-bio-banding.md) | Panel semanal: una lectura agregada de lo derivado, alcance por la matriz y bio-banding en la vista | Aceptado |
| [0060](0060-lecturas-de-la-ficha-del-jugador.md) | Lecturas de la ficha del jugador: series derivadas por jugador, grupo de comparación anónimo e historia de la disponibilidad | Aceptado |
| [0061](0061-vista-de-sesion-en-cancha.md) | Vista de sesión en cancha: una lectura acotada por sesión, totales por fuente y jugadores por la matriz | Aceptado |
| [0062](0062-pantalla-de-configuracion-y-lectura-del-catalogo.md) | Pantalla de configuración: matriz por etapa, cambios con vigencia y lectura del catálogo del club | Aceptado |
| [0063](0063-administracion-en-la-web.md) | Administración en la web: secciones por permiso del club, lector de Excel en el navegador y códigos estables de los problemas del padrón | Aceptado |
| [0064](0064-antropometria-carga-por-lote-y-maduracion-al-instante.md) | Antropometría: carga por lote del día de mediciones y maduración al instante calculada por la API | Aceptado |
| [0065](0065-area-de-familia-en-la-web.md) | Área de familia en la web: el tutor ve la ficha resumida de sus hijos/as, firma consentimientos e informa la altura de los padres | Aceptado |
| [0066](0066-consola-de-superadmin-y-lectura-del-registro-de-soporte.md) | Consola de superadmin: motivo por sesión, cliente propio, alta de clubes con su primer admin y lectura del registro de soporte por una función auditada | Aceptado |
| [0067](0067-ayuda-protocolos-y-material.md) | Ayuda y protocolos: lectura de los tests para todo miembro, material por versión solo para el staff y guía de uso en el catálogo de mensajes | Aceptado |
| [0068](0068-planilla-del-dia-de-test.md) | Planilla del día de test: una lectura con estaciones, plantel y anterior; carga con la vista previa del dominio | Aceptado |
| [0069](0069-base-local-y-motor-de-sincronizacion-mobile.md) | Base local y motor de sincronización de la app mobile: SQLite cifrado, cola con vista optimista, ciclos con backoff y borrado al cerrar sesión | Aceptado |
| [0070](0070-senales-del-30-15-ift-en-la-app.md) | Señales del 30-15 IFT en la app: cronograma puro en el dominio, tonos sintetizados, planificador sin deriva y corrida que sobrevive al cierre | Aceptado |
| [0071](0071-informe-pdf-del-jugador-por-ventana.md) | Informe PDF del jugador por ventana: instantánea en la API, render en el worker y archivo `pdf_report` | Aceptado |
| [0072](0072-exportacion-csv-de-los-datos-del-club.md) | Exportación CSV de los datos del club: pedido con alcance fijado en la API, ZIP generado por el worker y guardado en el bucket | Aceptado |
| [0073](0073-informe-de-categoria-por-ventana.md) | Informe de categoría por ventana: agregados del grupo con mínimo, instantánea en la API y archivo `category_report` | Aceptado |
| [0074](0074-app-del-jugador-lecturas-propias-y-cache-local.md) | App del jugador: lecturas propias del rol `player`, caché local de lecturas por membresía y escrituras solo por la cola | Aceptado |
| [0075](0075-gimnasio-programas-por-etapa-series-y-e1rm.md) | Gimnasio: programas por etapa, series con su tipo de carga y e1RM del protocolo de fuerza | Aceptado |
| [0076](0076-dia-de-test-en-cancha.md) | Día de test en cancha: planilla guardada en el teléfono, intentos que solo se agregan por la cola y varios evaluadores sin coordinarse | Aceptado |
| [0077](0077-test-de-reaccion-en-la-app.md) | Test de reacción en la app: equipo registrado por instalación, series puras en el dominio, tiempo desde el primer cuadro y comparación solo con el mismo jugador en el mismo equipo | Aceptado |
| [0078](0078-reporte-de-dolor-en-el-bienestar.md) | Reporte de dolor en el bienestar: lo escribe el jugador en el esquema `medical`, append-only, lectura auditada y sin copia en el teléfono | Aceptado |
| [0079](0079-cmj-semanal-en-la-app.md) | CMJ semanal en la app: resultados fuera del día de test por la cola, base de la regla `cmj_drop` calculada con la función del motor y lecturas guardadas en la base local | Aceptado |
| [0080](0080-sesion-del-entrenador-en-cancha.md) | Sesión del entrenador en cancha: plantel guardado en el teléfono, borrador local antes de la cola, reloj de quién está en cancha y ediciones por campo | Aceptado |
| [0081](0081-staff-en-el-celular.md) | Staff en el celular: vista rápida antes de entrenar guardada en el teléfono, push registrado por sesión con permiso diferido y revisión de alertas solo en línea | Aceptado |
| [0082](0082-sprint-por-video-foto-finish.md) | Sprint por video (foto-finish): un celular de costado, cruce marcado cuadro a cuadro con conos corregidos por paralaje, cuadros como entrada cruda y video que no sale del teléfono | Aceptado |
| [0083](0083-antropometria-en-cancha.md) | Antropometría en cancha: colección sincronizable `anthro_measurement`, operaciones `anthro.record` y `anthro.update`, y planilla sin conexión | Aceptado |
| [0084](0084-carga-externa-informada-por-el-jugador.md) | Carga externa informada por el jugador: tabla propia, suma a la carga diaria marcada aparte y se carga sin conexión | Aceptado |
| [0085](0085-cmj-por-video.md) | CMJ por video: intento por la cola, video atado al intento y subida aparte cuando el intento está en el servidor | Aceptado |
| [0086](0086-modo-kiosco.md) | Modo kiosco: carga del staff por el jugador con permiso propio, canal guardado en la fila, PIN local y nada de datos en pantalla | Aceptado |
| [0087](0087-hockey-posiciones-del-club-y-nombres-de-categorias-por-deporte.md) | Hockey: posiciones del club dentro de líneas fijas del deporte y nombres de categoría por deporte como datos | Aceptado |
| [0088](0088-umbrales-y-referencias-femeninas.md) | Umbrales y referencias femeninas: valores por defecto por sexo como datos, con fuente y sin bifurcar código | Aceptado |
| [0089](0089-menarca-y-validacion-de-la-maduracion-femenina.md) | Menarca como dato de salud opcional y validación de las ecuaciones de maduración femeninas | Aceptado |
| [0090](0090-proyecto-de-railway-como-codigo-y-deploy.md) | Proyecto de Railway como código, imágenes Docker, migraciones en el pre-deploy y promoción por rama | Aceptado |
| [0091](0091-datos-de-cancha-de-hockey.md) | Datos de cancha de hockey: reglas de cancha por deporte en el dominio, minutos por tramo con su suma en la base, sin contactos y alias de Catapult por deporte | Aceptado |
| [0092](0092-seguimiento-del-ciclo-menstrual.md) | Seguimiento del ciclo menstrual: tres llaves, solo la jugadora escribe, lee quien ella autoriza una por una y nada de fases ni predicciones | Aceptado |
| [0093](0093-metricas-de-uso.md) | Métricas de uso: instrumentación propia en la API, uso por miembro con retención y conteos semanales sin miembros | Aceptado |
| [0094](0094-backups-pitr-y-simulacros-de-restauracion.md) | Backups y recuperación: PITR de Railway verificado por simulacros con marcadores, verificación automática y época de sincronización | Aceptado |
| [0095](0095-monitoreo-operativo.md) | Monitoreo operativo: chequeos declarativos medidos por el worker, `/health/ops` para el monitor de uptime y avisos por Sentry sin datos personales | Aceptado |
| [0096](0096-tests-de-punta-a-punta.md) | Tests de punta a punta: stack real con el club demo, código de ingreso leído del log de la API, Playwright para la web y el motor de la app sin dispositivo | Aceptado |
| [0097](0097-sistema-de-diseno-de-la-web.md) | Sistema de diseño de la web: escala tipográfica y de capas en los tokens, primitivas compartidas, shell con escudo y menú de usuario, y el escudo del club demo por el mismo camino que una subida | Aceptado |
| [0098](0098-sistema-de-diseno-de-la-app.md) | Sistema de diseño de la app: primitivas en `apps/mobile/src/ui`, encabezado con escudo por el tema del club y galería de pantallas sobre `react-native-web` | Aceptado |
| [0099](0099-intl-de-hermes-con-polyfills.md) | La app completa el `Intl` de Hermes con los polyfills de FormatJS | Aceptado |
| [0100](0100-navegacion-de-la-app-pila-sobre-pestanas.md) | Navegación de la app: una pila alrededor de las pestañas, como mucho cinco pestañas | Aceptado |
| [0101](0101-tamano-del-binario-android-por-variante.md) | Tamaño del binario de Android por variante: R8 en todo release, APK de staging solo arm64 | Aceptado |

`pnpm docs:check` valida que este índice coincida con los archivos, que cada ADR siga la plantilla, que cada decisión de la tabla de arquitectura de `CLAUDE.md` tenga su ADR y que cada enlace de markdown a un ADR en el repo vaya a un archivo que existe, con el mismo número en el texto del enlace.

## Plantilla

```markdown
# NNNN. Título

- Estado: Propuesto | Aceptado | Reemplazado por NNNN
- Fecha: aaaa-mm-dd
- Issue: #N (B-xxx)

## Contexto

## Decisión

## Consecuencias
```
