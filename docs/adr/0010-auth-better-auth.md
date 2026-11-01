# 0010. Auth con Better Auth y OTP por email

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Los usuarios son jugadores desde los 12 años, padres, entrenadores y médicos. Las contraseñas se olvidan, se comparten y se reutilizan; un chico de M13 no va a gestionar una contraseña segura. El login tiene que funcionar en la web y en la app, con sesiones largas en el celular para que cargar bienestar lleve menos de 20 segundos. Los usuarios son globales con membresías por club (ADR 0007), y las políticas RLS dependen de funciones propias, no de un proveedor de identidad (ADR 0006).

## Decisión

- **Better Auth montado dentro de la API** (Fastify), no como servicio externo.
- **Login sin contraseña con código de un solo uso (OTP) al email.** Se eligió OTP sobre magic link porque funciona aunque el email se abra en otro dispositivo y no depende de que el link abra la app correcta.
- **Las tablas de auth viven en nuestra base** (usuarios, sesiones, verificaciones), con el adaptador de Drizzle (ADR 0004) y migraciones como el resto.
- Sesiones para la web (cookie `HttpOnly`, `Secure`, `SameSite`) y para mobile (token guardado en el almacenamiento seguro del sistema), con límites de intentos por email y por IP.
- La API traduce la sesión en `app.user_id`, y la membresía elegida en `app.club_id` y `app.role` (ADR 0006). Better Auth no sabe nada de RLS ni de clubes.
- **Email con Resend** y plantillas con **React Email**, en español rioplatense desde `packages/i18n`.

## Alternativas descartadas

- **Auth0, Clerk, Cognito.** Los datos de identidad de menores quedan en un tercero, el costo crece por usuario activo y el modelo de membresías por club se termina duplicando de nuestro lado igual.
- **Supabase Auth.** Ata las políticas a `auth.uid()` y al proveedor (ADR 0003).
- **Auth propia desde cero.** Sesiones, rotación, rate limiting y OTP seguros son fáciles de hacer mal; Better Auth es una librería TypeScript que da eso sin sacar los datos de nuestra base.
- **Contraseñas.** Peor experiencia y más riesgo para el público de esta app.

## Consecuencias

- El acceso depende de que el email llegue: la entregabilidad de Resend (dominio verificado, SPF, DKIM) es parte del sistema, y el email del jugador menor puede ser el de un tutor.
- Si Better Auth deja de servir, las tablas y las sesiones son nuestras: se reemplaza la librería sin migrar usuarios desde un tercero.
- Las invitaciones por link, el selector de club y el `superadmin` se implementan sobre esta base (B-309).
