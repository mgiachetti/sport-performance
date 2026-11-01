# 0003. Infraestructura en Railway

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Hay que hospedar Postgres (con datos de menores y de salud, así que con alta disponibilidad, backups y restauración a un punto en el tiempo), una API HTTP, un worker de larga vida (pg-boss, ADR 0011), la web del staff y almacenamiento de objetos (fotos, videos de CMJ, exportaciones de Catapult y, en Fase 3, el crudo del pod). Hacen falta dos ambientes, `staging` y `production`. El equipo es chico: no hay quien opere Kubernetes ni una cuenta grande de nube pública.

La alternativa más evaluada fue **Supabase**, que da Postgres administrado, auth, storage y RLS integrados.

## Decisión

- **Railway** para todo: Postgres con HA y PITR, servicios `api`, `worker` y `web`, y buckets S3-compatibles. Ambientes `staging` y `production`, con variables por ambiente.
- La base es **Postgres estándar**. No se usan extensiones ni funciones propias del proveedor; lo que el sistema necesita (RLS, funciones `app.*`, esquema `medical`) se define en nuestras migraciones (ADR 0004, 0006, 0008).
- El storage se usa a través de la **API S3** genérica, así el código no depende de Railway.
- La configuración de los servicios queda versionada en el repo y los secretos solo en las variables de Railway, nunca en el repo (`.env.example` documenta los nombres).

## Por qué Railway y no Supabase

- **Supabase empuja a usar su auth y sus helpers de RLS** (`auth.uid()`, `auth.jwt()`, roles `anon` y `authenticated`) y el acceso directo desde el cliente vía PostgREST. Nosotros queremos que la API sea la única puerta, con auth propia en nuestras tablas (ADR 0010) y políticas que dependan solo de funciones nuestras (ADR 0006). Usar Supabase ignorando todo eso es pagar por lo que no se usa y quedar igual atado a su forma de hacer las cosas.
- **Igual habría que hospedar la API y el worker en otro lado.** Las Edge Functions no sirven para un worker de larga vida con conexiones persistentes a Postgres. Railway corre base, API, worker, web y buckets en un solo lugar, con red privada entre servicios y un solo panel para ambientes y variables.
- **Portabilidad.** Con Postgres estándar, S3 genérico y contenedores, mudarse a otro proveedor es mover datos y variables, no reescribir auth ni políticas.

## Otras alternativas descartadas

- **AWS o GCP directo.** Más control y más servicios, pero el costo operativo (IAM, redes, RDS, contenedores) no lo puede absorber el equipo hoy.
- **Render, Fly.io.** Alternativas razonables; Railway se eligió por tener Postgres con HA y PITR, buckets y ambientes en el mismo producto.

## Consecuencias

- Hay un solo proveedor para toda la producción: una caída de Railway es una caída del sistema. Se mitiga con PITR, backups exportados fuera de Railway y la portabilidad de arriba.
- Los tests de integración corren contra `postgres:16` en Docker (local y CI), sin depender de nada del proveedor.
- La residencia de los datos y el acuerdo de tratamiento con Railway se revisan en el trabajo legal sobre datos de menores (Ley 25.326).
