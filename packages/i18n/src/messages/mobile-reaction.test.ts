import { REACTION_OUTCOMES, REACTION_STIMULI, REACTION_TASKS } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { createTranslator, esAR, isMessageKey } from '../index.js';
import { mobileReactionMessagesEsAR } from './mobile-reaction.js';

describe('reaction test messages', () => {
  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(mobileReactionMessagesEsAR)) {
      expect(key.startsWith('reaction.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every task, stimulus and outcome', () => {
    for (const task of REACTION_TASKS) {
      expect(isMessageKey(`reaction.task.${task}`), task).toBe(true);
      expect(isMessageKey(`reaction.intro.${task}`), task).toBe(true);
      expect(isMessageKey(`reaction.notes.${task}`), task).toBe(true);
    }
    for (const stimulus of REACTION_STIMULI) {
      expect(isMessageKey(`reaction.stimulus.${stimulus}`), stimulus).toBe(true);
    }
    for (const outcome of REACTION_OUTCOMES) {
      expect(isMessageKey(`reaction.feedback.${outcome}`), outcome).toBe(true);
    }
  });

  it('write the errors of a series in words', () => {
    const { t } = createTranslator();
    expect(
      t('reaction.notes.go_no_go', { commissions: 1, noGo: 4, anticipations: 0, lapses: 2 }),
    ).toBe('Go/no-go: 1 error de comisión en 4 no-go, 0 anticipaciones, 2 sin respuesta.');
  });
});
