// Validates docs/adr against the template in docs/adr/README.md and checks
// that CLAUDE.md links every architecture decision to an existing ADR, and
// that every markdown link to an ADR points to an existing file whose number
// matches the link text. Pure functions over file contents, so they can be
// unit-tested without disk.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const STATUS = /^(?:Propuesto|Aceptado|Reemplazado por (\d{4}))$/;
const REQUIRED_SECTIONS = ['Contexto', 'Decisión', 'Consecuencias'];
const INDEX_ROW = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;
const ADR_LINK = /docs\/adr\/([^)\s]+\.md)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const ADR_MENTION = /\bADRs?\s+((?:\d{4}(?:\s*,\s*|\s+y\s+)?)+)/g;

/** @param {string} value */
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Parses one ADR file.
 * @param {string} fileName
 * @param {string} content
 */
export function parseAdr(fileName, content) {
  /** @type {string[]} */
  const errors = [];
  const fileMatch = ADR_FILE.exec(fileName);
  const number = fileMatch?.[1];
  if (number === undefined) {
    errors.push(`${fileName}: el nombre no sigue NNNN-titulo-corto.md`);
  }

  const lines = content.split(/\r?\n/);
  const heading = /^# (\d{4})\. (.+)$/.exec(lines[0] ?? '');
  const title = heading?.[2]?.trim();
  if (heading === null) {
    errors.push(`${fileName}: la primera línea debe ser "# NNNN. Título"`);
  } else if (number !== undefined && heading[1] !== number) {
    errors.push(`${fileName}: el título dice ${String(heading[1])} y el archivo ${number}`);
  }

  /** @param {string} key */
  const field = (key) => {
    const prefix = `- ${key}: `;
    return lines
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim();
  };

  const status = field('Estado');
  /** @type {string | undefined} */
  let supersededBy;
  if (status === undefined) {
    errors.push(`${fileName}: falta "- Estado:"`);
  } else {
    const statusMatch = STATUS.exec(status);
    if (statusMatch === null) {
      errors.push(`${fileName}: estado inválido "${status}"`);
    } else {
      supersededBy = statusMatch[1];
    }
  }

  const date = field('Fecha');
  if (date === undefined || !isIsoDate(date)) {
    errors.push(`${fileName}: "- Fecha:" debe ser una fecha aaaa-mm-dd válida`);
  }

  const issue = field('Issue');
  if (issue === undefined || !/^#\d+ \(B-\d{3}\)$/.test(issue)) {
    errors.push(`${fileName}: "- Issue:" debe tener la forma "#N (B-xxx)"`);
  }

  const sections = lines
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
  let cursor = -1;
  for (const required of REQUIRED_SECTIONS) {
    const position = sections.indexOf(required);
    if (position === -1) {
      errors.push(`${fileName}: falta la sección "## ${required}"`);
    } else if (position < cursor) {
      errors.push(`${fileName}: la sección "## ${required}" está fuera de orden`);
    } else {
      cursor = position;
    }
  }

  /** @type {Set<string>} */
  const mentions = new Set();
  for (const match of content.matchAll(ADR_MENTION)) {
    for (const mentioned of (match[1] ?? '').match(/\d{4}/g) ?? []) mentions.add(mentioned);
  }

  return { fileName, number, title, status, supersededBy, mentions, errors };
}

/**
 * Parses the index table of docs/adr/README.md.
 * @param {string} readme
 */
export function parseIndex(readme) {
  return readme
    .split(/\r?\n/)
    .map((line) => INDEX_ROW.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({
      number: match[1] ?? '',
      href: match[2] ?? '',
      title: match[3] ?? '',
      status: match[4] ?? '',
    }));
}

/**
 * Rows of the architecture table in CLAUDE.md, with the ADR files each links.
 * @param {string} claudeMd
 */
export function parseArchitectureTable(claudeMd) {
  const lines = claudeMd.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## Arquitectura'));
  if (start === -1) return [];
  /** @type {{ topic: string; adrFiles: string[] }[]} */
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    if (/^\|\s*-/.test(line) || /^\|\s*Tema\s*\|/.test(line)) continue;
    const topic = line.split('|')[1]?.trim() ?? '';
    const lastCell = line.split('|').at(-2) ?? '';
    const adrFiles = [...lastCell.matchAll(ADR_LINK)].map((match) => match[1] ?? '');
    rows.push({ topic, adrFiles });
  }
  return rows;
}

/**
 * Cross-checks ADR files, the README index and CLAUDE.md.
 * @param {{ files: Record<string, string>; readme: string; claudeMd: string }} input
 *   `files` maps every entry of docs/adr (except README.md) to its content.
 * @returns {string[]} human-readable errors; empty when everything is consistent.
 */
