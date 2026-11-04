import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTrainingSession,
  participationSchema,
  recordParticipations,
  submitSessionRpe,
  updateParticipation,
  updateTrainingSession,
} from './training.js';

const categoryId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const playerId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

describe('createTrainingSession', () => {
  const base = {
    kind: 'training',
    categoryId,
    startsAt: '2026-11-02T22:00:00.000Z',
  };

  it('accepts a session with drills', () => {
    const parsed = createTrainingSession.body.parse({
      ...base,
      drills: [{ name: 'Tackle', contactLevel: 'controlled', durationMin: 20 }],
    });
    expect(parsed.drills?.[0]?.contactLevel).toBe('controlled');
  });

  it('keeps the opponent to matches', () => {
    expect(createTrainingSession.body.safeParse({ ...base, opponent: 'CASI' }).success).toBe(false);
    expect(
      createTrainingSession.body.safeParse({ ...base, kind: 'match', opponent: 'CASI' }).success,
    ).toBe(true);
  });

  it('rejects unknown fields, padded text and a missing category', () => {
    expect(createTrainingSession.body.safeParse({ ...base, sport: 'rugby' }).success).toBe(false);
    expect(createTrainingSession.body.safeParse({ ...base, title: ' Defensa' }).success).toBe(
      false,
    );
    expect(createTrainingSession.body.safeParse({ ...base, categoryId: undefined }).success).toBe(
      false,
    );
  });
});

describe('updateTrainingSession', () => {
  it('needs the version and takes a normalized change reason', () => {
    expect(updateTrainingSession.body.safeParse({ title: 'x' }).success).toBe(false);
    expect(
      updateTrainingSession.body.safeParse({ version: '1', changeReason: ' padded ' }).success,
    ).toBe(false);
    expect(
      updateTrainingSession.body.safeParse({ version: '1', title: null, changeReason: 'Error' })
        .success,
    ).toBe(true);
  });
});

describe('recordParticipations', () => {
  const row = { clientUuid: randomUUID(), playerId, status: 'full', minutes: 60 };

  it('takes minutes by period whose sum is the minutes, never without load (B-803)', () => {
    const periods = { ...row, minutes: undefined, periodMinutes: [15, 15, 15, 15] };
    expect(recordParticipations.body.safeParse({ rows: [periods] }).success).toBe(true);
    expect(
      recordParticipations.body.safeParse({ rows: [{ ...periods, minutes: 60 }] }).success,
    ).toBe(true);
    expect(
      recordParticipations.body.safeParse({ rows: [{ ...periods, minutes: 50 }] }).success,
    ).toBe(false);
    expect(
      recordParticipations.body.safeParse({ rows: [{ ...periods, status: 'absent' }] }).success,
    ).toBe(false);
    expect(
      recordParticipations.body.safeParse({ rows: [{ ...periods, periodMinutes: [] }] }).success,
    ).toBe(false);
  });

  it('accepts up to 100 rows, one per player and clientUuid', () => {
    expect(recordParticipations.body.safeParse({ rows: [row] }).success).toBe(true);
    expect(recordParticipations.body.safeParse({ rows: [] }).success).toBe(false);
    const repeated = recordParticipations.body.safeParse({ rows: [row, row] });
    expect(repeated.success).toBe(false);
    expect(repeated.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'rows.1.playerId',
      'rows.1.clientUuid',
    ]);
  });

  it('keeps load off absent and unavailable players', () => {
    for (const status of ['absent', 'unavailable']) {
      expect(
        recordParticipations.body.safeParse({ rows: [{ ...row, status, minutes: 30 }] }).success,
      ).toBe(false);
      expect(
        recordParticipations.body.safeParse({ rows: [{ ...row, status, minutes: null }] }).success,
      ).toBe(true);
    }
    expect(
      updateParticipation.body.safeParse({ version: '1', status: 'absent', contactsN: 3 }).success,
    ).toBe(false);
  });

  it('bounds minutes and contacts', () => {
    expect(recordParticipations.body.safeParse({ rows: [{ ...row, minutes: 601 }] }).success).toBe(
      false,
    );
    expect(recordParticipations.body.safeParse({ rows: [{ ...row, contactsN: -1 }] }).success).toBe(
      false,
    );
  });
});

describe('submitSessionRpe', () => {
  it('takes an integer CR-10 value', () => {
    expect(submitSessionRpe.body.safeParse({ rpe: 7 }).success).toBe(true);
    for (const rpe of [-1, 11, 6.5]) {
      expect(submitSessionRpe.body.safeParse({ rpe }).success).toBe(false);
    }
  });

  it('answers the participation with the generated sRPE', () => {
    const participation = {
      id: randomUUID(),
      trainingSessionId: randomUUID(),
      playerId,
      status: 'full',
      minutes: 60,
      contactsN: null,
      rpe: 7,
      rpeReportedAt: '2026-11-02T23:30:00.000Z',
      rpeChannel: 'kiosk',
      srpeAu: 420,
      createdAt: '2026-11-02T23:30:00.000Z',
      updatedAt: '2026-11-02T23:30:00.000Z',
      version: '1793586338688123',
    };
    expect(participationSchema.parse(participation).srpeAu).toBe(420);
  });
});
