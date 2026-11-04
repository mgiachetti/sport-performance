/**
 * Checks of the Railway project as code (B-701, ADR 0090) that need no
 * Railway account: the graph `railway config plan` would diff, evaluated for
 * each environment, against the repository it deploys.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  createRailwayContext,
  project,
  type ResourceNode,
  type ServiceNode,
  type VariableValue,
} from 'railway/iac';
import { describe, expect, it } from 'vitest';
import program, {
  APP_DEEP_LINK_SCHEME,
  BUCKET_REGION,
  CUSTOM_DOMAINS,
  DATABASE_LOGINS,
  DEPLOY_BRANCH,
  ENVIRONMENTS,
  HTTP_PORT,
  POSTGRES_IMAGE,
  REGION,
  RELEASE_COMMAND,
  REPOSITORY,
  WATCH_PATTERNS,
  privateOrigin,
  publicOrigin,
  railwayVariable,
  type EnvironmentName,
} from '../railway.js';

const repoRoot = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, repoRoot), 'utf8');
const exists = (rel: string): boolean => existsSync(new URL(rel, repoRoot));

type App = keyof typeof WATCH_PATTERNS;
const APPS = Object.keys(WATCH_PATTERNS) as App[];

async function resourcesOf(environment: string): Promise<ResourceNode[]> {
  const definition = await program(createRailwayContext({ environment }), project);
  return (definition.resources ?? []).flat();
}

function serviceOf(resources: ResourceNode[], name: string): ServiceNode {
  const node = resources.find((r) => r.name === name);
  if (node?.type !== 'service') throw new Error(`No service ${name}`);
  return node;
}

function variablesOf(node: ServiceNode): Record<string, VariableValue> {
  return node.variables ?? {};
}

function literal(value: VariableValue | undefined): string {
  if (value?.type !== 'literal' || typeof value.value !== 'string') {
    throw new Error(`Not a literal: ${JSON.stringify(value)}`);
  }
  return value.value;
}

/** `name` → directory of every workspace package. */
function workspacePackages(): Map<string, string> {
  const map = new Map<string, string>();
  for (const parent of ['apps', 'packages']) {
    for (const dir of readdirSync(new URL(`${parent}/`, repoRoot))) {
      const rel = `${parent}/${dir}/package.json`;
      if (!exists(rel)) continue;
      const pkg = JSON.parse(read(rel)) as { name: string };
      map.set(pkg.name, `${parent}/${dir}`);
    }
  }
  return map;
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
}

/** The app and every workspace package it ships with (production dependencies, transitively). */
function shippedDirectories(app: App): string[] {
  const packages = workspacePackages();
  const seen = new Set<string>();
  const visit = (dir: string) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = JSON.parse(read(`${dir}/package.json`)) as PackageJson;
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const dep = packages.get(name);
      if (dep !== undefined) visit(dep);
    }
  };
  visit(`apps/${app}`);
  // Compiler settings of every package (tsconfig): a dev dependency that changes the build.
  seen.add('packages/config');
  return [...seen].sort();
}

