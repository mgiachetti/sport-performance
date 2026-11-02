import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * Connection roles (ADR 0006, ADR 0026). Migration `0004_rls_and_roles`
 * creates them as `NOLOGIN` group roles with their grants and policies; the
 * real logins are created with {@link provisionLoginRole} as members of
 * exactly one of them, so the password never lives in a migration.
 *
 * - `app`: the API. Sees what the tenant context of the transaction allows.
 * - `worker`: the worker. The whole club of the job (`app.club_id`), no more.
 * - `auth`: Better Auth. Only `user`, `session`, `account` and `verification`.
 */
export const DATABASE_ROLES = {
  app: 'sport_performance_app',
  worker: 'sport_performance_worker',
  auth: 'sport_performance_auth',
} as const;

export type DatabaseRoleKind = keyof typeof DATABASE_ROLES;

export const DATABASE_ROLE_KINDS = Object.keys(DATABASE_ROLES) as DatabaseRoleKind[];

export function isDatabaseRoleKind(value: unknown): value is DatabaseRoleKind {
  return typeof value === 'string' && Object.hasOwn(DATABASE_ROLES, value);
}

/**
 * Settings the policies read through `app.current_club_id()`,
 * `app.current_user_id()` and `app.current_role()`. The API sets them with
 * `set_config(name, value, true)` (`SET LOCAL`) at the start of every
 * transaction; `''` and unset both mean "no value".
 */
export const TENANT_SETTING_NAMES = {
  clubId: 'app.club_id',
  userId: 'app.user_id',
  role: 'app.role',
  /**
   * Id of the request (the one of its logs, ADR 0016), read by
   * `app.current_request_id()`. Medical access and the superadmin's support
   * access are refused without it (ADR 0029).
   */
  requestId: 'app.request_id',
} as const;

/** The connection is not a valid login for the expected role. Never contains secrets. */
export class DatabaseRoleError extends Error {
  override readonly name = 'DatabaseRoleError';
}

/** Postgres identifiers for logins: lowercase, no quoting needed, within the 63-byte limit. */
const LOGIN_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Printable ASCII: SASLprep is the identity on it, so the verifier below matches the server's. */
const PASSWORD = /^[\x21-\x7e]{16,256}$/;

const SCRAM_ITERATIONS = 4096;

/**
 * A SCRAM-SHA-256 verifier in Postgres' format. Sending the verifier instead
 * of the password keeps the plain password out of the server's statement log.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  if (!PASSWORD.test(password)) {
    throw new DatabaseRoleError('The password must be 16 to 256 printable ASCII characters.');
  }
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

export interface ProvisionLoginRoleOptions {
  /** Connection of the owner role (`MIGRATIONS_DATABASE_URL`). Never logged. */
  readonly connectionString: string;
  /** Login to create or update (`sp_api`, `sp_worker`, `sp_auth`). */
  readonly login: string;
  /** New password of the login. Never logged; only its SCRAM verifier reaches the server. */
  readonly password: string;
  readonly role: DatabaseRoleKind;
}

/**
 * Creates the login (or resets its password and attributes) as a member of
 * exactly one connection role. Refuses when the login is also a member of
 * another connection role: the union of two roles' policies (for example
 * `app` and `worker`) would defeat the per-role scoping. Idempotent.
 */
export async function provisionLoginRole(options: ProvisionLoginRoleOptions): Promise<void> {
  const { login, role } = options;
  if (!LOGIN_NAME.test(login)) {
    throw new DatabaseRoleError(`Invalid login name "${login}": use [a-z0-9_], up to 63 chars.`);
  }
  if ((Object.values(DATABASE_ROLES) as string[]).includes(login)) {
    throw new DatabaseRoleError('The login must not be one of the group roles themselves.');
  }
  const verifier = scramSha256Verifier(options.password);
  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: 'sport-performance-provision-login',
  });
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query('begin');
    const group = DATABASE_ROLES[role];
    const groups = await client.query<{ rolname: string }>(
      'select rolname from pg_roles where rolname = $1',
      [group],
    );
    if (groups.rowCount === 0) {
      throw new DatabaseRoleError(`Role ${group} does not exist: run the migrations first.`);
    }
    const existing = await client.query<{ member_of: string[] }>(
      `select coalesce(array_agg(g.rolname::text) filter (where g.rolname is not null), '{}') as member_of
         from pg_roles r
         left join pg_auth_members am on am.member = r.oid
         left join pg_roles g on g.oid = am.roleid
        where r.rolname = $1
        group by r.oid`,
      [login],
    );
    const attributes =
      'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT';
    const name = client.escapeIdentifier(login);
    const password = client.escapeLiteral(verifier);
    const row = existing.rows[0];
    if (row === undefined) {
      await client.query(`create role ${name} ${attributes} password ${password}`);
    } else {
      const others = row.member_of.filter((g) => g !== group);
      if (others.length > 0) {
        throw new DatabaseRoleError(
          `Login ${login} is also a member of ${others.join(', ')}: a login belongs to exactly one role.`,
        );
      }
      await client.query(`alter role ${name} ${attributes} password ${password}`);
    }
    await client.query(`grant ${client.escapeIdentifier(group)} to ${name}`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface RoleFacts {
  readonly current_user: string;
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly roles: string[];
  readonly owns_tables: boolean;
}

/**
 * Checks, at startup, that a connection is a proper login for `expected`: not
 * a superuser, no `BYPASSRLS`, `CREATEROLE` or `CREATEDB`, member of the
 * expected connection role and of no other, and not the owner of any table
 * (an owner could disable RLS). A process connected with the wrong
 * credentials must not start: with the owner's URL, RLS would silently not
 * apply.
 */
export async function assertConnectionRole(
  client: Pick<pg.Pool, 'query'> | Pick<pg.ClientBase, 'query'>,
  expected: DatabaseRoleKind,
): Promise<void> {
  const { rows } = await (client as pg.Pool).query<RoleFacts>(
    `select current_user,
            r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            array(select g.rolname::text from pg_roles g
                   where g.rolname = any($1::text[]) and pg_has_role(current_user, g.oid, 'MEMBER')) as roles,
            exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname not in ('pg_catalog', 'information_schema')
                       and c.relkind in ('r', 'p', 'v', 'm', 'f')
                       and pg_has_role(current_user, c.relowner, 'MEMBER')) as owns_tables
       from pg_roles r where r.rolname = current_user`,
    [Object.values(DATABASE_ROLES)],
  );
  const facts = rows[0];
  if (facts === undefined) throw new DatabaseRoleError('Could not read the connection role.');
  const problems: string[] = [];
  if (facts.rolsuper) problems.push('is a superuser');
  if (facts.rolbypassrls) problems.push('has BYPASSRLS');
  if (facts.rolcreaterole) problems.push('has CREATEROLE');
  if (facts.rolcreatedb) problems.push('has CREATEDB');
  if (facts.owns_tables) problems.push('owns tables');
  const group = DATABASE_ROLES[expected];
  if (!facts.roles.includes(group)) problems.push(`is not a member of ${group}`);
  const others = facts.roles.filter((r) => r !== group);
  if (others.length > 0) problems.push(`is also a member of ${others.join(', ')}`);
  if (problems.length > 0) {
    throw new DatabaseRoleError(
      `Database login "${facts.current_user}" cannot be used as the ${expected} role: it ${problems.join(', ')}. ` +
        'Create a login with `db:provision-login` (see packages/db/README.md).',
    );
  }
}
