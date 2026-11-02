import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3StorageConfig } from './config.js';
import type {
  DownloadRequest,
  ObjectStorage,
  SignedDownload,
  SignedUpload,
  StoredObject,
  UploadRequest,
} from './storage.js';

/** Longest validity of a signed URL in SigV4 (7 days). */
const MAX_PRESIGN_S = 7 * 24 * 60 * 60;

/**
 * Headers of an upload that stay headers (not query params) and are signed:
 * the bucket refuses the `PUT` unless they carry exactly the signed values.
 */
const UPLOAD_SIGNED_HEADERS = ['content-type', 'content-length', 'x-amz-checksum-sha256'] as const;

export interface S3StorageOptions {
  /** Clock of the `expiresAt` values (tests). */
  readonly now?: () => Date;
  /** Timeout of the server's own calls (`HEAD`, `DELETE`). */
  readonly requestTimeoutMs?: number;
}

function expiresInS(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PRESIGN_S) {
    throw new RangeError(`A signed URL lives 1 to ${String(MAX_PRESIGN_S)} s`);
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchKey')
  );
}

/**
 * The bucket through the AWS SDK v3 (any S3-compatible provider). Checksums
 * are only computed when an operation requires them: the default "flexible
 * checksums" of the SDK would sign a CRC the browser cannot reproduce.
 */
export function createS3Storage(
  config: S3StorageConfig,
  options: S3StorageOptions = {},
): ObjectStorage {
  const now = options.now ?? (() => new Date());
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { requestTimeout: options.requestTimeoutMs ?? 10_000 },
    maxAttempts: 3,
  });
  const expiry = (seconds: number) => new Date(now().getTime() + seconds * 1000);

  return {
    async presignUpload(request: UploadRequest): Promise<SignedUpload> {
      const seconds = expiresInS(request.expiresInS);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: request.key,
        ContentType: request.contentType,
        ContentLength: request.sizeBytes,
        ChecksumSHA256: request.checksumSha256,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: seconds,
        signingDate: now(),
        signableHeaders: new Set(UPLOAD_SIGNED_HEADERS),
        unhoistableHeaders: new Set(UPLOAD_SIGNED_HEADERS),
      });
      return {
        method: 'PUT',
        url,
        // `Content-Length` is signed but set by the HTTP client from the body (browsers forbid it).
        headers: {
          'content-type': request.contentType,
          'x-amz-checksum-sha256': request.checksumSha256,
        },
        expiresAt: expiry(seconds),
      };
    },

    async presignDownload(request: DownloadRequest): Promise<SignedDownload> {
      const seconds = expiresInS(request.expiresInS);
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: request.key,
        ...(request.contentType !== undefined && { ResponseContentType: request.contentType }),
        ResponseContentDisposition: request.contentDisposition,
        // Nothing caches a personal file beyond the URL's own life.
        ResponseCacheControl: `private, max-age=${String(seconds)}`,
      });
      const url = await getSignedUrl(client, command, { expiresIn: seconds, signingDate: now() });
      return { url, expiresAt: expiry(seconds) };
    },

    async stat(key: string): Promise<StoredObject | null> {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key, ChecksumMode: 'ENABLED' }),
        );
        return {
          sizeBytes: head.ContentLength ?? 0,
          contentType: head.ContentType?.split(';')[0]?.trim().toLowerCase() ?? null,
          checksumSha256: head.ChecksumSHA256 ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async remove(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },
  };
}
