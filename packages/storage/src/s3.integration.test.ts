/**
 * The S3 client against a real S3-compatible server (MinIO in Docker and in
 * CI, `STORAGE_TEST_URL`): what the signature covers is what the bucket
 * enforces.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3Storage, type ObjectStorage } from './index.js';
import { createTestBucket, storageTestUrl, type TestBucket } from './test-bucket.js';

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('base64');
}

function describeWithStorage(name: string, body: (url: string) => void): void {
  const url = storageTestUrl;
  if (url !== undefined && url !== '') {
    describe(name, () => {
      body(url);
    });
    return;
  }
  if (process.env.CI !== undefined) {
    throw new Error(`${name}: STORAGE_TEST_URL is required in CI (MinIO service)`);
  }
  describe.skip(`${name} (set STORAGE_TEST_URL to run against MinIO)`, () => undefined);
}

describeWithStorage('S3 storage (MinIO)', (serverUrl) => {
  let bucket: TestBucket;
  let storage: ObjectStorage;
  const body = Buffer.from('fake mp4 bytes of a countermovement jump');
  const key = 'clubs/00000000-0000-4000-8000-0000000000c1/cmj_video/one';

  beforeAll(async () => {
    bucket = await createTestBucket(serverUrl);
    storage = createS3Storage(bucket.config);
  });

  afterAll(async () => {
    await bucket.drop();
  });

  async function upload(
    signedFor: Buffer,
    sent: Buffer,
    headers: Record<string, string> = {},
    target = key,
  ) {
    const signed = await storage.presignUpload({
      key: target,
      contentType: 'video/mp4',
      sizeBytes: signedFor.length,
      checksumSha256: sha256(signedFor),
      expiresInS: 60,
    });
    expect(signed.method).toBe('PUT');
    return fetch(signed.url, {
      method: 'PUT',
      headers: { ...signed.headers, ...headers },
      body: sent,
    });
  }

  it('accepts exactly the signed body and reports its metadata', async () => {
    const response = await upload(body, body);
    expect(response.status, await response.text()).toBe(200);
    expect(await storage.stat(key)).toEqual({
      sizeBytes: body.length,
      contentType: 'video/mp4',
      checksumSha256: sha256(body),
    });
  });

  it('rejects another body, another size or another type', async () => {
    const other = 'clubs/00000000-0000-4000-8000-0000000000c1/cmj_video/two';
    const sameSize = Buffer.from(body.toString().replace('fake', 'evil'));
    expect((await upload(body, sameSize, {}, other)).ok).toBe(false);
    expect((await upload(body, Buffer.concat([body, body]), {}, other)).ok).toBe(false);
    expect((await upload(body, body, { 'content-type': 'text/html' }, other)).ok).toBe(false);
    expect(await storage.stat(other)).toBeNull();
  });

  it('signs short downloads with the response headers fixed', async () => {
    const signed = await storage.presignDownload({
      key,
      expiresInS: 30,
      contentType: 'video/mp4',
      contentDisposition: 'inline',
    });
    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe('private, max-age=30');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    // Tampering with the URL breaks the signature.
    const tampered = signed.url.replace('cmj_video/one', 'cmj_video/two');
    expect((await fetch(tampered)).ok).toBe(false);
  });

  it('removes objects idempotently', async () => {
    await storage.remove(key);
    await storage.remove(key);
    expect(await storage.stat(key)).toBeNull();
  });

  it('refuses URLs outside the SigV4 window', async () => {
    await expect(
      storage.presignDownload({
        key,
        expiresInS: 0,
        contentType: 'video/mp4',
        contentDisposition: 'inline',
      }),
    ).rejects.toThrow(RangeError);
  });
});
