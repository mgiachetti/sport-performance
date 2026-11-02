import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  contentDisposition,
  storageConfigOf,
  storageEnvProblems,
  storageEnvShape,
  type StorageEnv,
} from './index.js';

const schema = z.object(storageEnvShape);
const parse = (env: Record<string, string>): StorageEnv => schema.parse(env);

const complete = {
  STORAGE_ENDPOINT: 'https://storage.railway.app',
  STORAGE_BUCKET: 'sport-performance-files',
  STORAGE_ACCESS_KEY_ID: 'placeholder-key-id',
  // Generated per run: no strong-looking secret is committed.
  STORAGE_SECRET_ACCESS_KEY: randomBytes(24).toString('base64url'),
};

describe('storage environment', () => {
  it('turns uploads off when no bucket variable is set (outside production)', () => {
    const env = parse({});
    expect(storageEnvProblems(env, false)).toEqual([]);
    expect(storageConfigOf(env)).toBeNull();
  });

  it('builds the configuration with defaults', () => {
    const env = parse({ ...complete, STORAGE_ENDPOINT: 'https://storage.railway.app/' });
    expect(storageEnvProblems(env, true)).toEqual([]);
    expect(storageConfigOf(env)).toEqual({
      endpoint: 'https://storage.railway.app',
      region: 'auto',
      bucket: 'sport-performance-files',
      accessKeyId: complete.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: complete.STORAGE_SECRET_ACCESS_KEY,
      forcePathStyle: false,
    });
    expect(
      storageConfigOf(
        parse({ ...complete, STORAGE_FORCE_PATH_STYLE: 'true', STORAGE_REGION: 'us-east-1' }),
      ),
    ).toMatchObject({ forcePathStyle: true, region: 'us-east-1' });
  });

  it('asks for every variable once one is set', () => {
    const problems = storageEnvProblems(parse({ STORAGE_BUCKET: 'files' }), false);
    expect(problems.map((p) => p.variable)).toEqual([
      'STORAGE_ENDPOINT',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ]);
  });

  it('requires the bucket over https with a real secret in production', () => {
    expect(storageEnvProblems(parse({}), true).map((p) => p.variable)).toHaveLength(4);
    const problems = storageEnvProblems(
      parse({
        ...complete,
        STORAGE_ENDPOINT: 'http://minio:9000',
        STORAGE_SECRET_ACCESS_KEY: 'change-me-local-only',
      }),
      true,
    );
    expect(problems).toEqual([
      { variable: 'STORAGE_ENDPOINT', message: 'must be https in production' },
      { variable: 'STORAGE_SECRET_ACCESS_KEY', message: 'looks like an example value' },
    ]);
    // Messages never carry the values.
    expect(JSON.stringify(problems)).not.toContain('change-me');
  });

  it('rejects malformed values', () => {
    expect(schema.safeParse({ STORAGE_BUCKET: 'Bad_Bucket' }).success).toBe(false);
    expect(schema.safeParse({ STORAGE_ENDPOINT: 'ftp://x' }).success).toBe(false);
    expect(schema.safeParse({ STORAGE_FORCE_PATH_STYLE: 'yes' }).success).toBe(false);
  });
});

describe('contentDisposition', () => {
  it('keeps UTF-8 names with an ASCII fallback', () => {
    expect(contentDisposition('inline', null)).toBe('inline');
    expect(contentDisposition('attachment', 'Planilla M15 año.csv')).toBe(
      `attachment; filename="Planilla M15 ano.csv"; filename*=UTF-8''Planilla%20M15%20a%C3%B1o.csv`,
    );
    expect(contentDisposition('attachment', '日本.pdf')).toMatch(/^attachment; filename="\.pdf"/);
    expect(contentDisposition('attachment', '日本')).toMatch(/^attachment; filename="archivo"/);
  });

  it('percent-encodes what is not an RFC 5987 attr-char', () => {
    expect(contentDisposition('attachment', "salto (1) d'Juan*.mp4")).toBe(
      `attachment; filename="salto (1) d'Juan*.mp4"; filename*=UTF-8''salto%20%281%29%20d%27Juan%2A.mp4`,
    );
  });
});
