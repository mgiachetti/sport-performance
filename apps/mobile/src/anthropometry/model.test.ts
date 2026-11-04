import { describe, expect, it } from 'vitest';
import { DAY, OTHER_PLAYER_ID, anthroDto, squadPlayer } from '../test/anthro-fixtures.ts';
import { PLAYER_ID, uuid } from '../test/fake-sync-server.ts';
import { prepareMutation } from '../offline/operations.ts';
import {
  canSave,
  correctionInput,
  dayMeasurements,
  draftOf,
  fieldsFor,
  parseDraft,
  parseField,
  plausibilityOf,
  recordInput,
  valuesOf,
} from './model.ts';

const day = DAY as Parameters<typeof recordInput>[2];

describe('fields of a player', () => {
  it('measure the ISAK skinfolds only in the performance stage', () => {
    expect(fieldsFor({ stage: 'performance' })).toContain('skinfoldsSumMm');
    expect(fieldsFor({ stage: 'development' })).not.toContain('skinfoldsSumMm');
    // Unknown stage: the server would refuse them outside M17/M19.
    expect(fieldsFor({ stage: null })).toEqual(['heightCm', 'sittingHeightCm', 'weightKg']);
  });
});

describe('the draft of a row', () => {
  it('reads es-AR decimals and refuses grouping, letters and the hard bounds', () => {
    expect(parseField('165,4', 'heightCm')).toEqual({ value: 165.4 });
    expect(parseField('  ', 'heightCm')).toEqual({});
    expect(parseField('1.650', 'heightCm')).toEqual({ problem: 'number' });
    expect(parseField('abc', 'weightKg')).toEqual({ problem: 'number' });
    expect(parseField('0', 'weightKg')).toEqual({ problem: 'range' });
    expect(parseField('251', 'heightCm')).toEqual({ problem: 'range' });
  });

  it('keeps the sitting height below the height and ignores fields of another stage', () => {
    const player = squadPlayer();
    const draft = parseDraft(
      { heightCm: '140', sittingHeightCm: '141', skinfoldsSumMm: '60' },
      player,
    );
    expect(draft.values).toEqual({ heightCm: 140 });
    expect(draft.problems).toEqual({ sittingHeightCm: 'sittingAboveHeight' });
    expect(canSave(draft, player)).toBe(false);
    const ok = parseDraft({ heightCm: '165', weightKg: '55,1' }, player);
    expect(canSave(ok, player)).toBe(true);
    // Nothing of a player without a current data consent is queued.
    expect(canSave(ok, squadPlayer({ blocked: true }))).toBe(false);
    expect(canSave(parseDraft({}, player), player)).toBe(false);
  });
});

describe('plausibility on the phone', () => {
  it('warns of a value out of range for the age and sex, with the decimal moved', () => {
    const warnings = plausibilityOf(squadPlayer(), { heightCm: 16.54, weightKg: 55 }, day);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ field: 'heightCm', status: 'below' });
    expect(warnings[0]?.suggestedValues).toContain(165.4);
    expect(plausibilityOf(squadPlayer(), { heightCm: 165.4 }, day)).toEqual([]);
  });
});

describe('inputs of the queue', () => {
  it('queue one measurement per mutation, valid for the shared contract', () => {
    const clientUuid = uuid();
    const input = recordInput(clientUuid, PLAYER_ID, day, { heightCm: 165.4, weightKg: 55.1 });
    const prepared = prepareMutation('anthro.record', input);
    expect(prepared.targets).toEqual([{ collection: 'anthro_measurement', clientUuid }]);
    expect(input.body.measurements).toEqual([
      { clientUuid, playerId: PLAYER_ID, measuredOn: DAY, heightCm: 165.4, weightKg: 55.1 },
    ]);
  });

  it('correct only what changed, with the reason, and nothing when nothing changed', () => {
    const before = valuesOf({ heightCm: 165.4, sittingHeightCm: 85.2, weightKg: 55.1 });
    const fields = fieldsFor(squadPlayer());
    const target = { clientUuid: uuid() };
    const input = correctionInput(
      target,
      before,
      { heightCm: 166.4, weightKg: 55.1 },
      fields,
      '  Talla mal tipeada ',
    );
    expect(input).toEqual({
      target,
      body: { changeReason: 'Talla mal tipeada', heightCm: 166.4, sittingHeightCm: null },
    });
    if (input === null) throw new Error('expected a correction');
    expect(() => prepareMutation('anthro.update', input)).not.toThrow();
    expect(
      correctionInput(
        { id: uuid() },
        before,
        { heightCm: 165.4, sittingHeightCm: 85.2, weightKg: 55.1 },
        fields,
        'x',
      ),
    ).toBeNull();
  });

  it('prefill a correction with the saved values in es-AR', () => {
    expect(draftOf(valuesOf({ heightCm: 165.4 }), (v) => String(v).replace('.', ','))).toEqual({
      heightCm: '165,4',
    });
  });
});

describe('measurements of the day', () => {
  it('show the latest of each player: served first, then the creates still in the queue', () => {
    const early = anthroDto({ createdAt: '2026-11-03T10:00:00.000Z', heightCm: 160 });
    const late = anthroDto({ createdAt: '2026-11-03T11:00:00.000Z', heightCm: 165 });
    const otherDay = anthroDto({ playerId: OTHER_PLAYER_ID, measuredOn: '2026-10-01' as never });
    const servedUuid = uuid();
    const queuedUuid = uuid();
    const map = dayMeasurements(
      [
        { data: late, clientUuid: servedUuid, pending: true },
        { data: early, clientUuid: null, pending: false },
        { data: otherDay, clientUuid: null, pending: false },
      ],
      [
        // Already served: the row of the pull wins.
        {
          clientUuid: servedUuid,
          playerId: PLAYER_ID,
          measuredOn: day,
          values: valuesOf({ heightCm: 1 }),
        },
        {
          clientUuid: queuedUuid,
          playerId: OTHER_PLAYER_ID,
          measuredOn: day,
          values: valuesOf({ weightKg: 60 }),
        },
      ],
      day,
    );
    expect(map.get(PLAYER_ID)).toMatchObject({
      target: { id: late.id },
      sync: 'pending',
      values: { heightCm: 165 },
    });
    expect(map.get(OTHER_PLAYER_ID)).toMatchObject({
      target: { clientUuid: queuedUuid },
      sync: 'queued',
      maturation: null,
      values: { weightKg: 60 },
    });
  });
});
