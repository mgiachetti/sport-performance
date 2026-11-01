# 0025. Matriz de permisos declarativa en el dominio

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #34 (B-303)

## Contexto

CLAUDE.md fija quién ve y hace qué (tabla de roles), y lo cruza con tres dimensiones más: las categorías asignadas a cada miembro del staff (`staff_assignment`, B-314), la etapa del jugador (nada de rankings con nombres para jugadores de M13 a M16; percentiles propios desde M15) y los consentimientos de la Ley 25.326 (datos, imagen, salud; sin consentimiento vigente no se cargan datos del tipo). Además, los tutores actúan por un vínculo `guardian` hasta que el jugador cumple 18 años y pasa a ser titular de sus datos (B-311), y los datos de salud solo los ve el rol `medical` (ADR 0008).

Esas reglas las tienen que aplicar igual la API (antes de cada handler), la web (qué pantallas y botones mostrar) y mobile, también sin conexión (ADR 0015). Si cada endpoint o pantalla las escribe por su cuenta, divergen; la RLS (ADR 0006) protege la base, pero no expresa consentimientos, etapas ni mayoría de edad, ni le sirve a la UI.

## Decisión

- **Una tabla declarativa en `packages/domain/src/permissions/`** (`PERMISSION_MATRIX`), lógica pura sin I/O ni dependencias de framework, exportada por `@sport-performance/domain` para la API, la web y mobile. Es la única fuente de verdad de los permisos de la aplicación.
- **Forma:** recurso → acción → rol → regla. Los recursos son un conjunto cerrado (`PERMISSION_RESOURCES`) y cada uno declara sus acciones; los roles son `ROLES` (las membresías de `MEMBERSHIP_ROLES` más `superadmin`). El tipo obliga a declarar **todas** las celdas, incluidas las denegaciones: agregar un recurso, una acción o un rol sin completar la tabla no compila.
- **Una regla** es `deny` o `allow(alcance, ...requisitos)`:
  - alcance: `platform` (solo el registro de clubes, superadmin), `club`, `assigned` (jugadores o categorías de las asignaciones vigentes, por categoría o por deporte), `self` (el jugador del usuario) o `guardian` (un jugador con vínculo vigente; ya mayor de edad, solo si el adulto confirmó el acceso del tutor);
  - requisitos: consentimientos vigentes (`data`, `image`, `health`) y condiciones del jugador (`own_percentiles`, `named_rankings`, `minor`, `adult`). Las condiciones de etapa exigen la regla de la etapa (`STAGE_PROFILES`) **y** la de la categoría (`AgeBand`), porque la etapa sigue a la maduración y un M14 maduro puede estar en `performance`.
- **Evaluador** `can(subject, action, resource)` y `decide(...)`, que devuelve la decisión con un motivo estable (`role_denied`, `no_club`, `other_club`, `missing_target`, `out_of_scope`, `age_restricted`, `stage_restricted`, `missing_consent`, `missing_fact`) y obligaciones: `audit_medical_access` en todo recurso médico (ADR 0008) y `audit_support_access` en todo lo que hace el superadmin. **Falla cerrado:** nada cruza de club, y si la regla necesita un dato que el pedido no trae (el jugador, sus consentimientos, su etapa, su mayoría de edad), deniega.
- **Decisiones de producto que CLAUDE.md no fijaba:**
  - El jugador ve su propio valor contra la referencia anónima del grupo y de primera en todas las etapas; los percentiles propios desde M15; rankings con nombres solo fuera de M13–M16.
  - El tutor ve la ficha resumida, la disponibilidad y los consentimientos; firma y revoca solo mientras el jugador es menor; nunca ve rankings, percentiles ni salud. Al cumplir 18, el jugador firma sus propios consentimientos y el tutor conserva el acceso de lectura solo si el adulto lo confirma (dato que persiste B-311).
  - El `admin` ve y hace todo lo del club salvo salud y firmar consentimientos por otro. El `superadmin` puede lo mismo que el admin en el club que fija como contexto, siempre auditado, más el alta de clubes; nunca salud, consentimientos ni exportar datos de un jugador.
  - Cargar datos del jugador (bienestar, RPE, resultados, mediciones, participación, altura de los padres) exige consentimiento `data`; ver o subir imágenes, `image`; cargar datos médicos, `health`. Leer lo ya cargado no exige consentimiento (salvo imágenes); el borrado tras una revocación es de B-312. Exportar datos fuera del club exige `data` cuando lo hace el club; el titular (jugador adulto o tutor del menor) puede exportar los suyos sin consentimiento, es su derecho de acceso.
  - Un bloqueo médico no exige consentimiento: es una medida de seguridad.
- **Helpers independientes del framework** para los endpoints: `authorize` lanza `PermissionDeniedError` (código `forbidden`; la API responde 403 sin revelar el motivo, que va solo a los logs); `permittedActions` para la UI; `listScope` describe el filtro de un listado (club, categorías y deportes asignados, jugadores propios o tutelados, nada) para traducirlo a SQL, con `rowCheck` cuando además hay que evaluar cada fila; `currentAssignments`, `currentGuardianships` e `isOfAge` arman el sujeto desde las filas de la base con la vigencia `[valid_from, valid_to)` (ADR 0023).
- **Un test por celda**, generado desde la tabla: el test tiene una especificación propia de cada celda, escrita como grilla aparte, y falla si una celda de la matriz no está especificada o al revés. Cada celda se prueba con casos positivos y negativos derivados de la especificación (otro club, sin contexto de club, fuera de la asignación, otro jugador, sin vínculo, mayor o menor de edad, sin consentimiento, etapa o categoría no permitidas). Aparte, tests de invariantes de privacidad que no dependen de la especificación.
- **La RLS sigue siendo la última barrera** en la base (ADR 0006, ADR 0008): la matriz decide en la aplicación, las políticas garantizan que un error de código no filtre datos de otro club ni de salud.

## Consecuencias

- Cambiar un permiso es editar una celda de la matriz **y** su especificación en el test: queda explícito en el diff y en la revisión.
- Cada issue de endpoints arma el sujeto (sesión, membresía, asignaciones, vínculos, jugador del usuario) y los hechos del jugador que piden las reglas, y llama a `authorize` antes de tocar datos; si la decisión trae obligaciones, escribe la auditoría en la misma transacción.
- La web y mobile usan la misma matriz para mostrar u ocultar acciones; mobile la evalúa sin conexión con los datos que tenga sincronizados, y el servidor vuelve a decidir al sincronizar.
- `CONSENT_TYPES` y `CONSENT_SIGNERS` pasan al dominio y `packages/db` construye sus enums desde ahí (mismos valores, sin migración).
- La confirmación del adulto sobre el acceso del tutor necesita una columna en `guardian` (B-311). Un tipo de consentimiento nuevo (por ejemplo, para compartir datos con terceros por separado del consentimiento de datos) es una migración y una celda nueva.
