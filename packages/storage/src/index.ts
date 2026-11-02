/**
 * @sport-performance/storage: uploaded files in the S3-compatible bucket
 * (B-325, ADR 0044). Signed URLs for clients, metadata checks and removal
 * for the API, and the retention job for the worker.
 */
export {
  STORAGE_REQUIRED_VARIABLES,
  storageConfigOf,
  storageEnvProblems,
  storageEnvShape,
  type S3StorageConfig,
  type StorageEnv,
  type StorageEnvProblem,
} from './config.js';
export { createS3Storage, type S3StorageOptions } from './s3.js';
export {
  contentDisposition,
  type DownloadRequest,
  type ObjectStorage,
  type SignedDownload,
  type SignedUpload,
  type StoredObject,
  type UploadRequest,
} from './storage.js';
export {
  PURGE_BATCH_SIZE,
  purgeExpiredFiles,
  type PurgeOptions,
  type PurgeReport,
} from './retention.js';
