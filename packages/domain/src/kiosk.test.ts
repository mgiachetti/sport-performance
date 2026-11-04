import { describe, expect, it } from 'vitest';
import {
  KIOSK_RPE_STATES,
  REPORT_CHANNELS,
  isKioskRpeState,
  isReportChannel,
  reportChannelOf,
} from './kiosk.js';

describe('report channels', () => {
  it('maps the stored flag to its channel', () => {
    expect(reportChannelOf(false)).toBe('player_account');
    expect(reportChannelOf(true)).toBe('kiosk');
    expect(REPORT_CHANNELS.every((c) => isReportChannel(c))).toBe(true);
    expect(isReportChannel('staff')).toBe(false);
  });

  it('names the kiosk RPE states', () => {
    expect(KIOSK_RPE_STATES).toEqual(['pending', 'reported', 'not_taking_part']);
    expect(isKioskRpeState('open')).toBe(false);
  });
});
