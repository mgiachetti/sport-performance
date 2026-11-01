# 0004. PostgreSQL con Drizzle y migraciones SQL versionadas

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

El modelo es relacional y multi-tenant: clubes, membresías, categorías, jugadores, sesiones, tests con intentos, cargas diarias, maduración, salud. El aislamiento entre clubes se hace con Row Level Security (ADR 0006), lo que obliga a escribir políticas, funciones y grants en SQL. La app mobile también necesita una base local (SQLite, ADR 0015) con un esquema parecido.

## Decisión

- **PostgreSQL 16** como única base del servidor.
- **Drizzle ORM** para el esquema tipado y las consultas, tanto en la API y el worker (driver `pg`) como en la app mobile (`expo-sqlite`).
- **Migraciones SQL versionadas en el repo.** Se generan con `drizzle-kit` a partir del esquema, se revisan y se commitean. Lo que Drizzle no modela (políticas RLS, funciones `app.*`, grants, triggers, esquema `medical`) se escribe a mano en SQL dentro de las mismas migraciones. Nunca se usa `push` contra staging ni producción.
- Las migraciones corren con un rol dueño de las tablas; la API y el worker se conectan con un rol que no es dueño ni tiene `BYPASSRLS`.
- Los datos de referencia (coeficientes de Khamis-Roche, definiciones de métricas, reglas de alerta por defecto) entran como **seeds versionados**, no como constantes en el código.

## Alternativas descartadas

- **Prisma.** Su modelo propio y su motor de consultas hacen incómodo controlar la transacción por request con `SET LOCAL` que exige la RLS, y SQLite en React Native no es su caso principal.
- **Kysely o SQL plano.** Kysely es un muy buen query builder, pero no da esquema ni migraciones; SQL plano pierde el tipado de punta a punta. Drizzle da las dos cosas y sigue cerca del SQL.
- **Base documental (MongoDB, Firestore).** El dominio es relacional, necesita transacciones, y el aislamiento por tenant dentro de la base (RLS) no tiene un equivalente sólido.

## Consecuencias

- Cada migración es un archivo SQL revisable en el PR; staging y producción se migran en el deploy, en orden.
- Toda tabla nueva lleva `club_id`, políticas RLS y tests de RLS contra Postgres real (regla de `CLAUDE.md`).
- El esquema local de mobile no es idéntico al del servidor (sin RLS, con columnas de sincronización); se mantiene aparte, compartiendo tipos desde `packages/domain` y `packages/contracts`.