/** Variables documented in an `.env.example` (commented or not). */
function exampleVariables(rel: string): Set<string> {
  const names = read(rel)
    .split('\n')
    .map((line) => /^#?\s?([A-Z][A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  return new Set(names);
}

/** Composition variables: they only exist in Railway, to build the URLs of other variables. */
const COMPOSITION_VARIABLES = new Set([
  'DB_APP_PASSWORD',
  'DB_AUTH_PASSWORD',
  'DB_WORKER_PASSWORD',
]);

const SECRET_NAME = /PASSWORD|SECRET|_KEY|TOKEN|DSN/;
/** A literal made only of `${{...}}` references and fixed text, never of a value. */
const REFERENCE = /\$\{\{[A-Za-z0-9_.]+\}\}/g;

describe.each(ENVIRONMENTS)('the %s environment', (environment: EnvironmentName) => {
  it('has the five resources of the project', async () => {
    const resources = await resourcesOf(environment);
    expect(resources.map((r) => `${r.type}.${r.name}`).sort()).toEqual([
      'bucket.files',
      'database.Postgres',
      'service.api',
      'service.web',
      'service.worker',
    ]);
  });

  it('runs PostgreSQL 16 and the bucket in the US East region', async () => {
    const resources = await resourcesOf(environment);
    const postgres = resources.find((r) => r.name === 'Postgres');
    expect(postgres).toMatchObject({ engine: 'postgres', image: POSTGRES_IMAGE });
    expect(POSTGRES_IMAGE).toMatch(/:16\.\d+$/);
    expect(postgres).toMatchObject({
      deploy: { multiRegionConfig: { [REGION]: { numReplicas: 1 } } },
    });
    expect(resources.find((r) => r.name === 'files')).toMatchObject({
      config: { region: BUCKET_REGION },
    });
  });

  it.each(APPS)(
    'deploys %s from its branch after GitHub checks, with its Dockerfile',
    async (app) => {
      const node = serviceOf(await resourcesOf(environment), app);
      expect(node.source).toEqual({
        type: 'github',
        repo: REPOSITORY,
        branch: DEPLOY_BRANCH[environment],
        checkSuites: true,
      });
      expect(node.build).toMatchObject({
        builder: 'DOCKERFILE',
        dockerfilePath: `apps/${app}/Dockerfile`,
      });
      expect(exists(`apps/${app}/Dockerfile`)).toBe(true);
      expect(node.deploy).toMatchObject({ restartPolicyType: 'ON_FAILURE' });
    },
  );

  it.each(APPS)('redeploys %s on changes to what it ships, and nothing else', async (app) => {
    const node = serviceOf(await resourcesOf(environment), app);
    const patterns = node.build?.watchPatterns ?? [];
    const directories = patterns
      .filter((p) => p.endsWith('/**') && /^(apps|packages)\//.test(p))
      .map((p) => p.slice(0, -3))
      .sort();
    expect(directories).toEqual(shippedDirectories(app));
    for (const file of ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.dockerignore']) {
      expect(patterns).toContain(file);
    }
  });

  it('migrates and provisions the logins before the API takes traffic', async () => {
    const api = serviceOf(await resourcesOf(environment), 'api');
    expect(api.deploy?.preDeployCommand).toEqual([RELEASE_COMMAND]);
    const bin = (JSON.parse(read('packages/db/package.json')) as { bin: Record<string, string> })
      .bin;
    expect(RELEASE_COMMAND).toBe(
      `node /app/node_modules/@sport-performance/db/${bin['sport-performance-db-release']?.replace('./', '') ?? ''}`,
    );
    expect(api.deploy?.healthcheckPath).toBe('/health/ready');
    expect(read('apps/api/src/routes/health.ts')).toContain("'/health/ready'");
  });

  it('connects each service with the login of its role, never the owner', async () => {
    const resources = await resourcesOf(environment);
    const api = variablesOf(serviceOf(resources, 'api'));
    const worker = variablesOf(serviceOf(resources, 'worker'));
    const host = `@${railwayVariable('PGHOST', 'Postgres')}:${railwayVariable('PGPORT', 'Postgres')}/${railwayVariable('PGDATABASE', 'Postgres')}`;
    expect(literal(api.DATABASE_URL)).toBe(
      `postgresql://${DATABASE_LOGINS.app}:${railwayVariable('DB_APP_PASSWORD')}${host}`,
    );
    expect(literal(api.AUTH_DATABASE_URL)).toBe(
      `postgresql://${DATABASE_LOGINS.auth}:${railwayVariable('DB_AUTH_PASSWORD')}${host}`,
    );
    expect(literal(worker.DATABASE_URL)).toBe(
      `postgresql://${DATABASE_LOGINS.worker}:${railwayVariable('DB_WORKER_PASSWORD')}${host}`,
    );
    expect(new Set(Object.values(DATABASE_LOGINS)).size).toBe(3);
    expect(api.MIGRATIONS_DATABASE_URL).toEqual({
      type: 'reference',
      resource: 'database.Postgres',
      output: 'DATABASE_URL',
    });
    expect(api.WORKER_DATABASE_URL).toEqual({
      type: 'reference',
      resource: 'service.worker',
      output: 'DATABASE_URL',
    });
    expect(worker.MIGRATIONS_DATABASE_URL).toBeUndefined();
  });

  it('keeps every secret out of the repository', async () => {
    for (const node of (await resourcesOf(environment)).filter((r) => r.type === 'service')) {
      for (const [name, value] of Object.entries(variablesOf(node))) {
        if (value.type === 'literal') {
          const text = typeof value.value === 'string' ? value.value : '';
          const rest = text.replace(REFERENCE, '');
          // No long random-looking run (keys, tokens, passwords) outside references.
          const randomLooking = (rest.match(/[A-Za-z0-9+/_]{20,}/g) ?? []).filter((run) =>
            /\d/.test(run),
          );
          expect(randomLooking, `${node.name}.${name}`).toEqual([]);
          if (SECRET_NAME.test(name)) {
            expect(rest, `${node.name}.${name} must be a reference`).toBe('');
          }
        } else {
          expect(['preserve', 'reference', 'sharedReference'], `${node.name}.${name}`).toContain(
            value.type,
          );
        }
      }
    }
  });

  it('runs every service in production mode behind one proxy', async () => {
    const resources = await resourcesOf(environment);
    const api = variablesOf(serviceOf(resources, 'api'));
    expect(literal(api.NODE_ENV)).toBe('production');
    expect(literal(variablesOf(serviceOf(resources, 'worker')).NODE_ENV)).toBe('production');
    expect(literal(api.TRUST_PROXY_HOPS)).toBe('1');
    expect(literal(api.APP_DEEP_LINK_SCHEME)).toBe(APP_DEEP_LINK_SCHEME[environment]);
  });

  it('points the API, the web and the worker at each other', async () => {
    const resources = await resourcesOf(environment);
    const api = variablesOf(serviceOf(resources, 'api'));
    const web = variablesOf(serviceOf(resources, 'web'));
    const worker = variablesOf(serviceOf(resources, 'worker'));
    const apiOrigin = publicOrigin('api', CUSTOM_DOMAINS[environment].api);
    const webOrigin = publicOrigin('web', CUSTOM_DOMAINS[environment].web);
    expect(literal(api.AUTH_BASE_URL)).toBe(apiOrigin);
    // The staff web calls the API under its own origin; Caddy proxies it over the private network.
    expect(literal(web.VITE_API_URL)).toBe(webOrigin);
    expect(literal(web.API_UPSTREAM)).toBe(privateOrigin('api'));
    expect(literal(api.WEB_ORIGINS)).toBe(webOrigin);
    expect(literal(api.WEB_APP_URL)).toBe(webOrigin);
    expect(literal(worker.WEB_APP_URL)).toBe(webOrigin);
  });

  it('gives the API, the worker and the web the same bucket', async () => {
    const resources = await resourcesOf(environment);
    for (const name of ['api', 'worker', 'web']) {
      const variables = variablesOf(serviceOf(resources, name));
      expect(variables.STORAGE_ENDPOINT).toEqual({
        type: 'reference',
        resource: 'bucket.files',
        output: 'ENDPOINT',
      });
      expect(variables.STORAGE_BUCKET).toEqual({
        type: 'reference',
        resource: 'bucket.files',
        output: 'BUCKET',
      });
      expect(literal(variables.STORAGE_FORCE_PATH_STYLE)).toBe('false');
    }
    // The web only gets what its CSP needs: no keys.
    const web = variablesOf(serviceOf(resources, 'web'));
    expect(web.STORAGE_ACCESS_KEY_ID).toBeUndefined();
    expect(web.STORAGE_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('declares only the custom domains of CUSTOM_DOMAINS, on the HTTP port', async () => {
    const resources = await resourcesOf(environment);
    for (const name of ['api', 'web'] as const) {
      const node = serviceOf(resources, name);
      const domain = CUSTOM_DOMAINS[environment][name];
      expect(node.networking?.customDomains).toEqual(
        domain === null ? undefined : { [domain]: { port: HTTP_PORT } },
      );
      expect(literal(variablesOf(node).PORT)).toBe(String(HTTP_PORT));
      expect(read(`apps/${name}/Dockerfile`)).toContain(`EXPOSE ${String(HTTP_PORT)}`);
    }
    expect(serviceOf(resources, 'worker').networking).toBeUndefined();
  });

  it('drains each service for longer than its shutdown timeout', async () => {
    const resources = await resourcesOf(environment);
    for (const name of ['api', 'worker'] as const) {
      const example = read(`apps/${name}/.env.example`);
      const timeoutMs = Number(/^SHUTDOWN_TIMEOUT_MS=(\d+)$/m.exec(example)?.[1]);
      expect(timeoutMs).toBeGreaterThan(0);
      expect(serviceOf(resources, name).deploy?.drainingSeconds ?? 0).toBeGreaterThan(
        timeoutMs / 1000,
      );
    }
  });

  it('documents every variable it sets, in the app and in the catalog', async () => {
    const catalog = read('docs/infra/variables.md');
    for (const app of APPS) {
      const documented = exampleVariables(`apps/${app}/.env.example`);
      for (const name of Object.keys(variablesOf(serviceOf(await resourcesOf(environment), app)))) {
        expect(catalog, `${app}.${name} in docs/infra/variables.md`).toContain(`\`${name}\``);
        if (!COMPOSITION_VARIABLES.has(name)) {
          expect(documented.has(name), `${app}.${name} in apps/${app}/.env.example`).toBe(true);
        }
      }
    }
  });
});

describe('environments', () => {
  it('scales the API to two replicas in production only', async () => {
    const replicas = async (environment: string) =>
      serviceOf(await resourcesOf(environment), 'api').deploy?.multiRegionConfig?.[REGION]
        ?.numReplicas;
    expect(await replicas('production')).toBe(2);
    expect(await replicas('staging')).toBe(1);
  });

  it('refuses an environment it does not describe', async () => {
    await expect(resourcesOf('pr-123')).rejects.toThrow(/Unknown environment/);
  });

  it('matches the deep link schemes of the mobile variants', () => {
    const variants = read('apps/mobile/src/config/variants.ts');
    const base = /BASE_SCHEME = '([a-z0-9+.-]+)'/.exec(variants)?.[1];
    expect(APP_DEEP_LINK_SCHEME.production).toBe(base);
    expect(variants).toContain('scheme: `${BASE_SCHEME}-staging`');
    expect(APP_DEEP_LINK_SCHEME.staging).toBe(`${base ?? ''}-staging`);
  });
});

describe('helpers', () => {
  it('writes Railway references', () => {
    expect(railwayVariable('PGHOST', 'Postgres')).toBe('${{Postgres.PGHOST}}');
    expect(railwayVariable('DB_APP_PASSWORD')).toBe('${{DB_APP_PASSWORD}}');
  });

  it('uses the custom domain when there is one, else the generated one', () => {
    expect(publicOrigin('api', 'api.example.org')).toBe('https://api.example.org');
    expect(publicOrigin('api', null)).toBe('https://${{api.RAILWAY_PUBLIC_DOMAIN}}');
  });

  it('reaches a service on the private network, on the HTTP port', () => {
    expect(privateOrigin('api')).toBe('http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080');
  });
});

describe('images', () => {
  it.each(APPS)('%s builds only its own package and what it ships with', (app) => {
    const dockerfile = read(`apps/${app}/Dockerfile`);
    expect(dockerfile).toContain(`--filter-prod "@sport-performance/${app}..."`);
    // Base images pinned by digest (Dependabot updates them).
    for (const from of dockerfile.match(/^FROM .+$/gm) ?? []) {
      expect(from).toMatch(/@sha256:[0-9a-f]{64}/);
    }
  });

  it('keeps the release logins out of the API process', () => {
    const dockerfile = read('apps/api/Dockerfile');
    expect(dockerfile).toMatch(
      /"env", "-u", "MIGRATIONS_DATABASE_URL", "-u", "WORKER_DATABASE_URL"/,
    );
  });

  it('serves the web with its healthcheck and security headers', () => {
    const caddyfile = read('apps/web/deploy/Caddyfile');
    expect(caddyfile).toContain('handle /healthz');
    for (const header of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(caddyfile).toContain(header);
    }
    expect(caddyfile).toContain("frame-ancestors 'none'");
    // The API is under the same origin: only the bucket is another one.
    expect(caddyfile).toContain("connect-src 'self' {$FILES_ORIGIN};");
    expect(caddyfile).not.toContain('API_ORIGIN');
    expect(caddyfile).toMatch(/handle \/v1\/\* \{[^}]*reverse_proxy \{\$API_UPSTREAM\}/);
    // The web's headers are not stamped on the API's answers.
    expect(caddyfile).toContain('@web not path /v1/*');
    expect(caddyfile).toContain('header @web {');
  });
});
