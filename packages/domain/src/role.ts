import { memberGuard, memberParser } from './enum.js';

/**
 * Roles a user can hold in a club through a membership (ADR 0007), plus
 * `superadmin`, which is global and only acts by fixing the context of the
 * club it supports (ADR 0006). The value travels to Postgres as `app.role`
 * and row-level policies branch on it, so a value is never renamed.
 */
export const ROLES = ['player', 'parent', 'coach', 'sc', 'medical', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = memberGuard(ROLES);
export const parseRole = memberParser(ROLES, 'invalid_role', 'role');
