import { describe, expect, it } from 'vitest';
import {
  clubThemeSchema,
  createFileUpload,
  createFileUploadBodySchema,
  deleteFile,
  fileSchema,
  listFiles,
} from './index.js';

const CHECKSUM = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
const PLAYER = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

describe('createFileUpload', () => {
  it('is a club endpoint', () => {
    expect(createFileUpload).toMatchObject({ method: 'POST', path: '/v1/files', auth: 'club' });
    expect(deleteFile.method).toBe('DELETE');
  });

  it('takes the limits of each kind', () => {
    const video = {
      kind: 'cmj_video',
      playerId: PLAYER,
      contentType: 'video/mp4',
      sizeBytes: 1024,
      checksumSha256: CHECKSUM,
    };
    expect(createFileUploadBodySchema.parse(video)).toEqual(video);
    for (const invalid of [
      { ...video, playerId: undefined },
      { ...video, contentType: 'image/png' },
      { ...video, sizeBytes: 251 * 1024 * 1024 },
      { ...video, sizeBytes: 0 },
      { ...video, checksumSha256: 'deadbeef' },
      { ...video, extra: 1 },
      { ...video, kind: 'pdf_report' },
    ]) {
      expect(createFileUploadBodySchema.safeParse(invalid).success).toBe(false);
    }
    // The video of an attempt (B-604): its result and its entry, both or neither.
    const attempt = {
      testResultId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01',
      testEntryId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e02',
    };
    expect(createFileUploadBodySchema.parse({ ...video, ...attempt })).toEqual({
      ...video,
      ...attempt,
    });
    expect(
      createFileUploadBodySchema.safeParse({ ...video, testResultId: attempt.testResultId })
        .success,
    ).toBe(false);
    expect(
      createFileUploadBodySchema.safeParse({ ...video, testEntryId: attempt.testEntryId }).success,
    ).toBe(false);
    const logo = {
      kind: 'club_logo',
      contentType: 'image/webp',
      sizeBytes: 10,
      checksumSha256: CHECKSUM,
    };
    expect(createFileUploadBodySchema.safeParse(logo).success).toBe(true);
    // An SVG can carry scripts: crests are raster only.
    expect(
      createFileUploadBodySchema.safeParse({ ...logo, contentType: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(createFileUploadBodySchema.safeParse({ ...logo, playerId: PLAYER }).success).toBe(false);
    expect(
      createFileUploadBodySchema.safeParse({
        kind: 'data_import',
        contentType: 'text/csv',
        sizeBytes: 10,
        checksumSha256: CHECKSUM,
      }).success,
    ).toBe(true);
  });
});

describe('listFiles', () => {
  it('needs a kind and lists ready files by default, newest first', () => {
    expect(listFiles.query.safeParse({}).success).toBe(false);
    expect(listFiles.query.parse({ kind: 'cmj_video' })).toMatchObject({
      status: 'ready',
      sort: '-createdAt',
      limit: 50,
    });
  });
});

describe('fileSchema', () => {
  it('describes a pending file', () => {
    const pending = {
      id: PLAYER,
      kind: 'cmj_video',
      status: 'pending',
      playerId: PLAYER,
      categoryId: null,
      contentType: 'video/mp4',
      sizeBytes: 1,
      checksumSha256: CHECKSUM,
      fileName: null,
      testResultId: null,
      testEntryId: null,
      uploadedAt: null,
      expiresAt: '2026-11-03T12:00:00.000Z',
      deletedAt: null,
      createdBy: null,
      createdAt: '2026-11-02T12:00:00.000Z',
      updatedAt: '2026-11-02T12:00:00.000Z',
    };
    expect(fileSchema.parse(pending)).toEqual(pending);
  });
});

describe('club theme crest', () => {
  const theme = {
    clubId: PLAYER,
    slug: 'orc',
    name: 'Olivos Rugby Club',
    shortName: 'ORC',
    colors: {
      primary: '#F1882A',
      onPrimary: '#050505',
      secondary: '#050505',
      onSecondary: '#F3EEE7',
    },
    updatedAt: '2026-11-01T12:00:00.000Z',
  };

  it('is https, or http only against a local bucket', () => {
    const accepts = (logoUrl: string) => clubThemeSchema.safeParse({ ...theme, logoUrl }).success;
    expect(accepts('https://storage.railway.app/files/clubs/x/club_logo/y?X-Amz-Signature=z')).toBe(
      true,
    );
    expect(accepts('http://localhost:9000/files/clubs/x/club_logo/y')).toBe(true);
    expect(accepts('http://127.0.0.1:9000/files/x')).toBe(true);
    expect(accepts('http://storage.example.com/x')).toBe(false);
  });
});
