import { SYNC_OPERATION_INPUTS, type PainReportForm } from '@sport-performance/contracts';
import {
  PAIN_AREAS_MAX,
  PAIN_BODY_REGIONS,
  painReportIssues,
  painSidesForRegion,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  BODY_MAP_HEIGHT,
  BODY_MAP_VIEWS,
  BODY_MAP_WIDTH,
  bodyMapAreas,
  bodyMapPlaces,
} from './body-map.ts';
import {
  EMPTY_PAIN_DRAFT,
  answer,
  draftProblem,
  intensityBand,
  painReportMutation,
  setComment,
  setIntensity,
  togglePlace,
} from './draft.ts';
import { painQuestionState } from './question.ts';

const CLIENT_UUID = '0b8f7a8e-5d0c-4c2e-9d55-6c1f3c1b2a10';

describe('body map', () => {
  it('draws every area of the vocabulary, each with the sides of its region', () => {
    const areas = bodyMapAreas();
    const expected = PAIN_BODY_REGIONS.flatMap((region) =>
      painSidesForRegion(region).map((side) => `${region}:${side}`),
    );
    expect([...areas.keys()].sort()).toEqual([...expected].sort());
  });

  it('keeps every place inside the map and never two places on top of each other', () => {
    for (const view of BODY_MAP_VIEWS) {
      const places = bodyMapPlaces(view);
      for (const place of places) {
        expect(place.x).toBeGreaterThanOrEqual(0);
        expect(place.y).toBeGreaterThanOrEqual(0);
        expect(place.x + place.w).toBeLessThanOrEqual(BODY_MAP_WIDTH);
        expect(place.y + place.h).toBeLessThanOrEqual(BODY_MAP_HEIGHT);
      }
      for (const [i, a] of places.entries()) {
        for (const b of places.slice(i + 1)) {
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${view}: ${a.key} / ${b.key}`).toBe(false);
        }
      }
    }
  });

  it("the front faces us: the player's right is on the left of the screen", () => {
    const front = bodyMapPlaces('front');
    const back = bodyMapPlaces('back');
    const knee = (places: typeof front, side: string) =>
      places.find((place) => place.key === `knee:${side}`)?.x ?? -1;
    expect(knee(front, 'right')).toBeLessThan(knee(front, 'left'));
    expect(knee(back, 'left')).toBeLessThan(knee(back, 'right'));
  });

  it('reads top to bottom, then left to right', () => {
    const places = bodyMapPlaces('front');
    expect(places[0]?.key).toBe('head_face:central');
    const ys = places.map((place) => place.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});

describe('draft', () => {
  it('no is one tap and sends no areas', () => {
    const marked = togglePlace(EMPTY_PAIN_DRAFT, 'knee', 'left');
    const no = answer(setComment(marked, 'algo'), false);
    expect(no).toEqual({ hasPain: false, areas: [], comment: '' });
    expect(draftProblem(no)).toBeNull();
    expect(painReportMutation(no, { clientUuid: CLIENT_UUID })).toEqual({
      body: { clientUuid: CLIENT_UUID, hasPain: false, areas: [] },
    });
  });

  it('a yes needs areas, each with its intensity', () => {
    let draft = answer(EMPTY_PAIN_DRAFT, true);
    expect(draftProblem(EMPTY_PAIN_DRAFT)).toBe('no_answer');
    expect(draftProblem(draft)).toBe('no_areas');
    draft = togglePlace(draft, 'knee', 'left');
    draft = togglePlace(draft, 'lumbar_spine', 'central');
    expect(draftProblem(draft)).toBe('missing_intensity');
    draft = setIntensity(draft, 'knee:left', 7);
    draft = setIntensity(draft, 'lumbar_spine:central', 2);
    draft = setComment(draft, '  Desde el sábado  ');
    expect(draftProblem(draft)).toBeNull();
    const mutation = painReportMutation(draft, {
      clientUuid: CLIENT_UUID,
      localDate: '2026-11-03',
    });
    expect(mutation).toEqual({
      body: {
        clientUuid: CLIENT_UUID,
        localDate: '2026-11-03',
        hasPain: true,
        areas: [
          { region: 'knee', side: 'left', intensity: 7 },
          { region: 'lumbar_spine', side: 'central', intensity: 2 },
        ],
        comment: 'Desde el sábado',
      },
    });
    // The same contract the server checks, and the domain rules.
    expect(SYNC_OPERATION_INPUTS['pain_report.submit'].safeParse(mutation).success).toBe(true);
    expect(painReportIssues({ ...mutation.body, areas: mutation.body.areas ?? [] })).toEqual([]);
  });

  it('toggles an area off, and stops at the most areas of a report', () => {
    const on = togglePlace(EMPTY_PAIN_DRAFT, 'foot', 'right');
    expect(on.hasPain).toBe(true);
    expect(togglePlace(on, 'foot', 'right').areas).toEqual([]);
    let draft = answer(EMPTY_PAIN_DRAFT, true);
    const places = PAIN_BODY_REGIONS.flatMap((region) =>
      painSidesForRegion(region).map((side) => [region, side] as const),
    );
    for (const [region, side] of places) draft = togglePlace(draft, region, side);
    expect(draft.areas).toHaveLength(PAIN_AREAS_MAX);
  });

  it('refuses to build a mutation that cannot be sent', () => {
    expect(() =>
      painReportMutation(answer(EMPTY_PAIN_DRAFT, true), { clientUuid: CLIENT_UUID }),
    ).toThrow(/no_areas/);
    const long = setComment(
      setIntensity(togglePlace(EMPTY_PAIN_DRAFT, 'knee', 'left'), 'knee:left', 3),
      'x'.repeat(281),
    );
    expect(draftProblem(long)).toBe('comment_too_long');
  });

  it('names each intensity with a word too', () => {
    expect([1, 3, 4, 6, 7, 10].map(intensityBand)).toEqual([
      'mild',
      'mild',
      'moderate',
      'moderate',
      'severe',
      'severe',
    ]);
  });
});

describe('whether to ask', () => {
  const form = (enabled: boolean): PainReportForm => ({
    playerId: '8c4b1f7e-3a2d-4e6f-9b1a-2c3d4e5f6a7b' as PainReportForm['playerId'],
    localDate: '2026-11-03' as PainReportForm['localDate'],
    enabled,
    unavailableReason: enabled ? null : 'missing_consent',
    latest: null,
  });

  it("takes today's form first, then the kept profile, else waits for a connection", () => {
    expect(painQuestionState({ form: form(true), failed: false, profileAsks: false })).toEqual({
      kind: 'ask',
    });
    expect(painQuestionState({ form: form(false), failed: false, profileAsks: true })).toEqual({
      kind: 'unavailable',
      reason: 'missing_consent',
    });
    // Without signal, the profile kept on the phone says yes.
    expect(painQuestionState({ form: undefined, failed: true, profileAsks: true })).toEqual({
      kind: 'ask',
    });
    expect(painQuestionState({ form: undefined, failed: false, profileAsks: undefined })).toEqual({
      kind: 'loading',
    });
    expect(painQuestionState({ form: undefined, failed: false, profileAsks: false })).toEqual({
      kind: 'loading',
    });
    expect(painQuestionState({ form: undefined, failed: true, profileAsks: false })).toEqual({
      kind: 'needs_connection',
    });
    expect(painQuestionState({ form: undefined, failed: true, profileAsks: undefined })).toEqual({
      kind: 'needs_connection',
    });
  });
});
