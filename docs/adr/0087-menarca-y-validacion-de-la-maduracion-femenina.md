# 0087. Menarca como dato de salud opcional y validación de las ecuaciones de maduración femeninas

- Estado: Aceptado
- Fecha: 2026-11-04
- Issue: #112 (B-805)

## Contexto

B-805 pide validar las ecuaciones femeninas de B-203 (Mirwald 2002 y Moore 2015 en mujeres) y un registro opcional de la menarca como dato de salud. Ya estaba decidido:

- el modelo tiene `sex` desde el día uno (ADR 0017) y las ecuaciones femeninas son datos con su procedencia (`MATURITY_OFFSET_MODELS`), marcadas "verificar contra el paper antes de producción";
- los parámetros de etapa de mujeres (`DEFAULT_FEMALE_STAGE_ASSIGNMENT_PARAMS`) eran los de varones corridos 2 años, "pendientes de validar (B-805)";
- la salud vive en el esquema `medical` (ADR 0008, ADR 0029): sin `SELECT` de columnas clínicas para los roles de conexión, lecturas por funciones `SECURITY DEFINER` que escriben `medical.access_log`, escrituras bajo RLS forzada con log por trigger; el reporte de dolor (ADR 0078) agregó una escritura del propio jugador;
- los parámetros de los cálculos derivados son datos por club en `club.settings.derived` (B-326), con valores por defecto en el dominio.

Quedaban sin decidir: qué significa "validar" sin acceso al texto completo de los artículos, dónde y cómo se guarda la menarca, quién la informa y quién la ve, y para qué se usa.

## Decisión

- **Validación de las ecuaciones femeninas.** Se revisó la literatura de validación en muestras longitudinales independientes de chicas (Malina y Kozieł 2014; Kozieł y Malina 2018): la edad del PHV predicha depende de la edad a la que se mide y tiene menos dispersión que la observada, así que una maduradora temprana sale con offset bajo y una tardía con offset alto, y el error crece lejos del PHV. Queda registrado en la procedencia de los dos modelos femeninos, en el README de `packages/domain` (con su línea en el checklist de verificación) y en tests con casos resueltos término a término para edades de hockey (M15 a M19). No cambia ningún coeficiente ni la ecuación por defecto (`moore_2015`): lo que cambia es cómo se lee el resultado. Siguen marcados para verificar contra el paper.
- **Etapa por maduración en mujeres.** Se mantienen los umbrales de varones corridos 2 años (PHV medio 13,8 contra 11,8 en la muestra de Mirwald), con el margen de 0,5 años y el límite de una etapa de distancia de la categoría, que absorben el sesgo hacia la media; el test que muestra que la maduradora promedio queda en la etapa de su categoría ya existía. Son datos por club, a confirmar con el staff de cada club.
- **La menarca, en `medical.menarche_report`** (migración `0045_menarche`): estado (`not_yet` al día del reporte, `occurred`), fecha con precisión (`day`, `month`, `year`; se guarda truncada al primer día del período y los cálculos usan el medio del período, con la mitad del período como incertidumbre), día del club del reporte y rol de quien la informó (`player`, `parent`, `medical`). Mismas convenciones de club (ADR 0023). **Append-only**: no hay `UPDATE` ni `DELETE` para el rol de la API; un reporte nuevo reemplaza al anterior y vale el último, así que no hace falta motivo de corrección (ADR 0030) ni historial aparte. Un trigger rechaza un reporte de un jugador que no sea mujer y uno con otra fecha que el día del club.
- **Escriben** la jugadora sobre sí misma (consentimientos `data` y `health`), su tutor mientras es menor (`data` y `health`; el dato lo suele saber la familia) y el `medical` asignado (`health`; lo puede preguntar en la consulta), con la política `medical.may_report_menarche` y `reported_by` = rol validado. El resto del staff, nunca.
- **Leen** solo por `medical.read_menarche_reports(...)`, con el log de ADR 0029: la jugadora, su tutor si es menor y el `medical` asignado, **todos con consentimiento de salud vigente**, también el staff médico (a diferencia del registro clínico): el dato existe solo porque el titular lo decidió, y revocar el consentimiento lo saca de la vista de todos. Matriz: recurso `menarche` (médico) con `read` y `report`.
- **Para qué se usa.** El último offset somático de la jugadora se contrasta con la menarca (`checkOffsetAgainstMenarche`): la menarca llega en promedio unos 1,3 años después del PHV, así que con la menarca ocurrida el offset de un día es "años desde la menarca + intervalo" y queda acotado por el intervalo mínimo y máximo; sin menarca al día del reporte solo hay cota superior. Fuera de las cotas más un margen (0,5 años, ≈ el SEE) el contraste dice `offset_below_reference` u `offset_above_reference`. La referencia (intervalo medio, mínimo y máximo, margen y edades plausibles de la menarca) es **dato por club** en `club.settings.derived.maturation.menarche`, con valores por defecto citados (Malina, Bouchard y Bar-Or 2004; Marshall y Tanner 1969) y `verification: 'unverified'` hasta contrastarlos. El contraste **no cambia** el offset guardado ni la etapa ni nada que lea el resto del staff: la menarca no sale del esquema médico, ni siquiera derivada.
- **API:** `GET /v1/players/{playerId}/menarche` (último reporte, historial de hasta 20, si quien consulta puede informar y el contraste) y `POST /v1/players/{playerId}/menarche` (alta idempotente por `clientUuid`, validación con detalle por campo, `409` si el jugador no es mujer, `403` con el módulo `maturation` del club apagado). El contraste se muestra solo a quien también lee la antropometría de la jugadora (la jugadora y el staff médico; el tutor no la lee, por la matriz). Las rutas cuelgan del jugador (`players`), como la altura de los padres, y no de `/v1/medical/...`: el módulo médico de la web (B-410) las va a usar tal cual.
- **Sin conexión, no.** Es un dato que se informa una o dos veces en toda la historia de la jugadora: no entra en la cola de mutaciones ni en la base local del teléfono (como el reporte de dolor, nada de salud de una menor queda en el dispositivo).
- **Derechos del titular (ADR 0051):** la exportación suma `medical.menarche_report` leído por la función auditada (por páginas); la supresión lo alcanza sin cambios (la clave al jugador). La exportación CSV del club (ADR 0072) no exporta salud.

