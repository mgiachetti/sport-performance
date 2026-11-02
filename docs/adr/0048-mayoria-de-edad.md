# 0048. Mayoría de edad: el adulto decide el acceso de cada tutor y firma sus propios consentimientos

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #42 (B-311)

## Contexto

A los 18 años (Código Civil y Comercial, art. 25; `AGE_OF_MAJORITY_YEARS`) el jugador/a pasa a ser titular de sus datos (Ley 25.326). ADR 0042 dejó los ganchos: la matriz ya tenía `confirmedByAdultPlayer` en cada tutela y la condición `minor` en lo que un tutor solo hace por un menor (firmar, revocar, emitir códigos, invitar, informar alturas, leer el registro médico), pero `loadPermissionSubject` cargaba siempre `false`. ADR 0043 dejó que el adulto firma y revoca lo suyo, sin decidir qué pasa con lo que firmó su tutor. Faltaba decidir:

- qué ve un tutor el día que su hijo/a cumple 18, también en la base (RLS), no solo en la API;
- quién decide si el tutor sigue viendo algo, cómo y qué recupera;
- si la firma del tutor sigue valiendo para el adulto, cuánto tiempo y cómo se le pide la propia.

## Decisión

### El acceso del tutor

- **Sin decisión del adulto, el tutor pierde el acceso al cumplir 18**, en la API y en la base. `app.visible_player_ids()` le da al `parent` solo los jugadores de sus vínculos vigentes que son menores en el día del club, o adultos que **confirmaron** el vínculo. Toda política por jugador la usa, así que el tutor de un adulto que no lo confirmó no ve nada suyo: perfil, consentimientos, bienestar, tests, alturas, códigos ni datos médicos.
- **Lo decide solo el adulto**, por vínculo: permiso nuevo `guardian_link.review` (`player`: `self` + `adult`; nadie más, tampoco la administración ni el superadmin). Tres acciones:
  - `POST /v1/guardians/{id}/adult-confirmation`: mantener el acceso (idempotente; queda la fecha de la primera decisión);
  - `DELETE /v1/guardians/{id}/adult-confirmation`: retirarlo (idempotente; el vínculo sigue y se puede volver a confirmar);
  - `POST /v1/guardians/{id}/end`: terminar el vínculo, igual que lo hace la administración, que lo sigue pudiendo hacer con `guardian_link.manage`. Se anulan los códigos e invitaciones que ese tutor dejó abiertos.
- **El dato vive en `guardian`** (`adult_confirmed_at`, `adult_confirmed_by`, migración `0023_adult_player`, con su `CHECK`). La aplicación no tiene grant sobre esas columnas: las escribe solo `app.review_guardian(guardian, decision)` (`SECURITY DEFINER`), que revalida todo en la base (rol `player` validado, el vínculo es de su propio jugador, mayor en el día del club, vínculo vigente para confirmar o retirar) y responde `ok`, `not_found`, `minor` o `ended`. Queda quién confirmó y cuándo (`adult_confirmed_by`, `adult_confirmed_at`, `updated_by`).
- **Qué recupera el tutor confirmado:** lo que la matriz le da a un tutor sin pedir `minor`, es decir, la lectura (resumen, disponibilidad, consentimientos, vínculos). Lo que exige `minor` sigue negado: un adulto firma, revoca y gestiona su acceso solo. `loadPermissionSubject` carga la confirmación, y el listado de jugadores del tutor (`player_summary`) suma a los adultos que confirmaron.
- **El tutor sigue viendo su propio vínculo** (política `guardian_app_own_link_select`) y `GET /v1/me/children` sigue mostrando al hijo/a mayor que no lo confirmó, con nombre, fecha de nacimiento y `adultConfirmed: false`, para que entienda por qué no ve nada. Lo lee de `app.guardian_children()` (`SECURITY DEFINER`, solo para el rol `parent` y sus vínculos vigentes), porque la RLS de `player` ya no le muestra ese jugador.
- **El adulto ve a sus tutores por nombre** (política `user_app_player_guardians_select` sobre `user`); el email sigue siendo solo para la administración.

