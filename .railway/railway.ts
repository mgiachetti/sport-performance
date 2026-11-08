/**
 * The Railway project of Sport Performance as code (B-701, ADR 0003, ADR 0090).
 *
 * `railway config plan` diffs this file against the linked environment and
 * `railway config apply` applies it (docs/infra/railway.md). One project, two
 * environments (`staging`, `production`), the same five resources in each:
 *
 * - `api`     Fastify API (apps/api/Dockerfile). Its pre-deploy runs `db:release`.
 * - `worker`  pg-boss jobs (apps/worker/Dockerfile). No public domain.
 * - `web`     staff web, static behind Caddy (apps/web/Dockerfile).
 * - `Postgres` PostgreSQL 16 (ADR 0004). HA and PITR are enabled on it with the
 *             Railway CLI in production (runbook): they are not part of the IaC.
 * - `files`   S3-compatible bucket (ADR 0044).
 *
 * Secrets never live here: they are `preserve()` (Railway keeps the value set
 * once in the dashboard or with `railway variable set`). Everything else is a
 * literal or a reference, so a plan shows any drift. The CLI evaluates this
 * file with Node's type stripping: keep it self-contained (no relative
 * imports) and to erasable TypeScript syntax.
 */
import {
  bucket,
  database,
  defineRailway,
  github,
  preserve,
  project,
  ref,
  service,
} from 'railway/iac';
import type { BuildConfig, DeployConfig, VariableValue } from 'railway/iac';

export const PROJECT_NAME = 'sport-performance';
export const REPOSITORY = 'mgiachetti/sport-performance';

export const ENVIRONMENTS = ['staging', 'production'] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

/**
 * Branch each environment deploys, always after GitHub's checks pass
 * (`checkSuites`). `production` only moves forward through the `promote`
 * workflow, to a commit of `main` whose `ci` is green.
 */
export const DEPLOY_BRANCH: Record<EnvironmentName, string> = {
  staging: 'main',
  production: 'production',
};

/** Railway's region closest to Buenos Aires (US East, Virginia), for services and the database. */
export const REGION = 'us-east4-eqdc4a';
/** Bucket region of the same metro (Ashburn). Immutable once the bucket exists. */
export const BUCKET_REGION = 'iad';

/** PostgreSQL 16 (ADR 0004), pinned to a minor so staging and production run the same server. */
export const POSTGRES_IMAGE = 'ghcr.io/railwayapp-templates/postgres-ssl:16.15';

/** Port every HTTP service listens on (and its domains point to). */
export const HTTP_PORT = 8080;

/**
 * Custom domains of the product: one for every club (white-label, ADR 0014),
 * never one per club. `null` until the domain exists: the URLs then use the
 * domain Railway generates for the service (created once in the dashboard,
 * never written here). Setting one is a reviewed change to this file plus
 * the DNS records the runbook lists.
 */
export const CUSTOM_DOMAINS: Record<EnvironmentName, { api: string | null; web: string | null }> = {
  staging: { api: null, web: null },
  production: { api: null, web: null },
};

/** Deep link scheme of the mobile variant of each environment (apps/mobile/src/config/variants.ts). */
export const APP_DEEP_LINK_SCHEME: Record<EnvironmentName, string> = {
  staging: 'sportperformance-staging',
  production: 'sportperformance',
};

/** Database logins of each connection role (ADR 0026), provisioned by `db:release`. */
export const DATABASE_LOGINS = { app: 'sp_api', auth: 'sp_auth', worker: 'sp_worker' } as const;

/** Where `db:release` lives inside the API image (`pnpm deploy` output in /app). */
export const RELEASE_COMMAND = 'node /app/node_modules/@sport-performance/db/dist/cli/release.js';

