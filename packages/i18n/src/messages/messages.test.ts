import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../locale.js';
import { esAR } from './es-AR.js';
import { catalogs, isMessageKey, messageKeys } from './index.js';
import { extractArguments, validateCatalog } from './validate.js';

describe('es-AR source catalog', () => {
  it('is valid against itself', () => {
    expect(validateCatalog(esAR)).toEqual([]);
  });

  it('uses flat namespaced keys', () => {
    for (const key of messageKeys) {
      expect(key, key).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z0-9_]+)+$/);
    }
  });

  it('has no surrounding whitespace and uses a real ellipsis', () => {
    for (const [key, message] of Object.entries(esAR)) {
      expect(message, key).toBe(message.trim());
      expect(message, key).not.toContain('...');
    }
  });

  it('speaks Rioplatense Spanish (vos), not tú or usted', () => {
    const forbidden =
      /\b(puedes|tienes|quieres|debes|eres|intenta|revisa|ingresa|vuelve|elige|ingrese|intente|revise|seleccione|haga|usted)\b/i;
    for (const [key, message] of Object.entries(esAR)) {
      expect(message, key).not.toMatch(forbidden);
    }
  });

  it('labels every status with text', () => {
    expect(esAR['status.ok']).toBe('Bien');
    expect(esAR['status.warning']).toBe('Atención');
    expect(esAR['status.critical']).toBe('Crítico');
  });
});

describe('bundled catalogs', () => {
  it('exist for every supported locale and are valid', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(validateCatalog(catalogs[locale]), locale).toEqual([]);
    }
  });
});

describe('isMessageKey', () => {
  it('only accepts own keys', () => {
    expect(isMessageKey('common.save')).toBe(true);
    expect(isMessageKey('common.nope')).toBe(false);
    expect(isMessageKey('toString')).toBe(false);
  });
});

describe('extractArguments', () => {
  it('finds arguments with their kind, including nested ones', () => {
    const args = extractArguments(
      '{name} hizo {count, plural, one {# sprint en {place}} other {# sprints}} {sex, select, female {a} other {o}} {n, number}',
    );
    expect(Object.fromEntries(args)).toEqual({
      name: 'text',
      count: 'plural',
      place: 'text',
      sex: 'select',
      n: 'number',
    });
  });

  it('treats tags as text', () => {
    expect(extractArguments('<b>Hola</b>').size).toBe(0);
  });

  it('throws on invalid ICU', () => {
    expect(() => extractArguments('{count, plural, one {x}')).toThrow();
  });
});

describe('validateCatalog', () => {
  it('accepts a valid partial override', () => {
    expect(
      validateCatalog({ 'role.coach': 'Coach', 'common.category': 'División {name}' }),
    ).toEqual([]);
  });

  it('reports unknown keys, syntax errors, blank messages, argument mismatches and dates', () => {
    const issues = validateCatalog({
      'common.nope': 'x',
      'common.save': '   ',
      'sync.pending': '{count, plural, one {# cambio}',
      'common.category': 'Categoría {categoria}',
      'wellness.streak': '{days} días',
      'sync.lastSynced': 'Última: {dateTime, date, short}',
    });
    expect(issues.map((issue) => [issue.key, issue.code])).toEqual([
      ['common.nope', 'unknown_key'],
      ['common.save', 'blank'],
      ['sync.pending', 'invalid_syntax'],
      ['common.category', 'argument_mismatch'],
      ['wellness.streak', 'argument_mismatch'],
      ['sync.lastSynced', 'date_argument'],
      ['sync.lastSynced', 'argument_mismatch'],
    ]);
  });
});
