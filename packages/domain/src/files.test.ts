import { describe, expect, it } from 'vitest';
import {
  CLIENT_UPLOAD_FILE_KINDS,
  DomainValidationError,
  FILE_KINDS,
  FILE_KIND_POLICIES,
  FILE_NAME_MAX_LENGTH,
  FILE_STATUSES,
  FILE_UPLOAD_URL_MAX_TTL_S,
  SHA256_BASE64_PATTERN,
  deletedFileExpiresAt,
  fileExpiresAt,
  fileObjectKey,
  fileUploadProblems,
  isFileKind,
  isFileStatus,
  parseFileKind,
  parseFileStatus,
  pendingUploadExpiresAt,
  sanitizeFileName,
  type ClubId,
} from './index.js';

const CLUB = '00000000-0000-4000-8000-0000000000c1' as ClubId;
const FILE = '00000000-0000-4000-8000-0000000000f1';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('file vocabularies', () => {
  it('parses kinds and statuses', () => {
    for (const kind of FILE_KINDS) expect(parseFileKind(kind)).toBe(kind);
    for (const status of FILE_STATUSES) expect(parseFileStatus(status)).toBe(status);
    expect(isFileKind('player_photo')).toBe(false);
    expect(isFileStatus('archived')).toBe(false);
    expect(() => parseFileKind('exe')).toThrow(DomainValidationError);
  });

  it('lets clients upload everything but the reports the worker writes', () => {
    expect(CLIENT_UPLOAD_FILE_KINDS).toEqual(['club_logo', 'cmj_video', 'data_import']);
  });
});

describe('policies', () => {
  it('declares lowercase MIME types without parameters and positive limits', () => {
    for (const kind of FILE_KINDS) {
      const policy = FILE_KIND_POLICIES[kind];
      for (const type of policy.contentTypes) expect(type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect(policy.maxSizeBytes).toBeGreaterThan(0);
      // A single signed PUT: S3 accepts up to 5 GiB.
      expect(policy.maxSizeBytes).toBeLessThanOrEqual(5 * 1024 ** 3);
    }
  });

  it('checks a declared upload against its kind', () => {
    expect(
      fileUploadProblems({ kind: 'cmj_video', contentType: 'video/mp4', sizeBytes: 1 }),
    ).toEqual([]);
    expect(
      fileUploadProblems({
        kind: 'club_logo',
        contentType: 'image/jpeg',
        sizeBytes: 2 * 1024 ** 2,
      }),
    ).toEqual(['content_type', 'size']);
    expect(
      fileUploadProblems({ kind: 'pdf_report', contentType: 'application/pdf', sizeBytes: 0 }),
    ).toEqual(['size']);
    expect(
      fileUploadProblems({ kind: 'data_import', contentType: 'text/csv', sizeBytes: 1.5 }),
    ).toEqual(['size']);
  });
});

describe('retention', () => {
  const confirmedAt = new Date('2026-03-01T12:00:00.000Z');

  it('expires files kept for a number of days', () => {
    expect(fileExpiresAt('cmj_video', confirmedAt)).toEqual(
      new Date(confirmedAt.getTime() + 180 * DAY_MS),
    );
    expect(fileExpiresAt('data_import', confirmedAt)).toEqual(
      new Date(confirmedAt.getTime() + 90 * DAY_MS),
    );
  });

  it('keeps the crest while in use and 30 days after', () => {
    expect(fileExpiresAt('club_logo', confirmedAt, true)).toBeNull();
    expect(fileExpiresAt('club_logo', confirmedAt)).toEqual(
      new Date(confirmedAt.getTime() + 30 * DAY_MS),
    );
  });

  it('gives a pending upload one day', () => {
    expect(pendingUploadExpiresAt(confirmedAt)).toEqual(new Date(confirmedAt.getTime() + DAY_MS));
  });

  it('accepts raster crests only', () => {
    expect(FILE_KIND_POLICIES.club_logo.contentTypes).not.toContain('image/svg+xml');
  });
});

describe('deletion on request', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  const maxUrlMs = FILE_UPLOAD_URL_MAX_TTL_S * 1000;

  it('outlives every upload URL a pending file may have handed out', () => {
    expect(
      deletedFileExpiresAt({ status: 'pending', expiresAt: at(DAY_MS), uploadedAt: null }, now),
    ).toEqual(at(maxUrlMs));
    // URLs never outlive the upload window.
    expect(
      deletedFileExpiresAt({ status: 'pending', expiresAt: at(60_000), uploadedAt: null }, now),
    ).toEqual(at(60_000));
    expect(
      deletedFileExpiresAt({ status: 'pending', expiresAt: at(-60_000), uploadedAt: null }, now),
    ).toEqual(now);
  });

  it('outlives the URLs signed before a recent confirmation', () => {
    const uploadedAt = at(-60_000);
    expect(
      deletedFileExpiresAt({ status: 'ready', expiresAt: at(180 * DAY_MS), uploadedAt }, now),
    ).toEqual(new Date(uploadedAt.getTime() + maxUrlMs));
    expect(
      deletedFileExpiresAt({ status: 'ready', expiresAt: null, uploadedAt: at(-DAY_MS) }, now),
    ).toEqual(now);
    expect(
      deletedFileExpiresAt({ status: 'ready', expiresAt: null, uploadedAt: null }, now),
    ).toEqual(now);
  });
});

describe('object keys', () => {
  it('lead with the club', () => {
    expect(fileObjectKey({ clubId: CLUB, kind: 'cmj_video', id: FILE })).toBe(
      `clubs/${CLUB}/cmj_video/${FILE}`,
    );
  });
});

describe('file names', () => {
  it('drops paths, quotes and control characters', () => {
    expect(sanitizeFileName('C:\\fotos\\salto "1".mp4')).toBe('salto 1.mp4');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('planilla\u0000\n.csv')).toBe('planilla.csv');
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(FILE_NAME_MAX_LENGTH);
  });

  it('drops C1 control characters too (U+0080 to U+009F, like U+0085)', () => {
    expect(sanitizeFileName('a\u0085b.mp4')).toBe('ab.mp4');
    expect(sanitizeFileName('\u0080x\u009f.csv\u0085')).toBe('x.csv');
    expect(() => sanitizeFileName('\u0085\u009b')).toThrow(DomainValidationError);
    // Letters next to the C1 block are kept.
    expect(sanitizeFileName('¡año.png')).toBe('¡año.png');
  });

  it('refuses names that end up empty', () => {
    for (const name of ['', '   ', '/', '..', 'a/..']) {
      expect(() => sanitizeFileName(name)).toThrow(DomainValidationError);
    }
  });
});

describe('checksum pattern', () => {
  it('matches a base64 SHA-256', () => {
    expect(SHA256_BASE64_PATTERN.test('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')).toBe(true);
    expect(SHA256_BASE64_PATTERN.test('47DEQpj8HBSa')).toBe(false);
  });
});