/** Files that change every image: the root of the workspace and its toolchain. */
const WORKSPACE_FILES = [
  '.dockerignore',
  '.nvmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'patches/**',
];

/**
 * What redeploys each service: its app, the workspace packages it ships with
 * (production dependencies, transitively) and `packages/config` (its
 * compiler settings). `.railway/test` checks these against the package.json
 * files, so a new dependency cannot be forgotten here.
 */
export const WATCH_PATTERNS = {
  api: [
    'apps/api/**',
    'packages/config/**',
    'packages/contracts/**',
    'packages/db/**',
    'packages/domain/**',
    'packages/email/**',
    'packages/i18n/**',
    'packages/storage/**',
    'packages/ui-tokens/**',
    ...WORKSPACE_FILES,
  ],
  worker: [
    'apps/worker/**',
    'packages/config/**',
    'packages/contracts/**',
    'packages/db/**',
    'packages/domain/**',
    'packages/email/**',
    'packages/i18n/**',
    'packages/pod-protocol/**',
    'packages/storage/**',
    'packages/ui-tokens/**',
    ...WORKSPACE_FILES,
  ],
  web: [
    'apps/web/**',
    'packages/charts/**',
    'packages/config/**',
    'packages/contracts/**',
    'packages/domain/**',
    'packages/i18n/**',
    'packages/ui-tokens/**',
    ...WORKSPACE_FILES,
  ],
} as const satisfies Record<'api' | 'worker' | 'web', readonly string[]>;

/** `${{service.VARIABLE}}`, or `${{VARIABLE}}` of the same service: resolved by Railway at deploy time. */
export function railwayVariable(variable: string, serviceName?: string): string {
  return serviceName === undefined ? `\${{${variable}}}` : `\${{${serviceName}.${variable}}}`;
}

/** Public https origin of a service: its custom domain, or the one Railway generated. */
export function publicOrigin(serviceName: string, customDomain: string | null): string {
  return `https://${customDomain ?? railwayVariable('RAILWAY_PUBLIC_DOMAIN', serviceName)}`;
}

/** Origin of a service on the private network of the environment (plain http: it never leaves the project). */
export function privateOrigin(serviceName: string): string {
  return `http://${railwayVariable('RAILWAY_PRIVATE_DOMAIN', serviceName)}:${String(HTTP_PORT)}`;
}

/** URL of a login on the project's Postgres over the private network; its password is a secret variable of the same service. */
function databaseUrl(login: string, passwordVariable: string): string {
  const host = railwayVariable('PGHOST', 'Postgres');
  const port = railwayVariable('PGPORT', 'Postgres');
  const name = railwayVariable('PGDATABASE', 'Postgres');
  return `postgresql://${login}:${railwayVariable(passwordVariable)}@${host}:${port}/${name}`;
}

function dockerBuild(app: keyof typeof WATCH_PATTERNS): BuildConfig {
  return {
    builder: 'DOCKERFILE',
    dockerfilePath: `apps/${app}/Dockerfile`,
    watchPatterns: [...WATCH_PATTERNS[app]],
  };
}

/** Restarted on a crash (not on a clean exit), a few times before Railway gives up and alerts. */
const RESTART: DeployConfig = { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 };

export default defineRailway((ctx) => {
  const environment = ENVIRONMENTS.find((name) => ctx.isEnvironment(name));
  if (environment === undefined) {
    throw new Error(
      `Unknown environment "${ctx.environment ?? ''}": use ${ENVIRONMENTS.join(' or ')}.`,
    );
  }
  const production = environment === 'production';
  const domains = CUSTOM_DOMAINS[environment];
  const apiOrigin = publicOrigin('api', domains.api);
  const webOrigin = publicOrigin('web', domains.web);
  const source = github(REPOSITORY, { branch: DEPLOY_BRANCH[environment], checkSuites: true });
  // Without a custom domain the service keeps the domain Railway generated (not managed here).
  const domainsOf = (domain: string | null) =>
    domain === null ? {} : { domains: [{ domain, port: HTTP_PORT }] };

  const postgres = database('Postgres', 'postgres', {
    image: POSTGRES_IMAGE,
    output: 'DATABASE_URL',
    defaultMountPath: '/var/lib/postgresql/data',
    region: REGION,
  });

  const files = bucket('files', { region: BUCKET_REGION });
  const storage: Record<string, VariableValue | string> = {
    STORAGE_ENDPOINT: ref(files, 'ENDPOINT'),
    STORAGE_REGION: ref(files, 'REGION'),
    STORAGE_BUCKET: ref(files, 'BUCKET'),
    STORAGE_ACCESS_KEY_ID: ref(files, 'ACCESS_KEY_ID'),
    STORAGE_SECRET_ACCESS_KEY: ref(files, 'SECRET_ACCESS_KEY'),
    STORAGE_FORCE_PATH_STYLE: 'false',
  };

  const worker = service('worker', {
    source,
    build: dockerBuild('worker'),
    // pg-boss coordinates several workers, but one is enough for a few clubs and keeps the
    // per-club concurrency (WORKER_CLUB_CONCURRENCY) the actual limit on the database.
    replicas: { [REGION]: 1 },
    // Above SHUTDOWN_TIMEOUT_MS (30 s): the jobs in progress finish before SIGKILL.
    deploy: { ...RESTART, drainingSeconds: 40 },
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl(DATABASE_LOGINS.worker, 'DB_WORKER_PASSWORD'),
      DB_WORKER_PASSWORD: preserve(),
      ...storage,
      NOTIFICATIONS: 'on',
      RESEND_API_KEY: railwayVariable('RESEND_API_KEY', 'api'),
      EMAIL_FROM: railwayVariable('EMAIL_FROM', 'api'),
      WEB_APP_URL: webOrigin,
      EXPO_ACCESS_TOKEN: preserve(),
      SENTRY_DSN: preserve(),
      // The clubs' master keys of the pods (B-916, ADR 0108): set per environment, never here.
      POD_MASTER_KEYS: preserve(),
      ...(production ? {} : { DEMO_NOTIFICATION_EMAIL_DOMAINS: preserve() }),
    },
  });

  const api = service('api', {
    source,
    build: dockerBuild('api'),
    // Migrations and logins before the new version takes traffic; a failure stops the deploy.
    preDeploy: RELEASE_COMMAND,
    healthcheck: '/health/ready',
    healthcheckTimeout: 120,
    replicas: { [REGION]: production ? 2 : 1 },
    // Above SHUTDOWN_TIMEOUT_MS (10 s): requests in flight end before SIGKILL.
    deploy: { ...RESTART, drainingSeconds: 15 },
    ...domainsOf(domains.api),
    env: {
      NODE_ENV: 'production',
      // `::` listens on IPv4 and IPv6 (Railway's private network is IPv6).
      HOST: '::',
      PORT: String(HTTP_PORT),
      LOG_LEVEL: 'info',
      // One proxy in front of the API (ADR 0031): Railway's edge, on its own domain and under
      // the web (whose Caddy passes the edge's X-Forwarded-For through untouched).
      TRUST_PROXY_HOPS: '1',
      DATABASE_URL: databaseUrl(DATABASE_LOGINS.app, 'DB_APP_PASSWORD'),
      AUTH_DATABASE_URL: databaseUrl(DATABASE_LOGINS.auth, 'DB_AUTH_PASSWORD'),
      DB_APP_PASSWORD: preserve(),
      DB_AUTH_PASSWORD: preserve(),
      // Only for `db:release` (pre-deploy): the image's command removes both from the API
      // process, which refuses to start with them (ADR 0090).
      MIGRATIONS_DATABASE_URL: postgres.env.DATABASE_URL,
      WORKER_DATABASE_URL: worker.env.DATABASE_URL,
      AUTH_SECRET: preserve(),
      AUTH_BASE_URL: apiOrigin,
      WEB_ORIGINS: webOrigin,
      WEB_APP_URL: webOrigin,
      APP_DEEP_LINK_SCHEME: APP_DEEP_LINK_SCHEME[environment],
      ...storage,
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      SENTRY_DSN: preserve(),
      // Operated from the dashboard when a new app version ships (ADR 0045).
      APP_MIN_VERSION_IOS: preserve(),
      APP_MIN_VERSION_ANDROID: preserve(),
      APP_LATEST_VERSION_IOS: preserve(),
      APP_LATEST_VERSION_ANDROID: preserve(),
      APP_STORE_URL_IOS: preserve(),
      APP_STORE_URL_ANDROID: preserve(),
      // The key that signs the pods' commands (B-916, ADR 0108): P-256, one per environment.
      POD_COMMAND_SIGNING_KEY: preserve(),
      POD_COMMAND_SIGNING_KEY_ID: preserve(),
    },
  });

  const web = service('web', {
    source,
    build: dockerBuild('web'),
    healthcheck: '/healthz',
    healthcheckTimeout: 60,
    replicas: { [REGION]: 1 },
    deploy: { ...RESTART, drainingSeconds: 10 },
    ...domainsOf(domains.web),
    env: {
      PORT: String(HTTP_PORT),
      // The staff web reaches the API under its own origin (same site for the Lax session
      // cookie, ADR 0090): the bundle calls the web, and Caddy proxies /v1/* to the API over the
      // private network.
      VITE_API_URL: webOrigin,
      API_UPSTREAM: privateOrigin('api'),
      // Not secret: the CSP needs the origin of the bucket's signed URLs (ADR 0063).
      STORAGE_ENDPOINT: ref(files, 'ENDPOINT'),
      STORAGE_BUCKET: ref(files, 'BUCKET'),
      STORAGE_FORCE_PATH_STYLE: 'false',
    },
  });

  return project(PROJECT_NAME, {
    environments: [...ENVIRONMENTS],
    resources: [postgres, files, api, worker, web],
  });
});
