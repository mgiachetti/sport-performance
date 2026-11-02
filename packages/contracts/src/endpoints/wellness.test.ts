import { describe, expect, it } from 'vitest';
import {
  correctWellness,
  getWellness,
  getWellnessForm,
  listWellness,
  submitWellness,
  wellnessSchema,
} from './wellness.js';

const entry = {
  id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f',
  playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10',
  localDate: '2026-11-02',
  itemCount: 3,
  items: ['sleep', 'fatigue', 'soreness'],
  scores: { sleep: 4, fatigue: 3, soreness: 2 },
  meanScore: 3,
  submittedAt: '2026-11-02T10:00:00.000Z',
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  version: '1793586338688123',
};

describe('wellness endpoints', () => {
  it('are club endpoints under /v1/wellness', () => {
    for (const endpoint of [
      getWellnessForm,
      submitWellness,
      correctWellness,
      listWellness,
      getWellness,
    ]) {
      expect(endpoint.auth).toBe('club');
      expect(endpoint.tags).toEqual(['wellness']);
      expect(endpoint.path.startsWith('/v1/wellness')).toBe(true);
    }
    expect(submitWellness.response.status).toBe(201);
    expect(correctWellness.method).toBe('PATCH');
  });

  it('takes integer scores 1–5 of known items only', () => {
    const body = submitWellness.body;
    expect(body.safeParse({ scores: { sleep: 1, fatigue: 5 } }).success).toBe(true);
    for (const scores of [
      { sleep: 0 },
      { sleep: 6 },
      { sleep: 2.5 },
      { pain: 3 },
      { sleep: '3' },
    ]) {
      expect(body.safeParse({ scores }).success, JSON.stringify(scores)).toBe(false);
    }
    expect(body.safeParse({ scores: {}, extra: true }).success).toBe(false);
    expect(body.safeParse({ scores: {}, localDate: '2026-02-30' }).success).toBe(false);
  });

  it('requires the version and a trimmed reason to correct', () => {
    const body = correctWellness.body;
    const valid = { version: '1', scores: { sleep: 3 }, changeReason: 'Me equivoqué' };
    expect(body.safeParse(valid).success).toBe(true);
    expect(body.safeParse({ ...valid, changeReason: undefined }).success).toBe(false);
    expect(body.safeParse({ ...valid, changeReason: ' Me equivoqué' }).success).toBe(false);
    expect(body.safeParse({ ...valid, version: undefined }).success).toBe(false);
  });

  it('lists newest first by default and only by the allowed sorts', () => {
    expect(listWellness.query.parse({}).sort).toBe('-localDate');
    expect(listWellness.query.safeParse({ sort: 'submittedAt' }).success).toBe(true);
    expect(listWellness.query.safeParse({ sort: 'meanScore' }).success).toBe(false);
  });

  it('describes an entry with its item set version', () => {
    expect(wellnessSchema.parse(entry)).toEqual(entry);
    expect(wellnessSchema.safeParse({ ...entry, itemCount: 4 }).success).toBe(false);
    expect(wellnessSchema.safeParse({ ...entry, items: ['pain'] }).success).toBe(false);
  });
});
