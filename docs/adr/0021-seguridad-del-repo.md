# 0021. Seguridad del repositorio

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #20 (B-107)

## Contexto

B-107 pide actualización de dependencias (Renovate o Dependabot), secret scanning, CodeQL y protección de `main`. El repo es **privado y de una cuenta personal en el plan Free**. Con ese plan GitHub rechaza, verificado por API:

- protección de ramas y rulesets (403, "Upgrade to GitHub Pro or make this repository public");
- secret scanning nativo y push protection (422, "not available for this repository");
- code scanning / CodeQL (requiere GitHub Advanced Security en repos privados).

Sí están disponibles: Dependabot alerts, Dependabot security updates y Dependabot version updates.

El repo tiene un solo mantenedor y los PRs los mergea un coordinador automático después de una revisión independiente hecha por un agente.

## Decisión

- **Dependabot, no Renovate.** Es nativo (no hay que instalar una GitHub App con permisos de escritura sobre el repo), comparte configuración con las security updates y soporta pnpm workspaces y GitHub Actions. Renovate agrupa mejor, pero no compensa sumar un tercero con acceso al código. `.github/dependabot.yml`: semanal, grupos minor/patch (dev y prod), majors sueltos, `cooldown` de 7 días (14 para majors) y TypeScript retenido en `~6.0` según ADR 0001.
- **Secretos con gitleaks en Actions** mientras no haya secret scanning nativo: versión fijada, binario verificado por SHA-256, escaneo de **todo el historial alcanzable desde `HEAD`** (en un PR: `main` + sus commits; no las demás ramas) en cada PR, push a `main` y semanalmente. Reglas por defecto (`.gitleaks.toml`), allowlist solo para el lockfile. Se usa el binario y no `gitleaks-action` para no depender de una acción de terceros ni de su licencia.
- **CodeQL listo pero condicionado:** `.github/workflows/codeql.yml` (`javascript-typescript` y `actions`, `security-extended`) corre solo si el repo es público o la variable `CODE_SCANNING_ENABLED` vale `true`. Mientras tanto, `pnpm audit --audit-level high` en PRs y semanal.
- **Workflows endurecidos** (aplica a todos, no solo a los de seguridad): `permissions` de solo lectura a nivel raíz, permisos extra solo por job, acciones fijadas por SHA de commit, `persist-credentials: false` y sin `pull_request_target`. Un test de Vitest (`packages/config/test/repo-security.test.ts`) lo verifica.
- **Protección de `main` como ruleset versionado** (`.github/rulesets/main.json`): sin force push, sin borrado, historial lineal, merge por PR solo con squash, **0 aprobaciones y sin CODEOWNERS** (un solo mantenedor; exigir aprobaciones bloquearía el merge automático), sin bypass, y el check `ci` (job agregador del workflow de CI, ya en `main`) requerido sin exigir que la rama esté al día. Como el plan no lo permite, el ruleset no está aplicado: el comando está en `docs/security.md`.

## Consecuencias

- Hasta pasar a Pro o hacer público el repo, **`main` no está protegido por GitHub**: la protección depende de la disciplina del proceso (PR + revisión + squash). Es el primer paso a dar cuando cambie el plan.
- gitleaks reemplaza al secret scanning nativo pero no tiene push protection: un secreto se detecta en el PR, no antes del push. Si aparece uno, se rota primero y después se limpia.
- Agregar un workflow nuevo exige fijar acciones por SHA y declarar permisos; el test falla si no. Dependabot mantiene los SHA actualizados.
- `pnpm audit` puede romper PRs ajenos cuando se publica una advisory nueva; se resuelve actualizando la dependencia (o, si no hay arreglo, con una excepción explícita y documentada en `auditConfig.ignoreGhsas` de `pnpm-workspace.yaml`).
