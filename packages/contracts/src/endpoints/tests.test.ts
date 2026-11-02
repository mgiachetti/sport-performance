import { describe, expect, it } from 'vitest';
import {
  TEST_BATCH_MAX,
  createTestResult,
  recordTestSessionResults,
  testEntryInputSchema,
  testResultSchema,
} from './tests.js';
import { updateTestSession } from './calendar.js';

const PLAYER = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const DEFINITION = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

describe('test contracts', () => {
  it('takes raw entries by kind and rejects unknown keys', () => {
    expect(
      testEntryInputSchema.safeParse({ kind: 'sprint_splits', split20S: 3.1, split40S: 5.6 })
        .success,
    ).toBe(true);
    expect(
      testEntryInputSchema.safeParse({ kind: 'cmj_flight_time', flightTimeS: 0.5, heightCm: 30 })
        .success,
    ).toBe(false);
    expect(
      testEntryInputSchema.safeParse({ kind: 'ift_stage', lastCompletedStage: 0 }).success,
    ).toBe(false);
    expect(testEntryInputSchema.safeParse({ kind: 'guess', value: 1 }).success).toBe(false);
  });

  it('needs a method and entries when done, a reason when not done', () => {
    const body = createTestResult.body;
    const base = { playerId: PLAYER, testDefinitionId: DEFINITION };
    expect(
      body.safeParse({
        ...base,
        status: 'done',
        method: 'video',
        entries: [{ kind: 'cmj_flight_time', flightTimeS: 0.5 }],
      }).success,
    ).toBe(true);
    expect(body.safeParse({ ...base, status: 'done', entries: [] }).success).toBe(false);
    expect(body.safeParse({ ...base, status: 'not_done' }).success).toBe(false);
    expect(body.safeParse({ ...base, status: 'not_done', notDoneReason: 'injured' }).success).toBe(
      true,
    );
    // A not-done result carries no entries.
    expect(
      body.safeParse({ ...base, status: 'not_done', notDoneReason: 'absent', entries: [] }).success,
    ).toBe(false);
  });

  it('caps the batch of a test day', () => {
    const result = {
      playerId: PLAYER,
      testDefinitionId: DEFINITION,
      status: 'not_done',
      notDoneReason: 'absent',
    };
    const schema = recordTestSessionResults.body;
    expect(schema.safeParse({ results: [result] }).success).toBe(true);
    expect(schema.safeParse({ results: [] }).success).toBe(false);
    expect(
      schema.safeParse({ results: Array.from({ length: TEST_BATCH_MAX + 1 }, () => result) })
        .success,
    ).toBe(false);
  });

  it('declares the change reason of corrections in the body', () => {
    expect(
      updateTestSession.body.safeParse({ version: '1', changeReason: ' padded ' }).success,
    ).toBe(false);
    expect(updateTestSession.body.safeParse({ version: '1', changeReason: 'Lluvia' }).success).toBe(
      true,
    );
  });

  it('reads the not-done reason as projected for the viewer', () => {
    const shape = testResultSchema.shape.notDoneReason;
    expect(shape.safeParse('unavailable').success).toBe(true);
    expect(shape.safeParse('injured').success).toBe(true);
    expect(shape.safeParse(null).success).toBe(true);
  });
});
