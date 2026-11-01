# 0007. Usuarios globales con membresías por club

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Un preparador físico puede trabajar en dos clubes; un padre puede tener un hijo en rugby en un club y una hija en hockey en otro; un jugador puede cambiar de club. Si el usuario fuera propiedad de un club, la misma persona tendría varias cuentas con el mismo email y el login por OTP (ADR 0010) no sabría a cuál entrar.

## Decisión

- **El usuario es global** (identidad y email únicos en todo el sistema). No tiene `club_id`.
- **La pertenencia a un club es una membresía** con su rol (`player`, `parent`, `coach`, `sc`, `medical`, `admin`). El rol es por club: la misma persona puede ser `sc` en un club y `parent` en otro.
- Las categorías que ve cada miembro del staff salen de `staff_assignment`; la relación padre o tutor ↔ jugador es explícita y por club.
- Al iniciar sesión, si el usuario tiene más de una membresía, elige el club; ese club y el rol de esa membresía son los que la API fija en `app.club_id` y `app.role` (ADR 0006). Cambiar de club es cambiar el contexto, no la cuenta.
- `superadmin` es un atributo global del usuario, no una membresía.
- Las invitaciones se hacen por link (deep link a la app) y crean la membresía; si el email ya existe, se reutiliza el usuario.

## Consecuencias

- Las tablas de identidad (usuario, sesión) no llevan `club_id` y tienen políticas propias: cada usuario se ve a sí mismo; los datos de un club sobre esa persona viven en la membresía y en el resto de las tablas del club.
- Un club no ve en qué otros clubes está uno de sus miembros.
- Dar de baja a alguien de un club es cerrar la membresía; borrar la cuenta es otro flujo (derechos del titular).
