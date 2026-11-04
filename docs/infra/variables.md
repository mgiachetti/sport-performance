# Catálogo de variables de Railway

Qué variable tiene cada servicio en `staging` y `production`, de dónde sale y si es secreta. La fuente de verdad es [`.railway/railway.ts`](../../.railway/railway.ts) (ADR [0087](../adr/0087-proyecto-de-railway-como-codigo-y-deploy.md)); el significado y la validación de cada una están en el `.env.example` de su app ([api](../../apps/api/.env.example), [worker](../../apps/worker/.env.example), [web](../../apps/web/.env.example)). Los tests de `.railway` fallan si una variable que pone la IaC no está acá o en el `.env.example` de su app.

**Cómo leer la columna "Origen":**

- **Literal**: valor fijo en `railway.ts`. Cambiarlo es un PR.
- **Referencia**: Railway la resuelve al desplegar (`${{servicio.VARIABLE}}`). Nunca se carga a mano.
- **Secreto**: `preserve()` en `railway.ts`. Se carga **una vez por ambiente** en Railway (dashboard o `railway variable set`) y nunca se escribe en el repo. Cómo generarla: en el [runbook](railway.md#3-secretos).
- **Operación**: también `preserve()`, pero no es secreta: se cambia desde el dashboard cuando hace falta (por ejemplo, al publicar una versión de la app).

`<api>` y `<web>` son los orígenes públicos: el dominio propio de `CUSTOM_DOMAINS` o, mientras no exista, `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` y `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`.

## `api`

| Variable | Origen | Valor en staging / production | Notas |
|---|---|---|---|
| `NODE_ENV` | Literal | `production` | Staging corre en modo producción: mismas validaciones de secretos y headers. |
| `HOST` | Literal | `::` | IPv4 e IPv6 (la red privada de Railway es IPv6). |
| `PORT` | Literal | `8080` | El dominio apunta a este puerto. |
| `LOG_LEVEL` | Literal | `info` | |
| `TRUST_PROXY_HOPS` | Literal | `1` | El edge de Railway (ADR 0031). |
| `DATABASE_URL` | Literal con referencias | `postgresql://sp_api:${{DB_APP_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | Login del rol `app` (ADR 0026), por la red privada. |
| `AUTH_DATABASE_URL` | Literal con referencias | igual, con `sp_auth` y `${{DB_AUTH_PASSWORD}}` | Login del rol `auth` (Better Auth). |
| `DB_APP_PASSWORD` | Secreto | 64 caracteres hexadecimales | Contraseña de `sp_api`. `db:release` crea o actualiza el login con ella. |
| `DB_AUTH_PASSWORD` | Secreto | 64 caracteres hexadecimales | Contraseña de `sp_auth`. |
| `MIGRATIONS_DATABASE_URL` | Referencia | `${{Postgres.DATABASE_URL}}` | Dueño (superusuario de Railway). **Solo** para `db:release` en el pre-deploy: la imagen la quita del proceso de la API y la API se niega a arrancar con ella. |
| `WORKER_DATABASE_URL` | Referencia | `${{worker.DATABASE_URL}}` | Para que `db:release` provisione `sp_worker`. Igual que la anterior: nunca llega al proceso. |
| `AUTH_SECRET` | Secreto | 48 bytes aleatorios en base64 | Firma las cookies de sesión. Distinto por ambiente; rotarlo cierra las sesiones web. |
| `AUTH_BASE_URL` | Literal con referencias | `<api>` | https obligatorio en producción. |
| `WEB_ORIGINS` | Literal con referencias | `<web>` | CORS y CSRF de la cookie de sesión. |
| `WEB_APP_URL` | Literal con referencias | `<web>` | Links de invitación (`<web>/invite/<token>`). |
| `APP_DEEP_LINK_SCHEME` | Literal | `sportperformance-staging` / `sportperformance` | Igual al de la variante de la app (`apps/mobile/src/config/variants.ts`). |
| `STORAGE_ENDPOINT` | Referencia | `${{files.ENDPOINT}}` | Bucket `files` (ADR 0044). |
| `STORAGE_REGION` | Referencia | `${{files.REGION}}` | `auto`. |
| `STORAGE_BUCKET` | Referencia | `${{files.BUCKET}}` | Nombre S3 del bucket. |
| `STORAGE_ACCESS_KEY_ID` | Referencia | `${{files.ACCESS_KEY_ID}}` | Credencial del bucket: Railway la genera, nadie la copia. |
| `STORAGE_SECRET_ACCESS_KEY` | Referencia | `${{files.SECRET_ACCESS_KEY}}` | Ídem. |
| `STORAGE_FORCE_PATH_STYLE` | Literal | `false` | Railway usa estilo virtual-hosted (`<bucket>.t3.storageapi.dev`). |
| `RESEND_API_KEY` | Secreto | API key de Resend con permiso de envío | Obligatoria en producción. Una por ambiente. |
| `EMAIL_FROM` | Secreto | `Sport Performance <no-reply@<dominio verificado>>` | No es secreta, pero depende del dominio verificado en Resend: se carga con la key. |
| `SENTRY_DSN` | Secreto | DSN del proyecto de Sentry de la API | Vacía = Sentry apagado. |
| `APP_MIN_VERSION_IOS` | Operación | `0.0.0` hasta publicar | ADR 0045. |
| `APP_MIN_VERSION_ANDROID` | Operación | `0.0.0` hasta publicar | |
| `APP_LATEST_VERSION_IOS` | Operación | vacía hasta publicar | |
| `APP_LATEST_VERSION_ANDROID` | Operación | vacía hasta publicar | |
| `APP_STORE_URL_IOS` | Operación | vacía hasta publicar | B-705. |
| `APP_STORE_URL_ANDROID` | Operación | vacía hasta publicar | B-705. |

## `worker`

| Variable | Origen | Valor en staging / production | Notas |
|---|---|---|---|
| `NODE_ENV` | Literal | `production` | |
| `LOG_LEVEL` | Literal | `info` | |
| `DATABASE_URL` | Literal con referencias | `postgresql://sp_worker:${{DB_WORKER_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | Login del rol `worker`. La misma conexión corre pg-boss. |
| `DB_WORKER_PASSWORD` | Secreto | 64 caracteres hexadecimales | Contraseña de `sp_worker`; la provisiona el pre-deploy de la API. |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE` | Referencia / literal | como en la API | Job de retención (ADR 0044) y PDFs/exportaciones. |
| `NOTIFICATIONS` | Literal | `on` | `off` solo para una copia de datos de producción en staging. |
| `RESEND_API_KEY` | Referencia | `${{api.RESEND_API_KEY}}` | Se carga una sola vez, en la API. |
| `EMAIL_FROM` | Referencia | `${{api.EMAIL_FROM}}` | |
| `WEB_APP_URL` | Literal con referencias | `<web>` | Links de los emails. |
| `EXPO_ACCESS_TOKEN` | Secreto | token de Expo | Solo si el proyecto de Expo exige "enhanced security" para push. |
| `SENTRY_DSN` | Secreto | DSN del proyecto de Sentry del worker | |
| `DEMO_NOTIFICATION_EMAIL_DOMAINS` | Operación (solo staging) | dominios catch-all del equipo | El club demo (ADR 0055) no entrega nada salvo a estos dominios. No existe en producción. |

## `web`

| Variable | Origen | Valor en staging / production | Notas |
|---|---|---|---|
| `PORT` | Literal | `8080` | Puerto de Caddy. |
| `VITE_API_URL` | Literal con referencias | `<api>` | Argumento de build (entra en el bundle) y, en runtime, el origen de la API en la CSP. |
| `STORAGE_ENDPOINT` | Referencia | `${{files.ENDPOINT}}` | Solo para la CSP: origen de las URLs firmadas. Sin claves. |
| `STORAGE_BUCKET` | Referencia | `${{files.BUCKET}}` | Ídem. |
| `STORAGE_FORCE_PATH_STYLE` | Literal | `false` | Ídem. |

## `Postgres` y `files`

Las variables de la base (`DATABASE_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`…) y del bucket (`ENDPOINT`, `BUCKET`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`) las genera Railway. Nadie las copia: los servicios las referencian.

## Variables que pone Railway

`RAILWAY_ENVIRONMENT_NAME` (ambiente de Sentry y del guardia del seed demo, y lo que `db:release` declara en la base), `RAILWAY_GIT_COMMIT_SHA` (versión en `/health` y Sentry), `RAILWAY_PUBLIC_DOMAIN` (dominio generado de cada servicio) y `RAILWAY_PRIVATE_DOMAIN`. No se declaran en la IaC.

## Fuera de Railway

- **App mobile:** `APP_VARIANT`, `API_BASE_URL`, `WEB_APP_URL`, `EAS_PROJECT_ID`, `SENTRY_*` se fijan por perfil de EAS ([`apps/mobile/.env.example`](../../apps/mobile/.env.example)); `API_BASE_URL` y `WEB_APP_URL` son `<api>` y `<web>` del ambiente.
- **GitHub:** ningún secreto de Railway. El workflow `promote` usa solo el `GITHUB_TOKEN`.
