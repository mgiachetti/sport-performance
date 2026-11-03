import {
  ALERT_RULE_KINDS,
  CANONICAL_METRIC_CODES,
  DEFAULT_ALERT_RULES,
  DEFAULT_POSITION_LINES,
  DEFAULT_SPEED_ZONE_SETS,
  STAGES,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webConfigurationMessagesEsAR } from './web-configuration.js';

describe('configuration screen messages', () => {
  it('are part of the source catalog under configuration.*', () => {
    for (const [key, message] of Object.entries(webConfigurationMessagesEsAR)) {
      expect(key.startsWith('configuration.'), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every default line and position of each sport', () => {
    for (const { sport, positionCode, lineCode } of DEFAULT_POSITION_LINES) {
      expect(isMessageKey(`configuration.line.${sport}.${lineCode}`), lineCode).toBe(true);
      expect(isMessageKey(`configuration.position.${sport}.${positionCode}`), positionCode).toBe(
        true,
      );
    }
  });

  it('name every stage, canonical metric, rule kind, rule parameter and default zone', () => {
    for (const stage of STAGES) expect(isMessageKey(`configuration.stage.${stage}`)).toBe(true);
    for (const code of CANONICAL_METRIC_CODES) {
      expect(isMessageKey(`configuration.metric.${code}`), code).toBe(true);
    }
    for (const kind of ALERT_RULE_KINDS) {
      expect(isMessageKey(`configuration.rules.kind.${kind}`), kind).toBe(true);
    }
    for (const rule of DEFAULT_ALERT_RULES) {
      for (const param of Object.keys(rule.params)) {
        expect(isMessageKey(`configuration.rules.param.${param}`), param).toBe(true);
      }
    }
    for (const set of Object.values(DEFAULT_SPEED_ZONE_SETS)) {
      for (const zone of set.zones) {
        expect(isMessageKey(`configuration.zone.${zone.code}`), zone.code).toBe(true);
      }
    }
  });
});
