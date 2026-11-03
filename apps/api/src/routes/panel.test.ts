import { ROLES, ruleFor } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { PANEL_KINDS } from './panel.js';

/**
 * The weekly panel turns the matrix's list scopes into one SQL filter and has no per-row check
 * of consents or conditions: `scopeCondition` refuses such a scope with a 500. These tests pin
 * the cells it reads, so a change to the matrix fails here instead of in a request.
 */
describe('weekly panel cells of the matrix', () => {
  const rules = (role: (typeof ROLES)[number]) =>
    PANEL_KINDS.map(([kind, action]) => ruleFor(kind, action, role));

  it('a role that reaches the panel gets every cell without consents or conditions', () => {
    for (const role of ROLES) {
      const cells = rules(role);
      // A single denial answers 403 before any condition is built.
      if (cells.some((rule) => rule.effect === 'deny')) continue;
      for (const rule of cells) {
        if (rule.effect !== 'allow') continue;
        expect({ role, consents: rule.consents, conditions: rule.conditions }).toEqual({
          role,
          consents: [],
          conditions: [],
        });
        // Guardianships can need a row check (majority); the panel never reads them.
        expect(['club', 'assigned', 'platform']).toContain(rule.scope);
      }
    }
  });

  it('only the staff reaches the panel', () => {
    const reaching = ROLES.filter((role) => rules(role).every((rule) => rule.effect === 'allow'));
    expect(reaching).toEqual(['coach', 'sc', 'medical', 'admin', 'superadmin']);
  });
});
