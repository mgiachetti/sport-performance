import { describe, expect, it } from 'vitest';
import { DEFAULT_CLUB_MODULES } from '../club-modules.js';
import { INJURY_BODY_REGIONS, INJURY_SIDES } from '../medical.js';
import {
  CENTRAL_PAIN_REGIONS,
  PAIN_AREAS_MAX,
  PAIN_BODY_REGIONS,
  PAIN_COMMENT_MAX_LENGTH,
  PAIN_SIDES,
  isPainBodyRegion,
  maxPainIntensity,
  painReportIssues,
  painReportModuleOn,
  painReportUnavailableReason,
  painSidesForRegion,
  parsePainSide,
  type PainArea,
} from './pain-report.js';

const knee: PainArea = { region: 'knee', side: 'left', intensity: 6 };

describe('pain report vocabulary', () => {
  it('is the injury vocabulary without `other`, so a report maps to an injury', () => {
    expect(PAIN_BODY_REGIONS).toEqual(INJURY_BODY_REGIONS.filter((r) => r !== 'other'));
    expect(isPainBodyRegion('other')).toBe(false);
    for (const side of PAIN_SIDES) expect(INJURY_SIDES).toContain(side);
    expect(() => parsePainSide('bilateral')).toThrow(/pain side/);
  });

  it('the midline is central, limbs and hips have a side', () => {
    for (const region of PAIN_BODY_REGIONS) {
      const sides = painSidesForRegion(region);
      expect(sides).toEqual(
        CENTRAL_PAIN_REGIONS.includes(region) ? ['central'] : ['left', 'right'],
      );
    }
    expect(painSidesForRegion('knee')).toEqual(['left', 'right']);
    expect(painSidesForRegion('lumbar_spine')).toEqual(['central']);
  });
});

describe('painReportIssues', () => {
  it('accepts no pain without areas, and pain with distinct valid areas', () => {
    expect(painReportIssues({ hasPain: false, areas: [] })).toEqual([]);
    expect(
      painReportIssues({
        hasPain: true,
        areas: [knee, { region: 'knee', side: 'right', intensity: 2 }],
        comment: 'Desde el partido',
      }),
    ).toEqual([]);
    expect(
      painReportIssues({
        hasPain: true,
        areas: [{ region: 'lumbar_spine', side: 'central', intensity: 10 }],
      }),
    ).toEqual([]);
  });

  it('pain needs areas, no pain takes none and no comment', () => {
    expect(painReportIssues({ hasPain: true, areas: [] })).toEqual([
      { path: ['areas'], problem: 'areas_required' },
    ]);
    expect(painReportIssues({ hasPain: false, areas: [knee], comment: 'x' })).toEqual([
      { path: ['areas'], problem: 'areas_without_pain' },
      { path: ['comment'], problem: 'comment_without_pain' },
    ]);
  });

  it('checks sides, intensity, repeats and the number of areas', () => {
    expect(
      painReportIssues({
        hasPain: true,
        areas: [
          { region: 'neck', side: 'left', intensity: 3 },
          { region: 'knee', side: 'central', intensity: 0 },
          { region: 'ankle', side: 'left', intensity: 2.5 },
          { region: 'ankle', side: 'left', intensity: 11 },
        ],
      }),
    ).toEqual([
      { path: ['areas', 0, 'side'], problem: 'side_not_for_region' },
      { path: ['areas', 1, 'side'], problem: 'side_not_for_region' },
      { path: ['areas', 1, 'intensity'], problem: 'intensity_out_of_range' },
      { path: ['areas', 2, 'intensity'], problem: 'intensity_out_of_range' },
      { path: ['areas', 3, 'intensity'], problem: 'intensity_out_of_range' },
      { path: ['areas', 3], problem: 'duplicate_area' },
    ]);
    const many = PAIN_BODY_REGIONS.flatMap((region) =>
      painSidesForRegion(region).map((side) => ({ region, side, intensity: 1 })),
    ).slice(0, PAIN_AREAS_MAX + 1);
    expect(painReportIssues({ hasPain: true, areas: many })).toEqual([
      { path: ['areas'], problem: 'too_many_areas' },
    ]);
  });

  it('a comment is short and not blank (counted in characters)', () => {
    expect(painReportIssues({ hasPain: true, areas: [knee], comment: '  ' })).toEqual([
      { path: ['comment'], problem: 'comment_blank' },
    ]);
    const emoji = '😣'.repeat(PAIN_COMMENT_MAX_LENGTH);
    expect(painReportIssues({ hasPain: true, areas: [knee], comment: emoji })).toEqual([]);
    expect(painReportIssues({ hasPain: true, areas: [knee], comment: `${emoji}x` })).toEqual([
      { path: ['comment'], problem: 'comment_too_long' },
    ]);
  });

  it('the highest intensity sorts the inbox', () => {
    expect(maxPainIntensity([])).toBe(0);
    expect(maxPainIntensity([knee, { intensity: 8 }, { intensity: 2 }])).toBe(8);
  });
});

describe('when the question is asked', () => {
  const on = { ...DEFAULT_CLUB_MODULES, pain_report: true };

  it('needs the pain report and the wellness modules', () => {
    expect(DEFAULT_CLUB_MODULES.pain_report).toBe(false);
    expect(painReportModuleOn(DEFAULT_CLUB_MODULES)).toBe(false);
    expect(painReportModuleOn(on)).toBe(true);
    expect(painReportModuleOn({ ...on, wellness: false })).toBe(false);
  });

  it('needs a data and a health consent', () => {
    expect(painReportUnavailableReason(DEFAULT_CLUB_MODULES, ['data', 'health'])).toBe(
      'module_off',
    );
    expect(painReportUnavailableReason(on, ['data'])).toBe('missing_consent');
    expect(painReportUnavailableReason(on, ['health'])).toBe('missing_consent');
    expect(painReportUnavailableReason(on, ['data', 'health'])).toBeNull();
  });
});
