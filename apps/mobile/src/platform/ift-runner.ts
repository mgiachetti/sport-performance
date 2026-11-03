import { randomUUID } from 'expo-crypto';
import { createIftRunner, type IftRunner } from '../ift/runner.ts';
import type { AppServices } from '../state/services.ts';
import { createNativeSignalPlayer } from './signal-audio.ts';

let instance: IftRunner | null = null;

/**
 * The one 30-15 IFT runner of the process (ADR 0070): it outlives the
 * screen, so leaving it mid-test (another tab, the background) never stops
 * the signals. The clock is `performance.now()` (monotonic); the wall clock
 * only anchors a run restored after the app was killed.
 */
export function iftRunner(services: AppServices): IftRunner {
  instance ??= createIftRunner({
    clock: { now: () => performance.now() },
    wallClock: () => Date.now(),
    timers: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    },
    audio: createNativeSignalPlayer({
      sessionTitle: services.translator.t('ift.lockScreen'),
      reportError: services.reportError,
    }),
    store: services.iftRunStore,
    randomUUID,
    reportError: services.reportError,
  });
  return instance;
}
