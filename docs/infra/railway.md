# Runbook: Railway

Cómo crear, desplegar y operar los ambientes `staging` y `production` (B-701). Las decisiones están en ADR [0003](../adr/0003-infra-railway.md) y ADR [0090](../adr/0090-proyecto-de-railway-como-codigo-y-deploy.md); las variables, en el [catálogo](variables.md).

**Qué es código y qué no.** El repo tiene todo lo que se puede versionar: el proyecto (`.railway/railway.ts`), las imágenes (`apps/{api,worker,web}/Dockerfile`), la web (`apps/web/deploy/`), el CORS del bucket (`.railway/bucket-cors.ts`), el paso de la base de cada deploy (`db:release`) y la promoción a producción (`.github/workflows/promote.yml`, con la rama protegida por `.github/rulesets/production.json`). Lo que este runbook pide hacer a mano es lo que Railway no expone como código o lo que no puede estar en el repo: la cuenta, los secretos, HA/PITR/backups de Postgres, el CORS aplicado, los dominios y el DNS.

Nada de esto se hizo todavía: no hay proyecto, cuenta ni secretos creados. Este documento es lo que tiene que seguir la persona dueña de la cuenta.

## 0. Requisitos

- Cuenta de Railway en un plan con Postgres HA y PITR, y un workspace del equipo. La residencia de los datos y el acuerdo de tratamiento se revisan con la parte legal de datos de menores (Ley 25.326, ADR 0003) **antes** de cargar datos reales.
- Railway CLI **5.49.1 o más nueva** (`railway --version`), con sesión iniciada (`railway login`).
- La GitHub App de Railway instalada en `mgiachetti/sport-performance` (Railway → Account → Integrations → GitHub), con acceso al repo.
- `pnpm install` en la raíz del repo: instala el SDK `railway/iac` en `.railway/node_modules`, que el CLI necesita para evaluar `railway.ts`.
- Cuentas de Resend (dominio verificado) y, si se usa, Sentry (un proyecto para la API y otro para el worker).
- Para el CORS: AWS CLI v2 (`aws --version`).
- Que exista la imagen de Postgres que fija `POSTGRES_IMAGE` en `.railway/railway.ts`, antes del primer `plan` y cada vez que se cambie (un tag inexistente deja el servicio sin arrancar). Tiene que dar `200`:

  ```sh
  tag=16.15   # el de POSTGRES_IMAGE
  token=$(curl -fsS "https://ghcr.io/token?scope=repository:railwayapp-templates/postgres-ssl:pull" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
  curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://ghcr.io/v2/railwayapp-templates/postgres-ssl/manifests/$tag"
  ```

## 1. Crear el proyecto y los ambientes

```sh
# Una vez: proyecto vacío y el ambiente staging (production existe por defecto).
railway init --name sport-performance
railway environment new staging

# Por cada ambiente, desde la raíz del repo:
railway link --project sport-performance --environment staging
railway config plan        # revisar: 5 recursos a crear (Postgres, files, api, worker, web)
railway config apply       # confirma interactivamente; nunca --confirm-destructive sin revisar el plan

railway link --project sport-performance --environment production
railway config plan
railway config apply
```

- El plan muestra los valores de las variables redactados. Las `preserve()` (secretos) quedan vacías hasta el paso 3: es esperable que el primer deploy falle por variables faltantes.
- Si el plan propone **borrar** algo que no esperabas, no apliques: revisá qué cambió en el ambiente (alguien tocó el dashboard) o en `railway.ts`.
- El bucket se crea en `iad` y **no se puede mover** después.

## 2. Dominios generados

Hasta tener un dominio propio, cada ambiente usa el dominio que genera Railway (las URLs de las variables lo referencian con `RAILWAY_PUBLIC_DOMAIN`, sin escribirlo en el repo).

Por ambiente, en el dashboard: servicio `api` → Settings → Networking → **Generate Domain** con puerto **8080**; lo mismo para `web`. El `worker` no tiene dominio. Si se genera después del primer deploy, redeployar `api`, `worker` y `web` para que tomen las URLs.

