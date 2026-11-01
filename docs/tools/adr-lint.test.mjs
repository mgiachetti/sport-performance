import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  lintAdrs,
  lintRepository,
  parseAdr,
  parseArchitectureTable,
  parseIndex,
} from './adr-lint.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {{ number: string; title?: string; status?: string; date?: string; issue?: string; body?: string }} options */
function adr({
  number,
  title = `Decisión ${number}`,
  status = 'Aceptado',
  date = '2026-11-01',
  issue = '#16 (B-103)',
  body = '## Contexto\n\nx\n\n## Decisión\n\ny\n\n## Consecuencias\n\nz\n',
}) {
  return `# ${number}. ${title}\n\n- Estado: ${status}\n- Fecha: ${date}\n- Issue: ${issue}\n\n${body}`;
}

/** @param {[string, string, string][]} rows number, file, status */
function readme(rows) {
  const lines = rows.map(
    ([number, file, status]) => `| [${number}](${file}) | Decisión ${number} | ${status} |`,
  );
  return `# ADRs\n\n| # | Título | Estado |\n|---|---|---|\n${lines.join('\n')}\n`;
}

/** @param {string[]} files */
function claudeMd(files) {
  const rows = files.map((file, i) => `| Tema ${String(i)} | algo | [x](docs/adr/${file}) |`);
  return `# P\n\n## Arquitectura\n\n| Tema | Decisión | ADR |\n|---|---|---|\n${rows.join('\n')}\n\n## Otra\n`;
}

function validFixture() {
  return {
    files: {
      '0001-uno.md': adr({ number: '0001' }),
      '0002-dos.md': adr({
        number: '0002',
        body: '## Contexto\n\nVer ADR 0001.\n\n## Decisión\n\n## Consecuencias\n',
      }),
    },
    readme: readme([
      ['0001', '0001-uno.md', 'Aceptado'],
      ['0002', '0002-dos.md', 'Aceptado'],
    ]),
    claudeMd: claudeMd(['0001-uno.md', '0002-dos.md']),
  };
}

describe('parseAdr', () => {
  it('reads number, title, status and mentions', () => {
    const parsed = parseAdr(
      '0003-tres.md',
      adr({
        number: '0003',
        body: '## Contexto\n\n(ADR 0001, 0002 y 0004)\n\n## Decisión\n\n## Consecuencias\n',
      }),
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.number, '0003');
    assert.equal(parsed.title, 'Decisión 0003');
    assert.equal(parsed.status, 'Aceptado');
    assert.deepEqual([...parsed.mentions].sort(), ['0001', '0002', '0004']);
  });

  it('accepts a superseded status and exposes the replacement', () => {
    const parsed = parseAdr('0001-uno.md', adr({ number: '0001', status: 'Reemplazado por 0007' }));
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.supersededBy, '0007');
  });

  it('rejects malformed metadata', () => {
    const parsed = parseAdr(
      'ADR-1.md',
      adr({
        number: '0002',
        status: 'Quizás',
        date: '2026-02-30',
        issue: '16',
        body: '## Decisión\n\n## Contexto\n',
      }),
    );
    assert.ok(parsed.errors.some((e) => e.includes('NNNN-titulo-corto')));
    assert.ok(parsed.errors.some((e) => e.includes('estado inválido')));
    assert.ok(parsed.errors.some((e) => e.includes('Fecha')));
    assert.ok(parsed.errors.some((e) => e.includes('Issue')));
    assert.ok(parsed.errors.some((e) => e.includes('fuera de orden')));
    assert.ok(parsed.errors.some((e) => e.includes('## Consecuencias')));
  });

  it('rejects a heading that does not match the file number', () => {
    const parsed = parseAdr('0002-dos.md', adr({ number: '0003' }));
    assert.ok(parsed.errors.some((e) => e.includes('el título dice 0003')));
  });
});

describe('parseIndex / parseArchitectureTable', () => {
  it('parses index rows', () => {
    assert.deepEqual(parseIndex(readme([['0001', '0001-uno.md', 'Aceptado']])), [
      { number: '0001', href: '0001-uno.md', title: 'Decisión 0001', status: 'Aceptado' },
    ]);
  });

  it('only reads the table under "## Arquitectura"', () => {
    const rows = parseArchitectureTable(
      `| Fuera | x | y |\n\n${claudeMd(['0001-uno.md'])}\n| Tema 9 | x | y |\n`,
    );
    assert.deepEqual(rows, [{ topic: 'Tema 0', adrFiles: ['0001-uno.md'] }]);
  });
});

describe('lintAdrs', () => {
  it('accepts a consistent set', () => {
    assert.deepEqual(lintAdrs(validFixture()), []);
  });

  it('detects gaps and duplicates in the numbering', () => {
    const fixture = validFixture();
    fixture.files['0002-otro.md'] = adr({ number: '0002' });
    fixture.files['0004-cuatro.md'] = adr({ number: '0004' });
    const errors = lintAdrs(fixture);
    assert.ok(errors.some((e) => e.includes('duplicado')));
    assert.ok(errors.some((e) => e.includes('se esperaba 0003')));
  });

  it('detects an index out of sync with the files', () => {
    const fixture = validFixture();
    fixture.readme = readme([
      ['0001', '0001-uno.md', 'Propuesto'],
      ['0005', '0005-cinco.md', 'Aceptado'],
    ]);
    const errors = lintAdrs(fixture);
    assert.ok(errors.some((e) => e.includes('estado de 0001')));
    assert.ok(errors.some((e) => e.includes('lista 0005')));
    assert.ok(errors.some((e) => e.includes('falta el ADR 0002')));
  });

  it('detects dangling references', () => {
    const fixture = validFixture();
    fixture.files['0001-uno.md'] = adr({ number: '0001', status: 'Reemplazado por 0009' });
    fixture.files['0002-dos.md'] = adr({
      number: '0002',
      body: '## Contexto\n\nADR 0042\n\n## Decisión\n\n## Consecuencias\n',
    });
    fixture.readme = readme([
      ['0001', '0001-uno.md', 'Reemplazado por 0009'],
      ['0002', '0002-dos.md', 'Aceptado'],
    ]);
    const errors = lintAdrs(fixture);
    assert.ok(errors.some((e) => e.includes('reemplazado por 0009')));
    assert.ok(errors.some((e) => e.includes('menciona el ADR 0042')));
  });

  it('requires every architecture decision in CLAUDE.md to link an existing ADR', () => {
    const fixture = validFixture();
    fixture.claudeMd = claudeMd(['0001-uno.md', '0003-no-existe.md']).replace(
      '\n\n## Otra',
      '\n| Sin ADR | algo | — |\n\n## Otra',
    );
    const errors = lintAdrs(fixture);
    assert.ok(errors.some((e) => e.includes('0003-no-existe.md')));
    assert.ok(errors.some((e) => e.includes('"Sin ADR"')));
  });

  it('fails when CLAUDE.md has no architecture table', () => {
    const fixture = validFixture();
    fixture.claudeMd = '# P\n';
    assert.ok(lintAdrs(fixture).some((e) => e.includes('## Arquitectura')));
  });
});

describe('repository', () => {
  it('docs/adr, its index and CLAUDE.md are consistent', () => {
    assert.deepEqual(lintRepository(repoRoot), []);
  });
});
