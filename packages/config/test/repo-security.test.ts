/**
 * Repository security policy (B-107, docs/security.md).
 *
 * These tests guard the GitHub configuration that lives in the repo:
 * workflow hardening, Dependabot, gitleaks and the `main` and `production` rulesets.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = Record<string, Json>;

const repoRoot = new URL('../../../', import.meta.url);
const readText = (rel: string): string => readFileSync(new URL(rel, repoRoot), 'utf8');
const readYaml = (rel: string): unknown => parse(readText(rel));

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObject = (value: unknown, what: string): JsonObject => {
  if (!isObject(value)) throw new Error(`${what} must be a mapping`);
  return value;
};

const asArray = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${what} must be a list`);
  return value;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const workflowFiles = readdirSync(new URL('.github/workflows/', repoRoot))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

interface Step {
  workflow: string;
  job: string;
  step: JsonObject;
}

const loadWorkflow = (name: string): JsonObject =>
  asObject(readYaml(`.github/workflows/${name}`), name);

const jobsOf = (name: string): [string, JsonObject][] =>
  Object.entries(asObject(loadWorkflow(name).jobs, `${name} jobs`)).map(([id, job]) => [
    id,
    asObject(job, `${name} job ${id}`),
  ]);

const allSteps: Step[] = workflowFiles.flatMap((workflow) =>
  jobsOf(workflow).flatMap(([job, body]) =>
    (body.steps === undefined ? [] : asArray(body.steps, `${workflow}/${job} steps`)).map(
      (step) => ({ workflow, job, step: asObject(step, `${workflow}/${job} step`) }),
    ),
  ),
);

/** Local composite actions (`.github/actions/<name>/action.yml`), if any. */
const compositeActions: string[] = existsSync(new URL('.github/actions/', repoRoot))
  ? readdirSync(new URL('.github/actions/', repoRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        ['action.yml', 'action.yaml']
          .map((file) => `.github/actions/${entry.name}/${file}`)
          .filter((rel) => existsSync(new URL(rel, repoRoot))),
      )
  : [];

const compositeUses = (rel: string): string[] => {
  const runs = asObject(asObject(readYaml(rel), rel).runs, `${rel} runs`);
  return (runs.steps === undefined ? [] : asArray(runs.steps, `${rel} steps`))
    .map((step) => asObject(step, `${rel} step`).uses)
    .filter((uses): uses is string => typeof uses === 'string');
};

/** Triggers of a workflow, whatever form `on:` uses (string, list or mapping). */
const triggersOf = (workflow: JsonObject): string[] => {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(asObject(on, 'on'));
};

const SHA_PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;

/** A `uses:` reference is safe if it is local, a digest-pinned image or a commit-pinned action. */
const isPinnedUses = (uses: string): boolean =>
  uses.startsWith('./') ||
  /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(uses) ||
  SHA_PINNED.test(uses);

const isReadOnlyPermissions = (permissions: unknown): boolean => {
  if (permissions === 'read-all') return true;
  if (!isObject(permissions)) return false;
  return Object.values(permissions).every((level) => level === 'read' || level === 'none');
};

describe('isPinnedUses', () => {
  it('accepts commit SHAs, local actions and digest-pinned images', () => {
    expect(isPinnedUses('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')).toBe(true);
    expect(isPinnedUses('github/codeql-action/init@9b3254085494b55a0f7c4c2b3d2d52cc712ce370')).toBe(
      true,
    );
    expect(isPinnedUses('./.github/actions/setup')).toBe(true);
    expect(isPinnedUses(`docker://alpine@sha256:${'a'.repeat(64)}`)).toBe(true);
  });

  it('rejects tags, branches, short SHAs and unpinned images', () => {
    expect(isPinnedUses('actions/checkout@v7')).toBe(false);
    expect(isPinnedUses('actions/checkout@main')).toBe(false);
    expect(isPinnedUses('actions/checkout@3d3c42e')).toBe(false);
    expect(isPinnedUses('docker://alpine:3')).toBe(false);
  });
});

describe('GitHub Actions workflows', () => {
  it('exist (security and CodeQL at least)', () => {
    expect(workflowFiles).toEqual(expect.arrayContaining(['codeql.yml', 'security.yml']));
  });

  it.each(workflowFiles)('%s declares read-only default permissions', (name) => {
    const workflow = loadWorkflow(name);
    expect(workflow).toHaveProperty('permissions');
    expect(isReadOnlyPermissions(workflow.permissions)).toBe(true);
  });

  it.each(workflowFiles)('%s does not use pull_request_target', (name) => {
    expect(triggersOf(loadWorkflow(name))).not.toContain('pull_request_target');
  });

  it.each(workflowFiles)('%s pins every action and reusable workflow to a commit SHA', (name) => {
    const references = [
      ...jobsOf(name).map(([, job]) => job.uses),
      ...allSteps.filter((s) => s.workflow === name).map((s) => s.step.uses),
    ].filter((uses): uses is string => typeof uses === 'string');
    expect(references.filter((uses) => !isPinnedUses(uses))).toEqual([]);
  });

  it.each(compositeActions)('%s pins every action to a commit SHA', (rel) => {
    expect(compositeUses(rel).filter((uses) => !isPinnedUses(uses))).toEqual([]);
  });

  it('never persists the GITHUB_TOKEN in checkouts', () => {
    const checkouts = allSteps.filter(
      ({ step }) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    );
    expect(checkouts.length).toBeGreaterThan(0);
    const leaky = checkouts
      .filter(({ step }) => !isObject(step.with) || step.with['persist-credentials'] !== false)
      .map(({ workflow, job }) => `${workflow}/${job}`);
    expect(leaky).toEqual([]);
  });
});

describe('security workflow', () => {
  const jobs = Object.fromEntries(jobsOf('security.yml'));

  it('runs on pull requests, pushes to main and on a schedule', () => {
    expect(triggersOf(loadWorkflow('security.yml'))).toEqual(
      expect.arrayContaining(['pull_request', 'push', 'schedule']),
    );
  });

  it('scans the history reachable from HEAD with a pinned, checksum-verified gitleaks', () => {
    const secrets = asObject(jobs.secrets, 'secrets job');
    const env = asObject(secrets.env, 'secrets env');
    expect(env.GITLEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.GITLEAKS_SHA256).toMatch(/^[0-9a-f]{64}$/);

    const steps = asArray(secrets.steps, 'secrets steps').map((s) => asObject(s, 'step'));
    const checkout = steps.find((s) => asString(s.uses).startsWith('actions/checkout@'));
    expect(asObject(checkout?.with, 'checkout with')['fetch-depth']).toBe(0);

    const script = steps.map((s) => (typeof s.run === 'string' ? s.run : '')).join('\n');
    expect(script).toContain('sha256sum --check');
    expect(script).toMatch(/gitleaks" git \./);
    expect(script).toContain('--config .gitleaks.toml');
    expect(script).toContain('--redact');
    // Scope: main + the PR's commits, never other branches (git log --all).
    expect(script).toContain('--log-opts="HEAD"');
  });

  it('audits dependencies for high and critical advisories', () => {
    const steps = asArray(asObject(jobs.audit, 'audit job').steps, 'audit steps');
    const runs = steps.map((s) => asObject(s, 'step').run).filter((r) => typeof r === 'string');
    expect(runs).toContain('pnpm audit --audit-level high');
  });
});

describe('CodeQL workflow', () => {
  const analyze = asObject(Object.fromEntries(jobsOf('codeql.yml')).analyze, 'analyze job');

  it('analyzes TypeScript and the workflows themselves', () => {
    const matrix = asObject(asObject(analyze.strategy, 'strategy').matrix, 'matrix');
    expect(matrix.language).toEqual(['javascript-typescript', 'actions']);
  });

  it('only runs where code scanning is available', () => {
    expect(analyze.if).toContain('!github.event.repository.private');
    expect(analyze.if).toContain("vars.CODE_SCANNING_ENABLED == 'true'");
  });

  it('only escalates to security-events: write at job level', () => {
    expect(analyze.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
  });
});

describe('Dependabot', () => {
  const config = asObject(readYaml('.github/dependabot.yml'), 'dependabot.yml');
  const updates = asArray(config.updates, 'updates').map((u) => asObject(u, 'update'));
  const byEcosystem = Object.fromEntries(updates.map((u) => [asString(u['package-ecosystem']), u]));

  it('updates the pnpm workspace and GitHub Actions from the repo root', () => {
    expect(config.version).toBe(2);
    expect(byEcosystem.npm?.directory).toBe('/');
    expect(byEcosystem['github-actions']?.directory).toBe('/');
  });

  it.each(updates.map((u) => [asString(u['package-ecosystem']), u] as const))(
    '%s has a weekly schedule, a cooldown, labels and a commit prefix',
    (_, update) => {
      expect(asObject(update.schedule, 'schedule').interval).toBe('weekly');
      expect(asObject(update.cooldown, 'cooldown')['default-days']).toBeGreaterThanOrEqual(3);
      expect(asArray(update.labels, 'labels').length).toBeGreaterThan(0);
      expect(asObject(update['commit-message'], 'commit-message').prefix).toMatch(/^chore\(/);
    },
  );

  it('keeps TypeScript below 6.1 while typescript-eslint requires it (ADR 0001)', () => {
    const configPackage = JSON.parse(readText('packages/config/package.json')) as {
      peerDependencies: Record<string, string>;
    };
    expect(configPackage.peerDependencies.typescript).toBe('~6.0.0');
    const ignores = asArray(byEcosystem.npm?.ignore, 'npm ignore').map((i) =>
      asObject(i, 'ignore'),
    );
    expect(ignores).toContainEqual({ 'dependency-name': 'typescript', versions: ['>=6.1.0'] });
  });
});

describe('gitleaks config', () => {
  const toml = readText('.gitleaks.toml');

  it('extends the default rule set', () => {
    expect(toml).toMatch(/\[extend\]\s*\n\s*useDefault\s*=\s*true/);
  });

  it('does not allowlist source directories', () => {
    expect(toml).not.toMatch(/(apps|packages)\//);
  });
});

describe('.gitignore', () => {
  const ignored = readText('.gitignore').split('\n');

  it.each([
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.keystore',
    '*.jks',
    '*.mobileprovision',
  ])('ignores %s', (pattern) => {
    expect(ignored).toContain(pattern);
  });

  it('still allows .env.example', () => {
    expect(ignored).toContain('!.env.example');
  });
});

describe('main ruleset', () => {
  const ruleset = asObject(
    JSON.parse(readText('.github/rulesets/main.json')) as unknown,
    'ruleset',
  );
  const rules = asArray(ruleset.rules, 'rules').map((r) => asObject(r, 'rule'));
  const rule = (type: string): JsonObject | undefined => rules.find((r) => r.type === type);

  it('targets the default branch and is enforced with no bypass', () => {
    expect(ruleset).toMatchObject({
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
      bypass_actors: [],
    });
  });

  it('blocks force pushes and deletion and keeps history linear', () => {
    expect(rule('non_fast_forward')).toBeDefined();
    expect(rule('deletion')).toBeDefined();
    expect(rule('required_linear_history')).toBeDefined();
  });

  it('requires a squash-merged PR but no human approvals or code owners (single maintainer)', () => {
    expect(rule('pull_request')?.parameters).toMatchObject({
      required_approving_review_count: 0,
      require_code_owner_review: false,
      allowed_merge_methods: ['squash'],
    });
  });

  it('only requires status checks that exist (ci, once its workflow is on main)', () => {
    const checks = rule('required_status_checks');
    if (checks === undefined) return;
    const contexts = asArray(
      asObject(checks.parameters, 'parameters').required_status_checks,
      'checks',
    ).map((c) => asObject(c, 'check').context);
    expect(contexts).toEqual(['ci']);
    expect(workflowFiles).toContain('ci.yml');
  });
});

describe('production ruleset (B-701, ADR 0087)', () => {
  const ruleset = asObject(
    JSON.parse(readText('.github/rulesets/production.json')) as unknown,
    'ruleset',
  );
  const rules = asArray(ruleset.rules, 'rules').map((r) => asObject(r, 'rule'));
  const rule = (type: string): JsonObject | undefined => rules.find((r) => r.type === type);

  it('targets only the production branch, enforced, bypassed only by the deploy key', () => {
    expect(ruleset).toMatchObject({
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/production'], exclude: [] } },
      bypass_actors: [{ actor_id: null, actor_type: 'DeployKey', bypass_mode: 'always' }],
    });
  });

  it('lets nobody else create or update the branch (write access is not enough)', () => {
    expect(rule('creation')).toBeDefined();
    expect(rule('update')?.parameters).toEqual({ update_allows_fetch_and_merge: false });
  });

  it('only lets production move forward, never be deleted', () => {
    expect(rule('non_fast_forward')).toBeDefined();
    expect(rule('deletion')).toBeDefined();
  });

  it('requires ci on the commit, also when the branch is created', () => {
    expect(rule('required_status_checks')?.parameters).toEqual({
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: 'ci' }],
    });
    expect(workflowFiles).toContain('ci.yml');
  });

  it('is moved only by the promote workflow of main', () => {
    const workflow = asObject(readYaml('.github/workflows/promote.yml'), 'workflow');
    const job = asObject(asObject(workflow.jobs, 'jobs').promote, 'promote job');
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(job.environment).toBe('production');
    // The GITHUB_TOKEN only reads; the push uses the deploy key, a secret of that environment.
    expect(job.permissions).toEqual({ contents: 'read', checks: 'read' });
    const steps = asArray(job.steps, 'promote steps').map((s) => asObject(s, 'step'));
    const key = steps.find((s) => s.name === 'Load the deploy key');
    expect(key?.env).toEqual({ DEPLOY_KEY: '${{ secrets.PRODUCTION_DEPLOY_KEY }}' });
    // GitHub's host key is pinned, not trusted on first use.
    expect(key?.run).toContain('github.com ssh-ed25519 ');
    const move = steps.find((s) => s.name === 'Move the production branch');
    expect(move?.run).toContain('StrictHostKeyChecking=yes');
  });
});
