import type { LocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  ANA_ID,
  CMJ,
  COD_505,
  REACTION,
  SPRINT,
  STRENGTH,
  sheetPlayer,
} from '../test/test-day-fixtures';
import {
  buildAddedAttempt,
  buildRow,
  emptyDraft,
  entryModesOf,
  fieldsOf,
  issuesByPlayer,
  notDoneReasonOptions,
  notDoneReasonView,
  nextAttemptNumber,
  parseAttempt,
  previewRow,
  type RowDraft,
} from './model';

const DAY = '2026-04-14' as LocalDate;
const player = sheetPlayer({ id: ANA_ID, lastName: 'Álvarez' }, [SPRINT]);

function counter() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
}

function draftWith(
  attempts: Record<string, string>[],
  overrides: Partial<RowDraft> = {},
): RowDraft {
  const base = emptyDraft(
    attempts.length,
    'photocell',
    () => '0192e7a0-aaaa-7000-8000-000000000001',
  );
  return { ...base, attempts, entryUuids: attempts.map(() => ({})), ...overrides };
}

describe('entry modes', () => {
  it('offers the raw kinds of each test, never video frames, and the sprint only by splits', () => {
    expect(entryModesOf(SPRINT)).toEqual(['sprint_splits']);
    expect(entryModesOf(CMJ)).toEqual(['cmj_flight_time', 'value']);
    expect(entryModesOf(COD_505)).toEqual(['value']);
    expect(entryModesOf(STRENGTH)).toEqual(['strength_set', 'value']);
  });

  it('types one field per non-derived metric in value mode', () => {
    expect(fieldsOf(COD_505, 'value').map((f) => f.key)).toEqual([
      'cod505_left_s',
      'cod505_right_s',
    ]);
    expect(fieldsOf(STRENGTH, 'value').map((f) => f.key)).not.toContain('e1rm_kg');
  });
});

describe('parsing an attempt', () => {
  it('reads es-AR numbers and rejects a dot as decimal separator', () => {
    const ok = parseAttempt(SPRINT, 'sprint_splits', { split20S: '3,10', split40S: '5,42' });
    expect(ok).toMatchObject({
      status: 'ok',
      entries: [{ entry: { kind: 'sprint_splits', split20S: 3.1, split40S: 5.42 } }],
    });
    expect(parseAttempt(SPRINT, 'sprint_splits', { split20S: '3.10', split40S: '5,42' })).toEqual({
      status: 'invalid',
      fieldKey: 'split20S',
      problem: 'number',
    });
  });

  it('asks for the required splits and checks them with the domain', () => {
    expect(parseAttempt(SPRINT, 'sprint_splits', { split40S: '5,4' })).toEqual({
      status: 'invalid',
      fieldKey: 'split20S',
      problem: 'required',
    });
    expect(parseAttempt(SPRINT, 'sprint_splits', { split20S: '5,9', split40S: '5,4' })).toEqual({
      status: 'invalid',
      fieldKey: null,
      problem: 'domain',
    });
    expect(parseAttempt(SPRINT, 'sprint_splits', {})).toEqual({ status: 'empty' });
  });

  it('converts the CMJ flight time from milliseconds', () => {
    expect(parseAttempt(CMJ, 'cmj_flight_time', { flightTimeMsec: '500' })).toMatchObject({
      status: 'ok',
      entries: [{ entry: { kind: 'cmj_flight_time', flightTimeS: 0.5 } }],
    });
  });

  it('accepts 0 as a plain value (0 pull-ups) but not in the raw kinds', () => {
    expect(
      parseAttempt(STRENGTH, 'value', { pullups_n: '0', plank_s: '0' }, 'technique_reps'),
    ).toMatchObject({
      status: 'ok',
      entries: [
        { entry: { kind: 'value', metricCode: 'pullups_n', value: 0 } },
        { entry: { kind: 'value', metricCode: 'plank_s', value: 0 } },
      ],
    });
    expect(parseAttempt(STRENGTH, 'value', { pullups_n: '-1' }, 'technique_reps')).toEqual({
      status: 'invalid',
      fieldKey: 'pullups_n',
      problem: 'nonNegative',
    });
    expect(parseAttempt(CMJ, 'cmj_flight_time', { flightTimeMsec: '0' })).toEqual({
      status: 'invalid',
      fieldKey: 'flightTimeMsec',
      problem: 'positive',
    });
    expect(
      parseAttempt(STRENGTH, 'strength_set', { loadKg: '40', reps: '5', rir: '0' }, 'estimated_rm'),
    ).toMatchObject({ status: 'ok' });
  });

  it('ignores strength metrics the stage does not record', () => {
    expect(
      parseAttempt(STRENGTH, 'value', { rm1_kg: '80', pushups_n: '20' }, 'estimated_rm'),
    ).toMatchObject({
      status: 'ok',
      entries: [{ entry: { kind: 'value', metricCode: 'pushups_n', value: 20 } }],
    });
  });
});