**La web y la API en sitios distintos no pueden compartir la sesión.** `up.railway.app` está en la [Public Suffix List](https://publicsuffix.org/list/), así que `web-….up.railway.app` y `api-….up.railway.app` son dos sitios, y la cookie de sesión es `SameSite=Lax`: el navegador no la manda en un `fetch` entre sitios ni la guarda de una respuesta así. Por eso la web nunca llama al dominio de la API: el bundle llama a su propio origen (`VITE_API_URL` = `<web>`) y el Caddy de la web reenvía `/v1/*` a la API por la red privada (`API_UPSTREAM` = `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080`). Funciona igual con los dominios generados y con los propios. El dominio público de la API lo usan la app mobile (bearer, sin cookies) y los links de Better Auth. No cambiar `VITE_API_URL` al dominio de la API: el ingreso a la web dejaría de andar sin ningún error visible en el servidor.

## 3. Secretos

Una vez por ambiente; **nunca** el mismo valor en staging y production. Cargarlos en el dashboard (servicio → Variables) como **sealed** (Railway no los vuelve a mostrar) o con `railway variable set --service <servicio> --environment <ambiente> NOMBRE=valor` desde una terminal que no guarde historial. Nunca en un archivo del repo, un issue o un chat.

| Servicio | Variable | Cómo generarla |
|---|---|---|
| `api` | `DB_APP_PASSWORD` | `openssl rand -hex 32` (hexadecimal: va dentro de una URL sin escapar) |
| `api` | `DB_AUTH_PASSWORD` | `openssl rand -hex 32` |
| `worker` | `DB_WORKER_PASSWORD` | `openssl rand -hex 32` |
| `api` | `AUTH_SECRET` | `openssl rand -base64 48` |
| `api` | `RESEND_API_KEY` | Resend → API Keys, permiso "Sending access" y solo el dominio del producto |
| `api` | `EMAIL_FROM` | `Sport Performance <no-reply@<dominio verificado en Resend>>` |
| `api`, `worker` | `SENTRY_DSN` | Sentry → proyecto → Client Keys (opcional; vacío = apagado) |
| `worker` | `EXPO_ACCESS_TOKEN` | Expo → Access tokens, solo si el proyecto exige "enhanced security" para push |
| `worker` (solo staging) | `DEMO_NOTIFICATION_EMAIL_DOMAINS` | dominios catch-all del equipo, separados por coma (opcional) |
| `api` | `POD_COMMAND_SIGNING_KEY` | `openssl ecparam -name prime256v1 -genkey -noout -out pod-command.pem`, después `openssl pkcs8 -topk8 -nocrypt -in pod-command.pem -outform DER \| openssl base64 -A` (opcional hasta tener pods). El PEM queda fuera de línea: de él sale la pública que se graba en los pods (`openssl ec -in pod-command.pem -pubout -outform DER \| openssl base64 -A`). Las firmas son low-S |
| `api` | `POD_COMMAND_SIGNING_KEY_ID` | un id por clave, por ejemplo `srv-<ambiente>-1` (con la clave) |
| `worker` | `POD_MASTER_KEYS` | por club con pods: `<id del club>:$(openssl rand -base64 32)`, separados por coma (opcional hasta tener pods) |

Las contraseñas de la base no se cargan en Postgres a mano: `db:release` crea o actualiza los logins `sp_api`, `sp_auth` y `sp_worker` con ellas en cada deploy de la API. **Rotar** una es cambiar la variable y redeployar la API (y el worker si es la suya); el pre-deploy cambia la contraseña antes de que la versión nueva arranque.

## 4. Postgres: HA, PITR y backups (production)

No es parte de la IaC: se hace con el CLI de Railway sobre el servicio `Postgres` del ambiente `production`.

```sh
P="--project sport-performance --environment production --service Postgres"

railway postgres ha convert $P --replicas 2      # primario + 2 réplicas
railway postgres ha status $P --json             # verificar roles y salud de los miembros
railway postgres pitr enable $P
railway postgres pitr status $P --json           # cobertura del archivo y salud del archivador
railway postgres pitr schedule set --daily --weekly $P
railway postgres pitr schedule list $P --json
```

- Después de convertir a HA, verificar que `PGHOST`/`PGPORT` del servicio `Postgres` (los que referencian `DATABASE_URL` de los servicios y `MIGRATIONS_DATABASE_URL`) apuntan al endpoint del primario del clúster, y redeployar `api` y `worker`.
- `staging`: sin HA; PITR o al menos backups diarios (`pitr schedule set --daily`) para poder ensayar restauraciones.
- La restauración de prueba documentada es B-702. `railway postgres pitr restore ... --new-service-name` crea un servicio nuevo: nunca cambia el tráfico solo.
- Los buckets de Railway no tienen backups: lo que haga falta copiar fuera (videos, PDFs) se resuelve en B-702.

## 5. CORS del bucket

La web sube el escudo y otros archivos al bucket con el `PUT` firmado por la API, desde el navegador: el bucket tiene que aceptar el origen de la web. Por ambiente:

```sh
# Credenciales del bucket (no las guardes en archivos del repo).
railway bucket credentials --bucket files --project sport-performance --environment production --json

# Configuración desde el código, con el origen público de la web del ambiente.
node .railway/bucket-cors.ts https://<dominio de la web> > /tmp/cors.json

AWS_ACCESS_KEY_ID=<ACCESS_KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY> AWS_REGION=auto \
  aws s3api put-bucket-cors --endpoint-url <ENDPOINT> --bucket <BUCKET> --cors-configuration file:///tmp/cors.json
AWS_ACCESS_KEY_ID=<...> AWS_SECRET_ACCESS_KEY=<...> AWS_REGION=auto \
  aws s3api get-bucket-cors --endpoint-url <ENDPOINT> --bucket <BUCKET>
rm /tmp/cors.json
```

Repetirlo cada vez que cambie el dominio de la web. Si el proveedor del bucket rechazara `PutBucketCors`, las subidas desde la web fallan con un error de CORS: abrir un issue antes de producción (la app mobile no usa CORS y sigue funcionando).

## 6. Primer deploy y datos iniciales

Con los secretos cargados, en cada ambiente: dashboard → servicio `api` → **Deploy** (o un push a la rama del ambiente). El orden se resuelve solo:

1. **`api`**: el pre-deploy corre `db:release`. En el log del deploy tiene que verse `Migrations: N applied…`, `Login sp_api provisioned as sport_performance_app.` (y `sp_auth`, `sp_worker`) y `Database declared as "<ambiente>".` Después, el healthcheck `/health/ready` tiene que pasar.
2. **`worker`**: si arrancó antes de que existiera su login (`sp_worker` lo crea el pre-deploy de la API), falla y Railway lo reinicia, pero puede agotar sus 10 reintentos antes de que la API termine su primer deploy. **Después del primer deploy de la API, redeployar el worker** (dashboard → `worker` → Deployments → **Redeploy**) y verificar que queda andando sin reinicios.
3. **`web`**: `/healthz` en verde, la web abre en `<web>` y `<web>/v1/app/compatibility` responde la API (el proxy por la red privada). Ingresar con un código de email y recargar la página: la sesión tiene que seguir abierta (la cookie se guardó en el origen de la web).

Datos iniciales, una vez, desde una sesión en el contenedor de la API (tiene las variables del servicio, incluida la del dueño):

```sh
railway ssh --project sport-performance --environment production --service api
# dentro del contenedor:
node /app/node_modules/@sport-performance/db/dist/cli/seed.js            # tenant ORC (B-306)
```

En staging, además, el club demo (ADR 0055):

```sh
railway ssh --project sport-performance --environment staging --service api
DEMO_SEED_CONFIRM=staging node /app/node_modules/@sport-performance/db/dist/cli/seed-demo.js
```

En producción el seed demo se niega solo: la base está declarada `production`.

**Escudo del club** (ADR 0097): los colores los trae el seed (ORC y el demo usan la marca por defecto de `packages/ui-tokens`); el escudo es un archivo del bucket. La administración del club lo sube desde la web (**Club → Escudo**, PNG o WebP de hasta 1 MiB; el de ORC es `assets/clubs/orc/escudo.png`, también para el demo de staging). Desde un lugar con el archivo, la base del dueño y las variables `STORAGE_*` del bucket, `pnpm --filter @sport-performance/storage club:logo --slug=<club> --file=assets/clubs/orc/escudo.png` hace lo mismo (es idempotente).

## 7. Deploys

- **Staging:** cada commit de `main` se despliega cuando sus checks de GitHub pasan ("Wait for CI" de Railway). Nada que hacer.
- **Production:** GitHub → Actions → **Promote to production** → *Run workflow* (o `gh workflow run promote.yml -R mgiachetti/sport-performance -f sha=<sha>`). Sin `sha` promueve la punta de `main`. El workflow se niega si el commit no está en `main`, si su `ci` no pasó o si mover `production` no es un fast-forward. Railway despliega la rama `production` cuando sus checks pasan.
- **Ambiente `production` de GitHub limitado a `main`** (una vez, antes de la primera corrida): así el workflow solo corre con el código de `main`, y una copia modificada de `promote.yml` o de `promote.sh` en otra rama no llega al paso que mueve la rama (el job además se saltea si no corre desde `main`).

  ```sh
  gh api -X PUT repos/mgiachetti/sport-performance/environments/production \
    --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
  gh api -X POST repos/mgiachetti/sport-performance/environments/production/deployment-branch-policies \
    -f name=main -f type=branch
  gh api repos/mgiachetti/sport-performance/environments/production/deployment-branch-policies --jq '.branch_policies[].name'   # main
  ```

  Si el plan lo permite, agregarle revisores obligatorios (Settings → Environments → `production`).
- **Llave de deploy de la promoción** (una vez, antes del ruleset): el único actor que puede crear o mover `production` es una deploy key con escritura, cuya parte privada es un secreto del ambiente `production` de GitHub (solo lo reciben los jobs de `main`). Después del ambiente (punto anterior). El `GITHUB_TOKEN` del workflow solo lee.

  ```sh
  ssh-keygen -t ed25519 -N '' -C promote-production -f /tmp/promote_key
  gh repo deploy-key add /tmp/promote_key.pub -R mgiachetti/sport-performance --allow-write --title promote-production
  gh secret set PRODUCTION_DEPLOY_KEY -R mgiachetti/sport-performance --env production </tmp/promote_key
  rm /tmp/promote_key /tmp/promote_key.pub
  gh api repos/mgiachetti/sport-performance/keys --jq '.[] | select(.read_only == false) | .title'   # solo promote-production
  ```

  El ruleset deja pasar a **cualquier** deploy key con escritura: no crear otra. Rotarla es repetir los comandos y borrar la vieja (`gh repo deploy-key delete <id>`).
- **Proteger la rama `production` antes de la primera promoción** (una vez; requiere que el repo sea público o un plan con rulesets, igual que el de `main`, ver `docs/security.md`). Sin esto, cualquiera con permiso de escritura (o un token con `contents: write`) podría empujar a `production` cualquier commit, incluso uno que no está en `main`, y Railway lo desplegaría. El ruleset versionado `.github/rulesets/production.json` no deja a nadie crear ni actualizar la rama (`creation`, `update`) salvo a la deploy key, prohíbe borrarla y el force push, y exige el check `ci` en verde en el commit, también al crearla (`do_not_enforce_on_create: false`). La deploy key saltea las reglas, así que lo que verifica `promote.sh` (commit de `main`, `ci` en verde, fast-forward) lo hace el código de `main`, el único que recibe la llave:

  ```sh
  gh api -X POST repos/mgiachetti/sport-performance/rulesets --input .github/rulesets/production.json
  # Después de cambiar el archivo:
  id=$(gh api repos/mgiachetti/sport-performance/rulesets --jq '.[] | select(.name == "production") | .id')
  gh api -X PUT "repos/mgiachetti/sport-performance/rulesets/$id" --input .github/rulesets/production.json
  ```

- **Migraciones:** van hacia adelante y corren en el pre-deploy de la API, antes de que la API nueva tome tráfico y mientras la vieja todavía atiende. **El worker no espera ese pre-deploy:** Railway despliega `api` y `worker` en paralelo, así que el worker nuevo puede arrancar contra el esquema viejo, y el viejo seguir corriendo contra el nuevo. Por eso cada migración es compatible en los dos sentidos (*expand/contract*): un deploy **expande** (tablas, columnas nullables o con default, funciones nuevas) sin que el código la use todavía; el código que la usa va en un deploy posterior; lo que se deja de usar se **contrae** (se borra o restringe) en un tercero. Una migración y el primer código del worker que la necesita nunca van en la misma promoción a producción (en staging, si pasa, el worker falla y Railway lo reinicia hasta que la migración está).

## 8. Volver atrás

- Código: dashboard → servicio → Deployments → deploy anterior → **Rollback**. No se fuerza la rama `production`; el próximo `promote` sigue desde donde estaba.
- Una migración no se revierte con un rollback: se corrige con una migración nueva hacia adelante. Si una migración rompió datos, se restaura con PITR a un servicio nuevo (paso 4) y se decide con el staff.

## 9. Dominio propio

Cuando exista el dominio del producto (uno para todos los clubes, ADR 0014):

1. PR que completa `CUSTOM_DOMAINS` en `.railway/railway.ts` (por ejemplo `api.<dominio>` y `app.<dominio>` en production, `api.staging.<dominio>` y `app.staging.<dominio>` en staging).
2. Después del merge, `railway config plan` y `apply` en cada ambiente; cargar en el DNS los registros que muestra Railway para cada dominio y esperar el certificado.
3. Redeployar `api`, `worker` y `web` (las URLs cambian) y volver a aplicar el CORS (paso 5).
4. Actualizar `API_BASE_URL` y `WEB_APP_URL` de los perfiles de EAS de la app; los links universales (`apple-app-site-association`, `assetlinks.json`) son de B-705.
5. Verificar el dominio de envío en Resend y `EMAIL_FROM`.

## 10. Cambiar la infraestructura

Todo cambio es un PR sobre `.railway/railway.ts` (los tests de `.railway` corren en CI). Después del merge, por ambiente: `railway link …`, `railway config plan`, revisar y `railway config apply`. Para detectar cambios hechos a mano en el dashboard: `railway config plan --detailed-exit-code` (`0` sin cambios, `2` con diferencias). No mezclar: si algo se cambió en el dashboard, se lleva al archivo o se revierte.

## 11. Checklist antes de producción

- [ ] Revisión legal de residencia de datos y acuerdos de tratamiento (Railway, Resend, Sentry).
- [ ] `railway config plan` de `production` sin cambios pendientes.
- [ ] Ruleset `production` aplicado (`gh api repos/mgiachetti/sport-performance/rulesets` lo lista), ambiente `production` de GitHub limitado a `main` con el secreto `PRODUCTION_DEPLOY_KEY`, y una sola deploy key con escritura (paso 7).
- [ ] Imagen `POSTGRES_IMAGE` verificada en ghcr.io (paso 0).
- [ ] Ingreso a la web con un código de email y la sesión sigue abierta al recargar (proxy `/v1/*` de la web, paso 6).
- [ ] Secretos de `production` cargados, sellados y distintos de los de staging.
- [ ] Postgres de production en HA con PITR activo y backups programados; restauración de prueba hecha (B-702).
- [ ] CORS del bucket aplicado y una subida de escudo probada desde la web.
- [ ] Dominios propios con certificado, Resend verificado, emails de ingreso recibidos.
- [ ] `/health/ready` de la API y `/healthz` de la web en verde; worker sin reinicios.
- [ ] Log del pre-deploy con los tres logins y `Database declared as "production"`.
- [ ] Monitoreo y avisos (B-703) andando.
- [ ] Checklist OWASP de `docs/security/api.md` revisada (ADR 0031).
