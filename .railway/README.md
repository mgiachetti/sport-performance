# .railway

El proyecto de Railway como código (B-701, [ADR 0087](../docs/adr/0087-proyecto-de-railway-como-codigo-y-deploy.md)).

| Archivo | Qué es |
|---|---|
| `railway.ts` | IaC de Railway: servicios `api`, `worker`, `web`, `Postgres` 16 y bucket `files`, en `staging` y `production`. Lo evalúa `railway config plan` / `apply`. |
| `bucket-cors.ts` | CORS del bucket para la web: `node .railway/bucket-cors.ts <origen de la web>`. |
| `test/` | Checks sin cuenta de Railway: el grafo de cada ambiente contra el repo (Dockerfiles, `watchPatterns`, variables, secretos, drenaje, healthchecks). |

`railway.ts` lo evalúa el CLI con el *type stripping* de Node: sin imports relativos y solo con sintaxis de TypeScript borrable. Cómo crear, desplegar y operar los ambientes: [runbook](../docs/infra/railway.md). Variables: [catálogo](../docs/infra/variables.md).

```sh
pnpm --filter @sport-performance/railway-config test
railway link --project sport-performance --environment staging && railway config plan
```
