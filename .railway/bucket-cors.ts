/**
 * CORS of the `files` bucket (B-701, ADR 0044, ADR 0063). The browser of the
 * staff web uploads with the `PUT` the API signed (content type, length and
 * SHA-256 as headers) and reads with signed `GET`s; the mobile app does not
 * need CORS. The bucket allows exactly that, from the web's origin only.
 *
 * Prints the configuration for `aws s3api put-bucket-cors` (runbook,
 * docs/infra/railway.md):
 *
 *   node .railway/bucket-cors.ts https://app.example.org > cors.json
 *
 * Self-contained (no relative imports): Node runs it with type stripping.
 */

/** Headers of a signed upload (packages/storage/src/s3.ts, `UPLOAD_SIGNED_HEADERS`). */
export const UPLOAD_HEADERS = ['content-type', 'x-amz-checksum-sha256'] as const;

export interface CorsRule {
  readonly AllowedOrigins: string[];
  readonly AllowedMethods: string[];
  readonly AllowedHeaders: string[];
  readonly ExposeHeaders: string[];
  readonly MaxAgeSeconds: number;
}

export interface BucketCors {
  readonly CORSRules: CorsRule[];
}

/** Only https origins, without path; `http://localhost` only for a local bucket. */
export function webOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Not a URL: ${value}`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`The web origin must be https: ${value}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('The web origin must not carry credentials.');
  }
  return url.origin;
}

export function bucketCors(origins: readonly string[]): BucketCors {
  if (origins.length === 0) throw new Error('Give the origin of the web (https://...).');
  return {
    CORSRules: [
      {
        AllowedOrigins: [...new Set(origins.map(webOrigin))],
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: [...UPLOAD_HEADERS],
        ExposeHeaders: ['ETag'],
        // The browser caches the preflight for an hour.
        MaxAgeSeconds: 3600,
      },
    ],
  };
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(bucketCors(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
