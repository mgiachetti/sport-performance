import { describe, expect, it } from 'vitest';
import { typographicMinus } from './minus';

describe('typographicMinus', () => {
  it('turns the hyphen of a negative figure into U+2212', () => {
    expect(typographicMinus('-1,2 años')).toBe('−1,2 años');
    expect(typographicMinus('(z -2,2) · umbral -1,5')).toBe('(z −2,2) · umbral −1,5');
  });

  it('leaves hyphens that are not a minus sign', () => {
    expect(typographicMinus('M-15 · 20-40 m · e-mail')).toBe('M-15 · 20-40 m · e-mail');
    expect(typographicMinus('+3,2')).toBe('+3,2');
  });
});
