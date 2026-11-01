import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGE_BANDS,
  STAGES,
  STAGE_PROFILES,
  maximalLoadTestsAllowed,
  strengthAssessmentFor,
} from './index.js';

const band = (code: string) => {
  const found = DEFAULT_AGE_BANDS.find((b) => b.code === code);
  if (found === undefined) throw new Error(`missing ${code}`);
  return found;
};

describe('maximalLoadTestsAllowed (principle 3)', () => {
  it('never allows maximal loads for M13/M14, whatever the stage', () => {
    for (const code of ['m13', 'm14']) {
      for (const stage of STAGES) {
        expect(maximalLoadTestsAllowed(stage, band(code)), `${code} ${stage}`).toBe(false);
      }
    }
  });

  it('follows the stage from M15 on', () => {
    for (const code of ['m15', 'm16', 'm17', 'm19']) {
      for (const stage of STAGES) {
        expect(maximalLoadTestsAllowed(stage, band(code))).toBe(
          STAGE_PROFILES[stage].maximalLoadTests,
        );
      }
    }
  });
});

describe('strengthAssessmentFor', () => {
  it('downgrades a direct RM to an estimated RM for M13/M14', () => {
    expect(strengthAssessmentFor('performance', band('m14'))).toBe('estimated_rm');
    expect(strengthAssessmentFor('development', band('m13'))).toBe('estimated_rm');
    expect(strengthAssessmentFor('foundation', band('m13'))).toBe('technique_reps');
  });

  it('is the stage assessment when the band allows maximal loads', () => {
    expect(strengthAssessmentFor('performance', band('m16'))).toBe('direct_rm');
    expect(strengthAssessmentFor('performance', band('m17'))).toBe('direct_rm');
    expect(strengthAssessmentFor('development', band('m17'))).toBe('estimated_rm');
  });
});
