import { describe, expect, it } from 'vitest';
import { derivedInputs } from './model.js';

describe('derivedInputs', () => {
  it('names the inputs sorted by code, whatever the order of the entries (issue #175)', () => {
    const expected = { kind: 'derived', from: ['cod505_left_s', 'cod505_right_s'] };
    expect(derivedInputs(['cod505_right_s', 'cod505_left_s'], 'cod505_asymmetry_pct')).toEqual(
      expected,
    );
    expect(derivedInputs(['cod505_left_s', 'cod505_right_s'], 'cod505_asymmetry_pct')).toEqual(
      expected,
    );
  });

  it('leaves out the derived metric itself and repeated codes', () => {
    expect(
      derivedInputs(
        ['rm1_kg', 'relative_strength_kg_kg', 'e1rm_kg', 'rm1_kg'],
        'relative_strength_kg_kg',
      ),
    ).toEqual({ kind: 'derived', from: ['e1rm_kg', 'rm1_kg'] });
  });
});