describe('preview of a row', () => {
  it('scores with the domain formulas and marks the best attempt of each metric', () => {
    const draft = draftWith([
      { split10S: '1,90', split20S: '3,20', split40S: '5,60' },
      { split10S: '1,85', split20S: '3,15', split40S: '5,50' },
      { split10S: '1,95', split20S: '3,10', split40S: '5,55' },
    ]);
    const preview = previewRow(SPRINT, 'sprint_splits', draft, player, DAY);
    const score = (code: string) => preview.scores.find((s) => s.metricCode === code)?.value;
    expect(score('sprint_40_s')).toBe(5.5);
    expect(score('sprint_20_s')).toBe(3.1);
    // Vmax 20–40 of each attempt (20 / (t40 − t20)), the best one.
    expect(score('sprint_vmax_ms')).toBeCloseTo(20 / 2.35, 6);
    expect(preview.bestAttempt.get('sprint_40_s')).toBe(1);
    expect(preview.bestAttempt.get('sprint_20_s')).toBe(2);
    expect(preview.warnings).toEqual([]);
  });

  it('derives the 505 asymmetry and does not mark a best attempt for a mean', () => {
    const cod = previewRow(
      COD_505,
      'value',
      draftWith([{ cod505_left_s: '2,50', cod505_right_s: '2,40' }, { cod505_left_s: '2,45' }]),
      player,
      DAY,
    );
    expect(cod.scores.find((s) => s.metricCode === 'cod505_asymmetry_pct')?.value).toBeCloseTo(
      (0.05 / 2.4) * 100,
      6,
    );
    const reaction = previewRow(
      REACTION,
      'value',
      draftWith([{ reaction_simple_msec: '250' }, { reaction_simple_msec: '230' }]),
      player,
      DAY,
    );
    expect(reaction.scores).toEqual([
      { metricCode: 'reaction_simple_msec', value: 240, aggregation: 'mean' },
    ]);
    expect(reaction.bestAttempt.size).toBe(0);
  });

  it('warns about a value out of the plausible range and suggests the decimal comma', () => {
    const preview = previewRow(
      SPRINT,
      'sprint_splits',
      draftWith([{ split20S: '3,1', split40S: '54' }]),
      player,
      DAY,
    );
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatchObject({ attempt: 0, fieldKey: 'split40S', value: 54 });
    expect(preview.warnings[0]?.result.suggestedValues).toContain(5.4);
  });
});

