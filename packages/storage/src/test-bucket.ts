import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3StorageConfig } from './config.js';

/**
 * Throwaway buckets for integration tests (`@sport-performance/storage/testing`),
 * on the S3-compatible server of `STORAGE_TEST_URL`
 * (`http://<access key>:<secret>@localhost:9000`, MinIO in Docker and in CI).
 * Never pointed at a real bucket: every test bucket is created and dropped.
 */
export const storageTestUrl = process.env.STORAGE_TEST_URL;

export interface TestBucket {
  readonly config: S3StorageConfig;
  /** Every key in the bucket. */
  keys(): Promise<string[]>;
  drop(): Promise<void>;
}

function clientOf(config: S3StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

export async function createTestBucket(serverUrl: string): Promise<TestBucket> {
  const url = new URL(serverUrl);
  const config: S3StorageConfig = {
    endpoint: url.origin,
    region: 'us-east-1',
    bucket: `sp-test-${randomBytes(6).toString('hex')}`,
    accessKeyId: decodeURIComponent(url.username),
    secretAccessKey: decodeURIComponent(url.password),
    forcePathStyle: true,
  };
  const client = clientOf(config);
  await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  const keys = async () => {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket }));
    return (listed.Contents ?? []).flatMap((object) =>
      object.Key === undefined ? [] : [object.Key],
    );
  };
  return {
    config,
    keys,
    drop: async () => {
      const remaining = await keys();
      if (remaining.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: remaining.map((Key) => ({ Key })) },
          }),
        );
      }
      await client.send(new DeleteBucketCommand({ Bucket: config.bucket }));
      client.destroy();
    },
  };
}
