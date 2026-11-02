import { createS3Storage, type ObjectStorage } from '@sport-performance/storage';
import type { FilesConfig } from '../config/env.js';

/**
 * The files module of the API (B-325, ADR 0044): the bucket and the life of
 * the signed URLs. Without it (development without a bucket) the file
 * endpoints answer `503` and the theme serves no crest.
 */
export interface FilesModule {
  readonly storage: ObjectStorage;
  readonly uploadUrlTtlS: number;
  readonly downloadUrlTtlS: number;
  readonly logoUrlTtlS: number;
  /** Clock of upload windows, retention and URL expiry (tests). */
  readonly now: () => Date;
}

export function createFilesModule(
  config: FilesConfig,
  options: { storage?: ObjectStorage; now?: () => Date } = {},
): FilesModule | undefined {
  const now = options.now ?? (() => new Date());
  const storage =
    options.storage ??
    (config.storage === null ? undefined : createS3Storage(config.storage, { now }));
  if (storage === undefined) return undefined;
  return {
    storage,
    uploadUrlTtlS: config.uploadUrlTtlS,
    downloadUrlTtlS: config.downloadUrlTtlS,
    logoUrlTtlS: config.logoUrlTtlS,
    now,
  };
}
