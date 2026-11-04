import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bucketCors, UPLOAD_HEADERS, webOrigin } from '../bucket-cors.js';

describe('bucketCors', () => {
  it('allows the signed PUT and GET from the web origin only', () => {
    expect(bucketCors(['https://app.example.org/', 'https://app.example.org'])).toEqual({
      CORSRules: [
        {
          AllowedOrigins: ['https://app.example.org'],
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['content-type', 'x-amz-checksum-sha256'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    });
  });

  it('prints the versioned configuration (test/fixtures/bucket-cors.json) for put-bucket-cors', () => {
    // The fixture is the reviewed JSON the runbook applies, for an example origin: a change to
    // the rules shows up as a diff of that file.
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/bucket-cors.json', import.meta.url), 'utf8'),
    ) as unknown;
    const printed = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../bucket-cors.ts', import.meta.url)), 'https://app.example.org'],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(printed)).toEqual(fixture);
    expect(bucketCors(['https://app.example.org'])).toEqual(fixture);
  });

  it('allows the headers the API signs, except the one browsers set themselves', () => {
    const storage = readFileSync(
      new URL('../../packages/storage/src/s3.ts', import.meta.url),
      'utf8',
    );
    const signed = /UPLOAD_SIGNED_HEADERS = \[([^\]]+)\]/.exec(storage)?.[1] ?? '';
    const names = [...signed.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(names.filter((name) => name !== 'content-length')).toEqual([...UPLOAD_HEADERS]);
  });

  it('refuses no origin, http outside loopback, paths are dropped', () => {
    expect(() => bucketCors([])).toThrow(/origin/);
    expect(() => webOrigin('http://app.example.org')).toThrow(/https/);
    expect(() => webOrigin('https://u:p@app.example.org')).toThrow(/credentials/);
    expect(() => webOrigin('app.example.org')).toThrow(/URL/);
    expect(webOrigin('http://localhost:5173/x')).toBe('http://localhost:5173');
    expect(webOrigin('https://app.example.org/login?x=1')).toBe('https://app.example.org');
  });
});
