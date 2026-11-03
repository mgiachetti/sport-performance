import type { FileUpload } from '@sport-performance/contracts';

/** The part of `fetch` a signed upload needs (tests pass a fake). */
export type UploadFetch = (
  url: string,
  init: {
    method: 'PUT';
    headers: Record<string, string>;
    body: Blob;
    credentials: 'omit';
  },
) => Promise<{ ok: boolean; status: number }>;

export type StorageUploader = (upload: FileUpload, body: Blob) => Promise<void>;

/** The bucket refused the upload (expired URL, other content than declared). */
export class StorageUploadError extends Error {
  constructor(readonly status: number) {
    super(`The bucket refused the upload (${String(status)})`);
    this.name = 'StorageUploadError';
  }
}

/**
 * Signed uploads (ADR 0044): the bytes go from the browser straight to the
 * bucket with the `PUT` and the headers the API signed (type, size and
 * SHA-256), never through the API and never with the session cookie.
 */
export function createStorageUploader(fetch: UploadFetch): StorageUploader {
  return async (upload, body) => {
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: { ...upload.headers },
      body,
      credentials: 'omit',
    });
    if (!response.ok) throw new StorageUploadError(response.status);
  };
}

/** SHA-256 of the content in base64, as the upload declares it (`x-amz-checksum-sha256`). */
export async function sha256Base64(body: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer()));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}
