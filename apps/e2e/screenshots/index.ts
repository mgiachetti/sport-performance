#!/usr/bin/env node
/**
 * Merges the parts the screenshot run left (`screens.shots.ts`) into
 * `<run dir>/screenshots/index.json`, `index.txt` (file and route, one per
 * line) and `index.html`, a contact sheet grouped by viewport and account.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stackEndpoints } from '../src/stack/config.ts';
import type { Shot } from './screens.shots.ts';

const dir = join(stackEndpoints().runDir, 'screenshots');
const partsDir = join(dir, 'parts');
if (!existsSync(partsDir)) {
  process.stderr.write(`No screenshots in ${dir}: run the screenshots first.\n`);
  process.exit(1);
}
const shots = readdirSync(partsDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap((name) => JSON.parse(readFileSync(join(partsDir, name), 'utf8')) as Shot[]);

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

writeFileSync(join(dir, 'index.json'), `${JSON.stringify(shots, null, 2)}\n`);
writeFileSync(
  join(dir, 'index.txt'),
  `${shots.map((shot) => `${relative(dir, shot.file)}\t${shot.route}`).join('\n')}\n`,
);
const groups = new Map<string, Shot[]>();
for (const shot of shots) {
  const key = `${String(shot.width)} px · ${shot.variant} · ${shot.account}`;
  groups.set(key, [...(groups.get(key) ?? []), shot]);
}
const sections = [...groups.entries()]
  .map(
    ([title, items]) =>
      `<h2>${escape(title)}</h2><div class="grid">${items
        .map(
          (shot) =>
            `<figure><a href="${escape(relative(dir, shot.file))}"><img loading="lazy" src="${escape(
              relative(dir, shot.file),
            )}" alt=""></a><figcaption>${escape(shot.route)}</figcaption></figure>`,
        )
        .join('')}</div>`,
  )
  .join('\n');
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><html lang="es-AR"><meta charset="utf-8"><title>Capturas</title>
<style>body{font:14px system-ui;margin:24px;background:#141210;color:#f3eee7}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure{margin:0}img{width:100%;height:180px;object-fit:cover;object-position:top;border:1px solid #332d27}a{color:inherit}</style>
<h1>Capturas (${String(shots.length)})</h1>${sections}</html>\n`,
);
process.stdout.write(`${String(shots.length)} screenshots indexed in ${dir}\n`);
