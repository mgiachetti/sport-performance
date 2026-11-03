// Copies the stylesheet of the web components next to the compiled modules (tsc only emits JS).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/web'), { recursive: true });
copyFileSync(join(root, 'src/web/charts.css'), join(root, 'dist/web/charts.css'));