### Los consentimientos del adulto

- **La firma del tutor vale 30 días más** (`ADULT_CONSENT_GRACE_DAYS`) después de cumplir 18 y después **caduca**: no se revoca (queda como evidencia de lo que se firmó cuando era menor), pero deja de contar. Así el día del cumpleaños no se corta la carga de bienestar ni de tests, y el adulto tiene un mes para firmar los propios. `app.current_consent_types` (la única definición de vigente, ADR 0043) excluye las firmas de tutor de un jugador que ya era mayor hace 30 días; `medical.has_health_consent` la usa, así que salud sigue la misma regla. Pasado ese día, toda ruta que guarda datos responde `403 consent_required`.
- **Estados nuevos** en `consentStates` (dominio, función pura): `adult_signature_required` (adulto, solo vale una firma del tutor, dentro de la gracia; sigue contando) y `lapsed` (solo queda la firma del tutor y ya caducó; no cuenta). La firma propia del adulto siempre prevalece sobre la del tutor. `GET /v1/players/{id}/consents` informa `guardianSignaturesLapseOn`, el día del club desde el que caducan.
- **El adulto firma el mismo texto que firmó su tutor:** el índice único de firma vigente pasa a ser por texto **y firmante** (`consent_current_document_key`). Dos firmas vigentes del mismo firmante siguen siendo `409`.
- **El día de la mayoría** es el del dominio (`isOfAge`, `majorityDate`): el cumpleaños 18; quien nació un 29 de febrero cumple el 1 de marzo de un año no bisiesto. En SQL se escribe `birth_date > today - interval '18 years'` para un menor, que da el mismo día; un test fija los dos lados.

## Alternativas descartadas

- **Cortar la firma del tutor el mismo día del cumpleaños.** Es lo más estricto, pero frena la carga de datos sin aviso justo el día que el jugador/a tiene que enterarse de que ahora firma él/ella. Con la gracia el estado `adult_signature_required` le pide la firma antes.
- **Mantener la firma del tutor hasta que el adulto la revoque.** El titular nunca consintió: sería tratar datos de un adulto con el consentimiento de otra persona por tiempo indefinido.
- **Revocar la firma del tutor cuando firma el adulto.** Mezcla la evidencia (quién revocó qué) y no hace falta: la firma propia prevalece y la del tutor caduca sola.
- **Gracia configurable por club.** Es un plazo legal-operativo, no una preferencia de entrenamiento; si un club lo necesita distinto, se mueve a la configuración del club con su ADR.
- **Que la administración confirme por el adulto.** Es una decisión sobre los datos del titular; la administración solo termina vínculos.
- **Filtrar al tutor solo en la API.** La RLS es la segunda barrera (ADR 0026); un adulto que no confirmó tiene que quedar fuera también ahí.

## Consecuencias

- La app del jugador/a mayor muestra sus tutores con mantener, retirar y terminar, y pide la firma de cada tipo en `adult_signature_required` o `lapsed`. La del tutor muestra al hijo/a mayor sin datos cuando `adultConfirmed` es `false`. Los avisos al cumplir 18 y antes de que caduque la firma llegan con las notificaciones (#59) sobre el worker (#57).
- Queda fuera: que el adulto con cuenta sin email (`player.<id>@no-email.invalid`, ADR 0042) pase a su propio email, y unir las cuentas de un mismo jugador en dos clubes. Necesitan un flujo de verificación de email propio sobre Better Auth y van en un issue aparte. Mientras tanto la cuenta sin email del adulto sigue funcionando (sesión abierta, o un código que emite la administración).
- `ADULT_CONSENT_GRACE_DAYS` vive en el dominio y en `app.current_consent_types`; cambiarlo es cambiar los dos (un test de integración fija el valor de la base).
