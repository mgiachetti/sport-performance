import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first and last word of a name, or the local part of an email', () => {
    expect(initialsOf('Diego Ferrando')).toBe('DF');
    expect(initialsOf('Tomás  de la Bianchi')).toBe('TB');
    expect(initialsOf('lucía')).toBe('L');
    expect(initialsOf('demo.entrenador@example.com')).toBe('DE');
  });
});