describe('the batch of a station', () => {
  const context = {
    station: SPRINT,
    mode: 'sprint_splits' as const,
    exercise: null,
    deviceId: null,
  };

  it('builds a done result with stable clientUuids per attempt', () => {
    const uuid = counter();
    const built = buildRow(
      context,
      player,
      draftWith([{ split20S: '3,1', split40S: '5,4' }, {}, { split20S: '3,0', split40S: '5,3' }]),
      uuid,
    );
    expect(built.kind).toBe('result');
    if (built.kind !== 'result') return;
    expect(built.input).toEqual({
      clientUuid: '0192e7a0-aaaa-7000-8000-000000000001',
      status: 'done',
      playerId: ANA_ID,
      testDefinitionId: SPRINT.definition.id,
      method: 'photocell',
      entries: [
        {
          kind: 'sprint_splits',
          split20S: 3.1,
          split40S: 5.4,
          clientUuid: '00000000-0000-4000-8000-000000000001',
          attemptNumber: 1,
        },
        {
          kind: 'sprint_splits',
          split20S: 3,
          split40S: 5.3,
          clientUuid: '00000000-0000-4000-8000-000000000002',
          attemptNumber: 3,
        },
      ],
    });
    // Built again from the returned draft (a retry): the same ids.
    const again = buildRow(context, player, built.draft, counter());
    expect(again.kind === 'result' && again.input).toEqual(built.input);
  });

  it('skips an empty row and reports the problems of a row', () => {
    expect(buildRow(context, player, draftWith([{}, {}]))).toEqual({ kind: 'skip' });
    expect(buildRow(context, player, draftWith([{ split40S: '5,4' }]))).toEqual({
      kind: 'problems',
      problems: [{ kind: 'attempt', attempt: 0, fieldKey: 'split20S', problem: 'required' }],
    });
    expect(
      buildRow(
        context,
        player,
        draftWith([{}], { status: 'not_done', reason: 'other', note: ' ' }),
      ),
    ).toEqual({ kind: 'problems', problems: [{ kind: 'note' }] });
  });

  it('builds a not done result with its reason', () => {
    const built = buildRow(
      context,
      player,
      draftWith([{}], { status: 'not_done', reason: 'absent' }),
    );
    expect(built.kind === 'result' && built.input).toEqual({
      clientUuid: '0192e7a0-aaaa-7000-8000-000000000001',
      status: 'not_done',
      playerId: ANA_ID,
      testDefinitionId: SPRINT.definition.id,
      notDoneReason: 'absent',
    });
  });

  it('sends the note only with «Otro motivo», never one left hidden by another reason', () => {
    const other = buildRow(
      context,
      player,
      draftWith([{}], { status: 'not_done', reason: 'other', note: ' Viaje con la escuela ' }),
    );
    expect(other.kind === 'result' && other.input).toMatchObject({
      notDoneReason: 'other',
      notDoneNote: 'Viaje con la escuela',
    });
    const switched = buildRow(
      context,
      player,
      draftWith([{}], { status: 'not_done', reason: 'injured', note: 'Viaje con la escuela' }),
    );
    expect(switched.kind === 'result' && switched.input).toEqual({
      clientUuid: '0192e7a0-aaaa-7000-8000-000000000001',
      status: 'not_done',
      playerId: ANA_ID,
      testDefinitionId: SPRINT.definition.id,
      notDoneReason: 'injured',
    });
    // The note stays in the draft: going back to «Otro motivo» brings it back.
    expect(switched.kind === 'result' && switched.draft.note).toBe('Viaje con la escuela');
  });

  it('asks for the strength exercise and the device of a same-device test', () => {
    const strength = buildRow(
      { station: STRENGTH, mode: 'strength_set', exercise: null, deviceId: null },
      player,
      draftWith([{ loadKg: '40', reps: '5', rir: '2' }]),
    );
    expect(strength).toEqual({ kind: 'problems', problems: [{ kind: 'exercise' }] });
    const reaction = buildRow(
      { station: REACTION, mode: 'value', exercise: null, deviceId: null },
      player,
      draftWith([{ reaction_simple_msec: '240' }]),
    );
    expect(reaction).toEqual({ kind: 'problems', problems: [{ kind: 'device' }] });
    const withExercise = buildRow(
      { station: STRENGTH, mode: 'strength_set', exercise: 'goblet_squat', deviceId: null },
      player,
      draftWith([{ loadKg: '40', reps: '5', rir: '2' }]),
      counter(),
    );
    expect(withExercise.kind === 'result' && withExercise.input).toMatchObject({
      exercise: 'goblet_squat',
      entries: [{ kind: 'strength_set', loadKg: 40, reps: 5, rir: 2, attemptNumber: 1 }],
    });
  });

  it('adds one attempt to a recorded result after the last one', () => {
    expect(
      nextAttemptNumber({ entries: [{ attemptNumber: 1 }, { attemptNumber: 3 }] as never }),
    ).toBe(4);
    const added = buildAddedAttempt(
      context,
      player,
      { split20S: '3', split40S: '5,2' },
      4,
      {},
      counter(),
    );
    expect(added).toEqual({
      kind: 'entries',
      entries: [
        {
          kind: 'sprint_splits',
          split20S: 3,
          split40S: 5.2,
          clientUuid: '00000000-0000-4000-8000-000000000001',
          attemptNumber: 4,
        },
      ],
      uuids: { entry: '00000000-0000-4000-8000-000000000001' },
    });
  });
});

