// Regenerates openapi.json from the compiled endpoint catalog.
// Usage: pnpm --filter @sport-performance/contracts openapi
import { writeFile } from 'node:fs/promises';
import { buildOpenApiDocument, serializeOpenApiDocument } from '../dist/openapi/index.js';

const target = new URL('../openapi.json', import.meta.url);
await writeFile(target, serializeOpenApiDocument(buildOpenApiDocument()));
process.stdout.write(`Wrote ${target.pathname}\n`);
