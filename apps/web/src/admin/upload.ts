import type { ApiClient, UploadedFile } from '@sport-performance/contracts';
import type { FILE_KIND_POLICIES } from '@sport-performance/domain';
import { FILE_NAME_MAX_LENGTH } from '@sport-performance/domain';

/** SHA-256 of the content in base64, as the bucket checks it (`x-amz-checksum-sha256`). */
export async function sha256Base64(content: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The bucket did not take the bytes (expired URL, network): the upload is asked for again. */
export class UploadFailedError extends Error {
  override readonly name = 'UploadFailedError';
  constructor(readonly status: number | null) {
    super(`The bucket refused the upload (${status === null ? 'network' : String(status)})`);
  }
}

type LogoContentType = (typeof FILE_KIND_POLICIES)['club_logo']['contentTypes'][number];

/**
 * Uploads the club crest (ADR 0044): asks the API for a signed `PUT` with
 * the type, size and SHA-256, sends the bytes straight to the bucket (the
 * only request of the web that does not go to the API: its URL and headers
 * come signed from it) and confirms. Retrying is safe: the same
 * `clientUuid` returns the same pending file with a new URL.
 */
export async function uploadClubLogo(
  api: ApiClient,
  file: File,
  options: { fetch?: typeof globalThis.fetch; clientUuid?: string } = {},
): Promise<UploadedFile> {
  const content = await file.arrayBuffer();
  const created = await api.createFileUpload({
    body: {
      kind: 'club_logo',
      clientUuid: options.clientUuid ?? crypto.randomUUID(),
      contentType: file.type as LogoContentType,
      sizeBytes: content.byteLength,
      checksumSha256: await sha256Base64(content),
      ...(file.name === '' ? {} : { fileName: file.name.slice(0, FILE_NAME_MAX_LENGTH) }),
    },
  });
  if (created.upload !== null) {
    const send = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    let response: Response;
    try {
      response = await send(created.upload.url, {
        method: created.upload.method,
        headers: created.upload.headers,
        body: content,
      });
    } catch {
      throw new UploadFailedError(null);
    }
    if (!response.ok) throw new UploadFailedError(response.status);
  }
  return created.file.status === 'ready'
    ? created.file
    : api.confirmFileUpload({ params: { fileId: created.file.id } });
}
