import { describe, expect, it } from 'vitest';
import { createTranslator } from '../translator.js';
import { esAR, isMessageKey } from './index.js';
import { mobileCmjVideoMessagesEsAR } from './mobile-cmj-video.js';

describe('CMJ by video messages (B-604)', () => {
  const { t } = createTranslator();

  it('are part of the source catalog under their own prefix', () => {
    for (const [key, message] of Object.entries(mobileCmjVideoMessagesEsAR)) {
      expect(key.startsWith('cmjVideo.'), key).toBe(true);
      expect(isMessageKey(key), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('say why a player is not filmed and why a video did not go up', () => {
    for (const block of [
      'missing_image_consent',
      'missing_data_consent',
      'forbidden',
      'not_applicable',
    ]) {
      expect(isMessageKey(`cmjVideo.block.${block}`), block).toBe(true);
    }
    for (const failure of ['consent', 'voided', 'rejected', 'too_large', 'missing_file']) {
      expect(isMessageKey(`cmjVideo.uploads.failed.${failure}`), failure).toBe(true);
    }
  });

  it('format the marks, the attempts and the day', () => {
    expect(t('cmjVideo.mark.takeoffAt', { frame: 'none' })).toBe('Despegue: sin marcar');
    expect(t('cmjVideo.mark.landingAt', { frame: '131' })).toBe('Aterrizaje: cuadro 131');
    expect(t('cmjVideo.player.attempts', { count: 0, planned: 3 })).toBe('Sin intentos de 3');
    expect(t('cmjVideo.player.attempts', { count: 2, planned: 3 })).toBe('2 intentos de 3');
    expect(t('cmjVideo.record.protocol', { count: 3 })).toContain('3 intentos con pausa.');
    expect(t('cmjVideo.record.protocol', { count: 1 })).toContain('cintura; 1 intento.');
    expect(t('cmjVideo.days.item', { date: '03/11/2026', place: 'none' })).toBe('03/11/2026');
    expect(t('cmjVideo.days.item', { date: '03/11/2026', place: 'Cancha 2' })).toBe(
      '03/11/2026 · Cancha 2',
    );
    expect(t('cmjVideo.uploads.count', { count: 1 })).toBe('1 video esperando para subir');
  });
});
