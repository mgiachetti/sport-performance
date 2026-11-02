import { z } from 'zod';

/**
 * Configuration of the S3-compatible bucket (ADR 0003, ADR 0044). Railway
 * buckets, AWS S3, Cloudflare R2 and MinIO all speak the same API; the code
 * never names a provider. Credentials only come from the environment.
 */
export interface S3StorageConfig {
  /** `https://storage.railway.app`, `http://localhost:9000` (MinIO). */
  readonly endpoint: string;
  /** Signing region; `auto` for providers that ignore it (Railway, R2). */
  readonly region: string;
  readonly bucket: string;
  /** Never logged. */
  readonly accessKeyId: string;
  /** Never logged. */
  readonly secretAccessKey: string;
  /** `bucket` in the path instead of the host name (MinIO; Railway accepts both). */
  readonly forcePathStyle: boolean;
}

/** S3 bucket names: 3 to 63 lowercase letters, digits, dots and hyphens. */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Environment variables of the bucket, to spread into a service's own env
 * schema (the API, the worker). On Railway they reference the bucket's
 * variables: `STORAGE_ENDPOINT=${{Bucket.ENDPOINT}}`, `STORAGE_BUCKET=${{Bucket.BUCKET}}`…
 */
export const storageEnvShape = {
  STORAGE_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  STORAGE_REGION: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .default('auto'),
  STORAGE_BUCKET: z.string().regex(BUCKET_PATTERN).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(3).max(128).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(8).max(256).optional(),
  STORAGE_FORCE_PATH_STYLE: booleanFlag.default(false),
};

export const STORAGE_REQUIRED_VARIABLES = [
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

export type StorageEnv = z.output<z.ZodObject<typeof storageEnvShape>>;

/** A problem of the bucket variables: which one and what, never its value. */
export interface StorageEnvProblem {
  readonly variable: string;
  readonly message: string;
}

/**
 * Cross-variable rules: all of the bucket variables or none (outside
 * production, none turns uploads off); in production all of them, over
 * `https`, with a secret that is not an example value.
 */
export function storageEnvProblems(env: StorageEnv, production: boolean): StorageEnvProblem[] {
  const missing = STORAGE_REQUIRED_VARIABLES.filter((variable) => env[variable] === undefined);
  const problems: StorageEnvProblem[] = [];
  if (production || missing.length < STORAGE_REQUIRED_VARIABLES.length) {
    for (const variable of missing) {
      problems.push({
        variable,
        message: production
          ? 'required in production'
          : 'required with the other STORAGE_ variables',
      });
    }
  }
  if (
    production &&
    env.STORAGE_ENDPOINT !== undefined &&
    !env.STORAGE_ENDPOINT.startsWith('https://')
  ) {
    problems.push({ variable: 'STORAGE_ENDPOINT', message: 'must be https in production' });
  }
  if (production && env.STORAGE_SECRET_ACCESS_KEY !== undefined) {
    if (
      env.STORAGE_SECRET_ACCESS_KEY.length < 20 ||
      /change-?me|example/i.test(env.STORAGE_SECRET_ACCESS_KEY)
    ) {
      problems.push({
        variable: 'STORAGE_SECRET_ACCESS_KEY',
        message: 'looks like an example value',
      });
    }
  }
  return problems;
}

/** The bucket configuration, or `null` when the variables are unset (uploads off). */
export function storageConfigOf(env: StorageEnv): S3StorageConfig | null {
  if (
    env.STORAGE_ENDPOINT === undefined ||
    env.STORAGE_BUCKET === undefined ||
    env.STORAGE_ACCESS_KEY_ID === undefined ||
    env.STORAGE_SECRET_ACCESS_KEY === undefined
  ) {
    return null;
  }
  return {
    endpoint: new URL(env.STORAGE_ENDPOINT).origin,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  };
}
