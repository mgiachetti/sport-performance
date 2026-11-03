import { CANONICAL_TEST_CODES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { protocolMessagesEsAR } from './protocols.js';
import { webHelpMessagesEsAR } from './web-help.js';

describe('help and protocol messages (B-415)', () => {
  it('are part of the source catalog and no other entry overrides them', () => {
    for (const [key, message] of Object.entries({
      ...protocolMessagesEsAR,
      ...webHelpMessagesEsAR,
    })) {
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('give every guide section a title and a body', () => {
    const sections = Object.keys(webHelpMessagesEsAR)
      .filter((key) => key.startsWith('help.guide.') && key.endsWith('.title'))
      .map((key) => key.slice('help.guide.'.length, -'.title'.length));
    expect(sections.length).toBeGreaterThan(4);
    for (const section of sections) {
      expect(isMessageKey(`help.guide.${section}.body`), section).toBe(true);
    }
  });

  it('name every canonical test', () => {
    for (const code of CANONICAL_TEST_CODES) expect(isMessageKey(`test.${code}`), code).toBe(true);
  });

  it('say how many attempts and which one counts', () => {
    const { t } = createTranslator();
    expect(t('protocol.attempts', { count: 3, aggregation: 'best' })).toBe(
      '3 intentos, vale el mejor',
    );
    expect(t('protocol.attempts', { count: 1, aggregation: 'mean' })).toBe(
      '1 intento, vale el promedio',
    );
  });
});