export function lintAdrs({ files, readme, claudeMd }) {
  /** @type {string[]} */
  const errors = [];
  const adrs = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, content]) => parseAdr(name, content));
  for (const adr of adrs) errors.push(...adr.errors);

  const byNumber = new Map();
  for (const adr of adrs) {
    if (adr.number === undefined) continue;
    if (byNumber.has(adr.number)) {
      errors.push(
        `ADR ${adr.number} duplicado: ${byNumber.get(adr.number).fileName} y ${adr.fileName}`,
      );
    }
    byNumber.set(adr.number, adr);
  }

  const numbers = [...byNumber.keys()].sort();
  numbers.forEach((number, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (number !== expected)
      errors.push(`numeración no correlativa: se esperaba ${expected} y está ${number}`);
  });

  for (const adr of adrs) {
    if (adr.supersededBy !== undefined && !byNumber.has(adr.supersededBy)) {
      errors.push(`${adr.fileName}: reemplazado por ${adr.supersededBy}, que no existe`);
    }
    for (const mentioned of adr.mentions) {
      if (!byNumber.has(mentioned))
        errors.push(`${adr.fileName}: menciona el ADR ${mentioned}, que no existe`);
    }
  }

  const index = parseIndex(readme);
  const indexed = new Set();
  for (const row of index) {
    indexed.add(row.number);
    const adr = byNumber.get(row.number);
    if (adr === undefined) {
      errors.push(`README: el índice lista ${row.number}, que no existe`);
      continue;
    }
    if (row.href !== adr.fileName)
      errors.push(`README: ${row.number} enlaza ${row.href} en vez de ${adr.fileName}`);
    if (row.title !== adr.title)
      errors.push(`README: el título de ${row.number} no coincide con el del ADR`);
    if (row.status !== adr.status)
      errors.push(`README: el estado de ${row.number} no coincide con el del ADR`);
  }
  for (const number of numbers) {
    if (!indexed.has(number)) errors.push(`README: falta el ADR ${number} en el índice`);
  }

  const fileNames = new Set([...Object.keys(files), 'README.md']);
  for (const match of claudeMd.matchAll(ADR_LINK)) {
    const linked = match[1] ?? '';
    if (!fileNames.has(linked)) errors.push(`CLAUDE.md: enlaza docs/adr/${linked}, que no existe`);
  }
  const architecture = parseArchitectureTable(claudeMd);
  if (architecture.length === 0)
    errors.push('CLAUDE.md: no se encontró la tabla de "## Arquitectura"');
  for (const row of architecture) {
    if (row.adrFiles.length === 0)
      errors.push(`CLAUDE.md: la decisión "${row.topic}" no enlaza a ningún ADR`);
  }

  return errors;
}

/**
 * Checks every markdown link to an ADR file (`[text](…/docs/adr/NNNN-slug.md)`,
 * resolved from the file that holds it): the file must exist, and a number in
 * the link text must be the number of the file it points to.
 * @param {{ markdown: Record<string, string>; adrFiles: string[] }} input
 *   `markdown` maps repository-relative paths to their content; `adrFiles`
 *   lists the file names in docs/adr.
 * @returns {string[]} human-readable errors; empty when every link is right.
 */
export function lintAdrLinks({ markdown, adrFiles }) {
  /** @type {string[]} */
  const errors = [];
  const existing = new Set(adrFiles);
  for (const [path, content] of Object.entries(markdown).sort(([a], [b]) => a.localeCompare(b))) {
    content.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(MARKDOWN_LINK)) {
        const text = match[1] ?? '';
        const href = (match[2] ?? '').split('#')[0] ?? '';
        if (/^[a-z]+:/i.test(href)) continue;
        const target = posix.normalize(posix.join(posix.dirname(path), href));
        const adrMatch = /^docs\/adr\/((\d{4})-[^/]+\.md)$/.exec(target);
        if (adrMatch === null) continue;
        const [, fileName = '', number = ''] = adrMatch;
        const where = `${path}:${String(index + 1)}`;
        if (!existing.has(fileName)) {
          errors.push(`${where}: enlaza docs/adr/${fileName}, que no existe`);
          continue;
        }
        const textNumber = /\b(\d{4})\b/.exec(text)?.[1];
        if (textNumber !== undefined && textNumber !== number)
          errors.push(`${where}: el texto dice ${textNumber} y el enlace va a ${fileName}`);
      }
    });
  }
  return errors;
}

/**
 * Markdown files tracked by git, outside `node_modules`.
 * @param {string} root repository root
 */
function trackedMarkdown(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  /** @type {Record<string, string>} */
  const markdown = {};
  for (const path of listed.split('\0')) {
    if (path === '' || path.split('/').includes('node_modules')) continue;
    if (!existsSync(join(root, path))) continue;
    markdown[path] = readFileSync(join(root, path), 'utf8');
  }
  return markdown;
}

/**
 * Reads the repository from disk and lints it.
 * @param {string} root repository root
 */
export function lintRepository(root) {
  const adrDir = join(root, 'docs', 'adr');
  /** @type {Record<string, string>} */
  const files = {};
  for (const name of readdirSync(adrDir)) {
    if (name === 'README.md') continue;
    files[name] = readFileSync(join(adrDir, name), 'utf8');
  }
  return [
    ...lintAdrs({
      files,
      readme: readFileSync(join(adrDir, 'README.md'), 'utf8'),
      claudeMd: readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
    }),
    ...lintAdrLinks({ markdown: trackedMarkdown(root), adrFiles: Object.keys(files) }),
  ];
}
