import {
  ALERT_RULE_KINDS,
  DEFAULT_ALERT_RULES,
  SEXES,
  addDays,
  alertMessageKey,
  alertSuggestionKey,
  evaluateAlertRules,
  parseLocalDate,
  type AlertMessageKey,
  type AlertSuggestionKey,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR } from './es-AR.js';
import { messageKeys, type MessageKey, type MessageValues } from './index.js';
import { extractArguments } from './validate.js';

/** Compile-time check: every alert key of the domain is a message key of the catalog. */
const asMessageKey = (key: AlertMessageKey | AlertSuggestionKey): MessageKey => key;

const ALERT_KEYS = ALERT_RULE_KINDS.flatMap((kind) => [
  asMessageKey(alertMessageKey(kind)),
  asMessageKey(alertSuggestionKey(kind)),
]);

describe('alert texts (B-207)', () => {
  it('has exactly a message and a suggestion per domain rule kind', () => {
    const catalogAlertKeys = messageKeys.filter((k) => k.startsWith('alert.'));
    expect([...catalogAlertKeys].sort()).toEqual([...ALERT_KEYS].sort());
  });

  it('interpolates only values the engine provides, for every kind', () => {
    const day = parseLocalDate('2026-06-15');
    // Once per sex: the growth rules are scoped by sex (B-804), so each sex fires its own.
    const highDays = SEXES.map((sex) =>
      evaluateAlertRules(DEFAULT_ALERT_RULES, {
        date: day,
        sex,
        acwr: { ratio: 1.6, historyDays: 40 },
        wellness: [
          ...Array.from({ length: 14 }, (_, i) => ({
            date: addDays(day, i - 14),
            meanScore: i % 2 === 0 ? 4 : 5,
          })),
          { date: day, meanScore: 2 },
        ],
        cmj: {
          measurements: [
            { date: addDays(day, -21), heightCm: 40 },
            { date: addDays(day, -14), heightCm: 40 },
            { date: addDays(day, -7), heightCm: 40 },
            { date: day, heightCm: 30 },
          ],
        },
        growth: { velocityCmYear: 9, measuredOn: day },
      }),
    );
    const lowDay = evaluateAlertRules(DEFAULT_ALERT_RULES, {
      date: day,
      acwr: { ratio: 0.5, historyDays: 40 },
    });
    const alerts = [...highDays.flatMap((d) => d.alerts), ...lowDay.alerts];
    expect(highDays.map((d) => d.alerts.filter((a) => a.kind === 'growth_peak').length)).toEqual(
      SEXES.map(() => 1),
    );
    expect(new Set(alerts.map((a) => a.kind))).toEqual(new Set(ALERT_RULE_KINDS));

    // The keys are a runtime union here, so widen `t` to its untyped form.
    const translate = createTranslator({ locale: 'es-AR' }).t as (
      key: MessageKey,
      values?: MessageValues,
    ) => string;
    for (const alert of alerts) {
      for (const key of [alert.messageKey, alert.suggestionKey]) {
        for (const name of extractArguments(esAR[key]).keys()) {
          expect(alert.values, `${key} → ${name}`).toHaveProperty(name);
        }
        const values = Object.fromEntries(
          Object.entries(alert.values).map(([name, value]) => [name, value.toFixed(2)]),
        );
        expect(translate(key, values), key).not.toMatch(/[{}]/);
      }
    }
  });
});
