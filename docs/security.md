# Seguridad del repositorio

Qué protege al repo, qué falta activar y cómo. La revisión de seguridad de la API (OWASP API Top 10 y ASVS) está en [`security/api.md`](security/api.md). Decisión y motivos en [ADR 0021](adr/0021-seguridad-del-repo.md). Para reportar una vulnerabilidad, ver [`.github/SECURITY.md`](../.github/SECURITY.md).

## Estado

| Control | Dónde | Estado |
|---|---|---|
| Dependabot alerts | Ajustes del repo | Activo |
| Dependabot security updates | Ajustes del repo | Activo |
| Dependabot version updates (npm/pnpm y GitHub Actions) | `.github/dependabot.yml` | Activo |
| Escaneo de secretos (gitleaks, todo el historial alcanzable desde `HEAD`: `main` + el PR) | `.github/workflows/security.yml` | Activo |
| `pnpm audit` (alta y crítica) | `.github/workflows/security.yml` | Activo |
| Política de workflows (permisos, SHA, sin `pull_request_target`) | `packages/config/test/repo-security.test.ts` | Activo |
| CodeQL | `.github/workflows/codeql.yml` | Listo; se saltea mientras el repo sea privado sin Advanced Security |
| Secret scanning nativo + push protection | Ajustes del repo | No disponible en el plan actual |
| Protección de `main` (ruleset) | `.github/rulesets/main.json` | **No aplicado**: el plan actual no lo permite |
| Protección de `production` (ruleset: solo la deploy key de `promote` la crea o mueve, sin borrado ni force push, `ci` requerido) | `.github/rulesets/production.json` | Se aplica antes de la primera promoción (`docs/infra/railway.md`, paso 7; ADR 0090) |

## Protección de `main`

El ruleset prohíbe force push y borrado de `main`, exige historial lineal, merge por PR solo con squash y el check `ci` en verde. **No pide aprobaciones ni CODEOWNERS**: hay un solo mantenedor y los PRs los mergea un coordinador automático después de una revisión de agente.

Requiere repo público o GitHub Pro. Para aplicarlo (una vez):

```sh
gh api -X POST repos/mgiachetti/sport-performance/rulesets --input .github/rulesets/main.json
```

Para actualizarlo después de cambiar el archivo:

```sh
id=$(gh api repos/mgiachetti/sport-performance/rulesets --jq '.[] | select(.name == "main") | .id')
gh api -X PUT "repos/mgiachetti/sport-performance/rulesets/$id" --input .github/rulesets/main.json
```

### Check `ci` requerido

El ruleset exige que pase el check `ci` (el job agregador de `.github/workflows/ci.yml`, B-102) antes de mergear, sin pedir que la rama esté al día con `main` (`strict_required_status_checks_policy: false`). El test valida que el workflow exista. Si se renombra el job, actualizar `required_status_checks` en `.github/rulesets/main.json` y aplicar con el `PUT` de arriba.

## CodeQL

El job corre si el repo es público o si se define la variable del repo:

```sh
gh variable set CODE_SCANNING_ENABLED --body true -R mgiachetti/sport-performance
```

En un repo privado eso solo sirve con GitHub Advanced Security (Code Security) activado; sin eso la subida de resultados falla.

## Secret scanning nativo

Cuando el plan lo permita (repo público o Secret Protection):

```sh
gh api -X PATCH repos/mgiachetti/sport-performance \
  -F 'security_and_analysis[secret_scanning][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

gitleaks queda igual en CI como segunda capa.

## Escanear secretos localmente

Con Docker, desde la raíz del repo (misma versión y configuración que CI):

```sh
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 git . --log-opts="HEAD" --config .gitleaks.toml --redact
```

Si aparece un secreto: **rotarlo primero** (darlo por comprometido), después limpiarlo del historial. Un falso positivo se resuelve con una allowlist acotada y comentada en `.gitleaks.toml`, nunca ignorando directorios de código.

## Dependencias

- Dependabot abre PRs los lunes (06:00, Buenos Aires) con prefijo `chore(deps)`, `chore(deps-dev)` o `chore(ci)` y etiquetas `area:infra` + `security`. Minor y patch van agrupados; los majors, de a uno.
- `cooldown`: no se toman versiones con menos de 7 días publicadas (14 para majors). Las security updates no esperan.
- `typescript` queda en `~6.0` hasta que typescript-eslint soporte una versión mayor (ADR 0001); al levantarlo, sacar el `ignore` de `.github/dependabot.yml` y actualizar el test.
- Si `pnpm audit` falla por una advisory sin arreglo, se documenta la excepción en `auditConfig.ignoreGhsas` de `pnpm-workspace.yaml` con el motivo y una fecha de revisión.
