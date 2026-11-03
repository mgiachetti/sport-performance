import {
  DEFAULT_POSITION_LINES,
  EXPOSURE_CONTEXTS,
  FIELD_METRIC_CODES,
  FIELD_METRIC_SOURCES,
  PARTICIPATION_STATUSES,
  RUGBY_LINE_CODES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webFieldSessionMessagesEsAR } from './web-field-session.js';

describe('field session messages', () => {
  it('are part of the source catalog under fieldSession.*, and nothing overrides them', () => {
    for (const [key, message] of Object.entries(webFieldSessionMessagesEsAR)) {
      expect(key, key).toMatch(/^fieldSession\./);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every field metric, source, session kind, participation and seeded position', () => {
    for (const code of FIELD_METRIC_CODES) {
      expect(isMessageKey(`fieldSession.metric.${code}`), code).toBe(true);
    }
    for (const source of FIELD_METRIC_SOURCES) {
      expect(isMessageKey(`fieldSession.source.${source}`), source).toBe(true);
    }
    for (const kind of EXPOSURE_CONTEXTS) {
      expect(isMessageKey(`fieldSession.kind.${kind}`), kind).toBe(true);
    }
    for (const status of PARTICIPATION_STATUSES) {
      expect(isMessageKey(`fieldSession.status.${status}`), status).toBe(true);
    }
    for (const { positionCode } of DEFAULT_POSITION_LINES) {
      expect(isMessageKey(`fieldSession.position.${positionCode}`), positionCode).toBe(true);
    }
    for (const line of RUGBY_LINE_CODES) {
      expect(isMessageKey(`fieldSession.line.${line}`), line).toBe(true);
    }
  });

  it('never call the accelerometer load "PlayerLoad"', () => {
    for (const message of Object.values(webFieldSessionMessagesEsAR)) {
      expect(message).not.toMatch(/player ?load/i);
    }
  });
});
