import { DEFAULT_POSITION_LINES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webPanelMessagesEsAR } from './web-panel.js';

describe('weekly panel messages', () => {
  it('are part of the source catalog, under `panel.`, and no other entry overrides them', () => {
    for (const [key, message] of Object.entries(webPanelMessagesEsAR)) {
      expect(key.startsWith('panel.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every default position', () => {
    for (const { positionCode } of DEFAULT_POSITION_LINES) {
      expect(isMessageKey(`panel.position.${positionCode}`), positionCode).toBe(true);
    }
  });
});
