import { describe, expect, it } from 'vitest';
import {
  archiveExternalLoad,
  correctExternalLoad,
  externalLoadCorrectionSchema,
  externalLoadSchema,
  getExternalLoad,
  listExternalLoads,
  reportExternalLoad,
} from './external-loads.js';
import { SYNC_OPERATION_INPUTS, syncChangeSchema } from './sync.js';

const ID = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

const entry = {
  id: ID,
  playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10',
  localDate: '2026-11-02',
  activity: 'other_sport',
  detail: 'Fútbol',
  minutes: 60,
  rpe: 6,
  srpeAu: 360,
  reportedBy: 'player',
  archivedAt: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  version: '1793586338688123',
};

describe('external load endpoints', () => {
  it('are club endpoints of the training tag under /v1/external-loads', () => {
    for (const endpoint of [
      reportExternalLoad,
      correctExternalLoad,
      archiveExternalLoad,
      listExternalLoads,
      getExternalLoad,
    ]) {
      expect(endpoint.auth).toBe('club');
      expect(endpoint.tags).toEqual(['training']);
      expect(endpoint.path.startsWith('/v1/external-loads')).toBe(true);
    }
    expect(reportExternalLoad.response.status).toBe(201);
    expect(correctExternalLoad.method).toBe('PATCH');
  });

  it('marks every entry as reported by the player', () => {
    expect(externalLoadSchema.parse(entry)).toEqual(entry);
    expect(externalLoadSchema.safeParse({ ...entry, reportedBy: 'staff' }).success).toBe(false);
  });

  it('takes the type, whole minutes 1–600 and a whole CR-10 RPE', () => {
    const body = reportExternalLoad.body;
    expect(body.safeParse({ activity: 'other_sport', minutes: 60, rpe: 6 }).success).toBe(true);
    for (const wrong of [
      { activity: 'gym', minutes: 60, rpe: 6 },
      { activity: 'other', minutes: 0, rpe: 6 },
      { activity: 'other', minutes: 601, rpe: 6 },
      { activity: 'other', minutes: 30.5, rpe: 6 },
      { activity: 'other', minutes: 30, rpe: 10.5 },
      { activity: 'other', minutes: 30, rpe: 6, detail: '' },
      { activity: 'other', minutes: 30, rpe: 6, detail: 'Fútbol ' },
      { activity: 'other', minutes: 30, rpe: 6, playerId: ID },
    ]) {
      expect(body.safeParse(wrong).success, JSON.stringify(wrong)).toBe(false);
    }
  });

  it('corrects with a version, a reason and at least one field', () => {
    const body = correctExternalLoad.body;
    expect(body.safeParse({ version: '1', changeReason: 'Fueron 70', minutes: 70 }).success).toBe(
      true,
    );
    expect(
      body.safeParse({ version: '1', changeReason: 'Sin detalle', detail: null }).success,
    ).toBe(true);
    expect(body.safeParse({ version: '1', changeReason: 'Nada' }).success).toBe(false);
    expect(body.safeParse({ version: '1', minutes: 70 }).success).toBe(false);
  });

  it('travel through the offline queue and the pull', () => {
    expect(
      SYNC_OPERATION_INPUTS['external_load.report'].safeParse({
        body: { clientUuid: ID, activity: 'physical_education', minutes: 40, rpe: 4 },
      }).success,
    ).toBe(true);
    expect(
      SYNC_OPERATION_INPUTS['external_load.correct'].safeParse({
        target: { clientUuid: ID },
        body: { changeReason: 'Fueron 70', minutes: 70 },
      }).success,
    ).toBe(true);
    // Offline the reason is required too (ADR 0030), and no version is carried.
    expect(externalLoadCorrectionSchema.safeParse({ minutes: 70 }).success).toBe(false);
    expect(
      SYNC_OPERATION_INPUTS['external_load.correct'].safeParse({
        target: { id: ID },
        body: { version: '1', changeReason: 'x', minutes: 70 },
      }).success,
    ).toBe(false);
    expect(
      SYNC_OPERATION_INPUTS['external_load.archive'].safeParse({ target: { id: ID } }).success,
    ).toBe(true);
    expect(
      syncChangeSchema.safeParse({
        collection: 'external_load',
        op: 'upsert',
        id: ID,
        clientUuid: null,
        data: entry,
      }).success,
    ).toBe(true);
  });
});
