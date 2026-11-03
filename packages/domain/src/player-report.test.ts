import { describe, expect, it } from 'vitest';
import {
  PLAYER_REPORT_STATUSES,
  changeIsImprovement,
  isPlayerReportFailureCode,
  parsePlayerReportStatus,
  relativeChangePct,
} from './player-report.js';

describe('player report (B-602)', () => {
  it('has a closed set of statuses', () => {
    expect(PLAYER_REPORT_STATUSES).toEqual(['pending', 'ready', 'failed']);
    expect(parsePlayerReportStatus('ready')).toBe('ready');
    expect(() => parsePlayerReportStatus('done')).toThrow();
    expect(isPlayerReportFailureCode('render_failed')).toBe(true);
    expect(isPlayerReportFailureCode('boom')).toBe(false);
  });

  it('computes the relative change only against a usable previous value', () => {
    expect(relativeChangePct(33, 30)).toBeCloseTo(10);
    expect(relativeChangePct(-1, -2)).toBeCloseTo(50);
    expect(relativeChangePct(5, null)).toBeNull();
    expect(relativeChangePct(5, 0)).toBeNull();
  });

  it('tells an improvement by the direction of the metric', () => {
    expect(changeIsImprovement('higher_is_better', 35, 33)).toBe(true);
    expect(changeIsImprovement('higher_is_better', 31, 33)).toBe(false);
    expect(changeIsImprovement('lower_is_better', 3.1, 3.2)).toBe(true);
    expect(changeIsImprovement('lower_is_better', 3.3, 3.2)).toBe(false);
    expect(changeIsImprovement('neutral', 3.3, 3.2)).toBeNull();
    expect(changeIsImprovement('higher_is_better', 3, 3)).toBeNull();
  });
});
