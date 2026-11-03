/**
 * What the services need from the bucket (ADR 0044). The bytes of a file
 * never go through the API: clients upload with a signed `PUT` and download
 * with a signed `GET`; the API only signs, checks and deletes.
 */

/** A request the client sends as is, before `expiresAt`. */
export interface SignedUpload {
  readonly method: 'PUT';
  readonly url: string;
  /**
   * Headers the signature covers and the client must send with exactly
   * these values. `Content-Length` is signed too: the body must be exactly
   * the declared size (HTTP clients set it from the body).
   */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface SignedDownload {
  readonly url: string;
  readonly expiresAt: Date;
}

/** What the bucket says about a stored object. */
export interface StoredObject {
  readonly sizeBytes: number;
  /** Lowercase, without parameters; `null` if the bucket has none. */
  readonly contentType: string | null;
  /** Base64 SHA-256 the bucket verified on upload; `null` if it was uploaded without one. */
  readonly checksumSha256: string | null;
}

export interface UploadRequest {
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Base64 SHA-256 of the content: the bucket rejects any other body. */
  readonly checksumSha256: string;
  readonly expiresInS: number;
}

export interface DownloadRequest {
  readonly key: string;
  readonly expiresInS: number;
  /** `Content-Type` of the response, fixed by the server; default the object's own. */
  readonly contentType?: string;
  /** `Content-Disposition` of the response (`inline`, `attachment; filename=…`). */
  readonly contentDisposition: string;
}

export interface ObjectStorage {
  /** Signs the upload of exactly one body (type, size and SHA-256 are part of the signature). */
  presignUpload(request: UploadRequest): Promise<SignedUpload>;
  /** Signs a short-lived download with the response headers fixed. */
  presignDownload(request: DownloadRequest): Promise<SignedDownload>;
  /** The object's metadata, or `null` when there is no object under `key`. */
  stat(key: string): Promise<StoredObject | null>;
  /** Removes the object. Idempotent: removing a missing object succeeds. */
  remove(key: string): Promise<void>;
  /**
   * Writes an object the server produced itself (the worker's PDF reports,
   * B-602): the bucket checks the SHA-256 of the body, so a corrupted
   * upload is refused. Overwrites an object under the same key.
   */
  put(request: PutRequest): Promise<void>;
  /**
   * Reads an object of at most `maxBytes` (the crest of the club for a
   * report); `null` when there is none. Throws when it is bigger.
   */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
}

export interface PutRequest {
  readonly key: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  /** Base64 SHA-256 of `body`. */
  readonly checksumSha256: string;
}

/** An object bigger than the caller allowed (`ObjectStorage.get`). */
export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The object is bigger than ${String(maxBytes)} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

/**
 * `Content-Disposition` with an ASCII fallback and the RFC 5987 UTF-8 name,
 * so accents survive in every browser.
 */
export function contentDisposition(
  disposition: 'inline' | 'attachment',
  fileName: string | null,
): string {
  if (fileName === null) return disposition;
  const ascii = fileName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '');
  const fallback = ascii.trim() === '' ? 'archivo' : ascii;
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${rfc5987(fileName)}`;
}

/**
 * RFC 5987 `value-chars`: `encodeURIComponent` leaves `'`, `(`, `)` and `*`
 * as they are, but they are not `attr-char`s (the `'` would end the value).
 */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
