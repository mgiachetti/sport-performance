import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { mobileSprintVideoMessagesEsAR } from './mobile-sprint-video.js';

describe('sprint by video messages (B-605)', () => {
  const { t } = createTranslator();

  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(mobileSprintVideoMessagesEsAR)) {
      expect(key.startsWith('sprintVideo.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('say why a player is not filmed and what is wrong with the layout', () => {
    for (const block of [
      'missing_image_consent',
      'missing_data_consent',
      'forbidden',
      'not_applicable',
    ]) {
      expect(isMessageKey(`sprintVideo.block.${block}`), block).toBe(true);
    }
    for (const field of ['cameraDistance', 'poleOffset']) {
      for (const problem of ['invalid', 'out_of_range']) {
        expect(isMessageKey(`sprintVideo.setup.${field}.${problem}`), field).toBe(true);
      }
    }
    for (const mark of ['start', 'line10', 'line20', 'line40']) {
      expect(isMessageKey(`sprintVideo.mark.line.${mark}`), mark).toBe(true);
    }
  });

  it('format the attempts, the steps and the day', () => {
    expect(t('sprintVideo.player.attempts', { count: 0, planned: 3 })).toBe('Sin intentos de 3');
    expect(t('sprintVideo.player.attempts', { count: 1, planned: 3 })).toBe('1 intento de 3');
    expect(t('sprintVideo.mark.back', { count: 1 })).toBe('Retroceder 1 cuadro');
    expect(t('sprintVideo.mark.forward', { count: 60 })).toBe('Avanzar 60 cuadros');
    expect(t('sprintVideo.days.item', { date: '03/11/2026', place: 'none' })).toBe('03/11/2026');
    expect(t('sprintVideo.days.item', { date: '03/11/2026', place: 'Cancha 2' })).toBe(
      '03/11/2026 · Cancha 2',
    );
  });
});