describe('issues of a rejected batch', () => {
  const done = (entries: unknown[]) =>
    ({
      clientUuid: '0192e7a0-aaaa-7000-8000-000000000001',
      status: 'done',
      playerId: ANA_ID,
      testDefinitionId: SPRINT.definition.id,
      method: 'manual',
      entries,
    }) as never;

  it('go back to the row that caused them, by the index sent', () => {
    const byPlayer = issuesByPlayer(
      [
        { path: ['body', 'results', 1, 'status'], code: 'not_in_battery', message: 'x' },
        { path: ['body', 'results', 0, 'deviceId'], code: 'custom', message: 'x' },
        { path: ['body'], code: 'custom', message: 'x' },
      ],
      [
        { playerId: 'a', input: done([]) },
        { playerId: 'b', input: done([]) },
      ],
    );
    expect(byPlayer.get('b')).toEqual([{ topic: 'stage', attemptNumber: null, fieldKey: null }]);
    expect(byPlayer.get('a')).toEqual([{ topic: 'device', attemptNumber: null, fieldKey: null }]);
    expect(byPlayer.get(null)).toEqual([{ topic: 'other', attemptNumber: null, fieldKey: null }]);
  });

  it('go back to the attempt and field of an entry, through the entry sent', () => {
    const byPlayer = issuesByPlayer(
      [
        { path: ['body', 'results', 0, 'entries', 1, 'split20S'], code: 'custom', message: 'x' },
        { path: ['body', 'results', 0, 'entries', 2, 'value'], code: 'custom', message: 'x' },
        { path: ['body', 'results', 0, 'entries', 3, 'flightTimeS'], code: 'custom', message: 'x' },
        { path: ['body', 'results', 0, 'entries', 9], code: 'custom', message: 'x' },
      ],
      [
        {
          playerId: 'a',
          input: done([
            { kind: 'sprint_splits', split20S: 3.1, split40S: 5.4, attemptNumber: 1 },
            { kind: 'sprint_splits', split20S: 3.1, split40S: 5.4, attemptNumber: 2 },
            { kind: 'value', metricCode: 'cod505_left_s', value: 2.4, attemptNumber: 3 },
            { kind: 'cmj_flight_time', flightTimeS: 0.5, attemptNumber: 2 },
          ]),
        },
      ],
    );
    expect(byPlayer.get('a')).toEqual([
      { topic: 'entries', attemptNumber: 2, fieldKey: 'split20S' },
      { topic: 'entries', attemptNumber: 3, fieldKey: 'cod505_left_s' },
      { topic: 'entries', attemptNumber: 2, fieldKey: 'flightTimeMsec' },
      { topic: 'entries', attemptNumber: null, fieldKey: null },
    ]);
  });
});

describe('not-done reasons as the viewer reads them', () => {
  it('shows injured as unavailable to every role but medical (ADR 0029)', () => {
    for (const role of ['coach', 'sc', 'admin', 'superadmin', 'player', 'parent'] as const) {
      expect(notDoneReasonView('injured', role)).toBe('unavailable');
      expect(notDoneReasonView('unavailable', role)).toBe('unavailable');
      expect(notDoneReasonView('absent', role)).toBe('absent');
    }
    expect(notDoneReasonView('injured', 'medical')).toBe('injured');
    expect(notDoneReasonView('unavailable', 'medical')).toBe('unavailable');
  });

  it('offers injured as «Lesionado/a» to medical and as «No disponible» to the rest', () => {
    expect(notDoneReasonOptions(true, 'medical')).toEqual([
      { reason: 'absent', view: 'absent' },
      { reason: 'injured', view: 'injured' },
      { reason: 'not_applicable_to_stage', view: 'not_applicable_to_stage' },
      { reason: 'other', view: 'other' },
    ]);
    for (const role of ['coach', 'sc', 'admin', 'superadmin'] as const) {
      const options = notDoneReasonOptions(true, role);
      expect(options).toContainEqual({ reason: 'injured', view: 'unavailable' });
      expect(options.map((o) => o.view)).not.toContain('injured');
    }
  });

  it('offers only «No corresponde a la etapa» to a player outside the battery', () => {
    for (const role of ['medical', 'sc'] as const) {
      expect(notDoneReasonOptions(false, role)).toEqual([
        { reason: 'not_applicable_to_stage', view: 'not_applicable_to_stage' },
      ]);
    }
  });
});
