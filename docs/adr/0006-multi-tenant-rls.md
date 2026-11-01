# 0006. Multi-tenant con `club_id` y RLS sobre funciones propias `app.*`

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Es una sola instalación white-label para todos los clubes. Un dato de un club que aparece en otro es, además de un bug, una filtración de datos de menores. Filtrar por `club_id` en cada consulta de la aplicación funciona hasta el día que alguien se olvida un `WHERE`; el aislamiento tiene que estar garantizado por la base, no por la disciplina de quien escribe la consulta.

## Decisión

- **`club_id` en todas las tablas** con datos de un club, incluidas las tablas hijas (intentos, valores de métricas, logs), aunque se pueda deducir por join. Las políticas no hacen joins para saber el club.
- **Row Level Security** habilitada y forzada (`ENABLE` + `FORCE ROW LEVEL SECURITY`) en todas esas tablas. El rol con el que se conectan la API y el worker no es dueño de las tablas ni tiene `BYPASSRLS`.
- **Contexto por transacción.** La API abre una transacción por request y, antes de cualquier consulta, hace `SET LOCAL app.club_id`, `SET LOCAL app.user_id` y `SET LOCAL app.role` con los datos de la sesión autenticada y el club elegido. El worker hace lo mismo por job, con el club del job. `SET LOCAL` muere con la transacción, así que una conexión del pool nunca arrastra el contexto de otro request.
- **Las políticas usan solo funciones propias:** `app.current_club_id()`, `app.current_user_id()` y `app.current_role()`, definidas en nuestras migraciones (`STABLE`, leen `current_setting('app.…', true)`). Sin contexto devuelven `NULL` y la política no deja ver ni escribir nada: el default es denegar.
- Las políticas por rol (por ejemplo, el `coach` solo ve las categorías de su `staff_assignment`, el `player` solo lo suyo) se construyen sobre esas mismas funciones.
- El `superadmin` no saltea la RLS: opera fijando el contexto del club al que da soporte, y cada acceso queda auditado.

## Por qué funciones propias

Las funciones de un proveedor (por ejemplo, `auth.uid()` de Supabase) atan las políticas a ese proveedor y a su formato de token. Con `app.*` las políticas son SQL estándar, se prueban contra un `postgres:16` cualquiera y sobreviven a un cambio de proveedor o de librería de auth (ADR 0003, 0010).

## Alternativas descartadas

- **Base o esquema por club.** Aísla más, pero multiplica migraciones, conexiones y backups por cada club, y complica a los usuarios que están en varios clubes (ADR 0007).
- **Solo filtros en la aplicación.** Un olvido es una filtración; no hay defensa en profundidad.

## Consecuencias

- Toda tabla nueva necesita políticas y **tests de RLS obligatorios** contra Postgres real: sin contexto no se ve nada, con el club A no se ve el club B, y cada rol ve solo lo que le corresponde.
- Las consultas de toda la aplicación pasan por un helper que abre la transacción y fija el contexto; no hay acceso a la base por fuera de él.
- Los jobs que recorren todos los clubes (por ejemplo, el recálculo nocturno) se parten en un job por club.
- Los índices llevan `club_id` como primera columna donde corresponda, porque todas las consultas filtran por club.
