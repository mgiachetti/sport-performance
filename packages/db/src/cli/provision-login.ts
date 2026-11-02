#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:provision-login` (or the
 * `sport-performance-db-provision-login` bin): creates or updates a login as
 * a member of one connection role (ADR 0026). Connects as the owner with
 * `MIGRATIONS_DATABASE_URL` (or `DATABASE_URL`), after the migrations ran.
 *
 *   DB_LOGIN_ROLE=app|worker|auth   which connection role the login gets
 *   DB_LOGIN_NAME=sp_api            the login to create or update
 *   DB_LOGIN_PASSWORD=...           its new password (16+ printable ASCII chars)
 *
 * Never prints the password or the connection string.
 */
import { migrationsConnectionString } from '../migrate.js';
import { DATABASE_ROLE_KINDS, isDatabaseRoleKind, provisionLoginRole } from '../roles.js';

try {
  const role = process.env.DB_LOGIN_ROLE;
  const login = process.env.DB_LOGIN_NAME;
  const password = process.env.DB_LOGIN_PASSWORD;
  if (!isDatabaseRoleKind(role)) {
    throw new Error(`Set DB_LOGIN_ROLE to one of: ${DATABASE_ROLE_KINDS.join(', ')}.`);
  }
  if (login === undefined || login === '') throw new Error('Set DB_LOGIN_NAME.');
  if (password === undefined || password === '') throw new Error('Set DB_LOGIN_PASSWORD.');
  await provisionLoginRole({
    connectionString: migrationsConnectionString(),
    login,
    password,
    role,
  });
  process.stdout.write(`Login ${login} provisioned as the ${role} role.\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Provisioning failed: ${message}\n`);
  process.exitCode = 1;
}