## Alternativas descartadas

- **Columna de menarca en `player` o en `anthro_measurement`.** El staff lee esas tablas por asignación: el dato de salud quedaría a una columna de distancia del entrenador y fuera del log de accesos.
- **Ajustar el offset con la menarca (o usar "años desde la menarca" como indicador de etapa).** Haría que la etapa, que ve todo el staff, revele la menarca. El contraste queda del lado de quien ya puede leerla.
- **Que el staff médico la lea sin consentimiento de salud, como el registro clínico.** El registro clínico es del club (lesiones que el médico atiende); la menarca es un dato que el titular decide dar: sin su consentimiento no se ve.
- **Un consentimiento específico nuevo.** El consentimiento de salud ya es expreso y específico para datos de salud (Ley 25.326, art. 7); la menarca además es opcional por reporte. El seguimiento del ciclo menstrual (B-806) sí pide su propio consentimiento y módulo (`menstrual_cycle`).
- **Coeficientes de la referencia en el código, sin configuración.** Contradice "todo configurable por club" y deja sin camino a un club con su propio dato.

## Consecuencias

- La pantalla de la jugadora y del tutor en la app y la del staff médico en la web (B-410) quedan para después; la API y los textos de `packages/i18n` (`menarche.*`) ya están.
- `medical.integration.test.ts` incluye la tabla y la función nuevas en el catálogo; `menarche.integration.test.ts` cubre escrituras, lectura auditada, consentimiento y aislamiento; `menarche.pg.test.ts`, la API.
- Antes de producción hay que contrastar con los artículos la referencia PHV → menarca y la validez de las ecuaciones femeninas (checklist del README de `packages/domain`).
