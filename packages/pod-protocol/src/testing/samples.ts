import type { Beacon } from '../downlink.js';
import type { LiveSummary } from '../uplink.js';

/** Sample values shared by the unit tests and the golden fixtures. */
export const SAMPLE_LIVE_SUMMARY: LiveSummary = {
  batteryPct: 87,
  vestOn: true,
  fixQuality: 'fix_3d',
  sessionDistanceDm: 41_235,
  speedBandDistancesM: [2_900, 850, 312, 61],
  accelerationsN: 23,
  decelerationsN: 19,
  accelLoadCentiAu: 31_415,
  impactsN: 7,
  seconds: [
    { vmaxCmS: 712, distanceDm: 68, positionDm: { xDm: 1_234, yDm: -567 } },
    { vmaxCmS: 745, distanceDm: 72, positionDm: { xDm: 1_302, yDm: -560 } },
  ],
  configVersion: 12,
};

export const SAMPLE_BEACON: Beacon = {
  networkId: 0x0a51,
  gnssTimeS: 1_446_000_000,
  keyId: 2,
  sessionOpen: true,
  ledMode: 'match',
  channelPlanId: 3,
  configVersion: 12,
  sessionSeq: 5,
  sessionTransitionGnssS: 1_445_998_200,
  grants: [
    { action: 'grant', podShortId: 23, channel: 3, slot: 7 },
    { action: 'release', podShortId: 41, channel: 0, slot: 15 },
  ],
};
