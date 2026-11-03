import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Platform } from 'react-native';
import type { SignalPlayer } from '../ift/signal-player.ts';
import {
  SIGNAL_SOUNDS,
  SIGNAL_TONES_VERSION,
  signalDurationMs,
  signalWav,
  silenceWav,
  type SignalSound,
} from '../ift/tones.ts';

const KEEP_AWAKE_TAG = 'ift3015';
/** After a sound ends it is rewound, ready for its next cue. */
const REWIND_AFTER_MS = 60;

/** The WAV in the cache, written again if missing or cut short (the app died mid-write). */
async function cachedWav(name: string, bytes: Uint8Array): Promise<File> {
  const file = new File(Paths.cache, `ift3015-${name}-v${String(SIGNAL_TONES_VERSION)}.wav`);
  if (!file.exists || file.size !== bytes.length) await file.write(bytes);
  return file;
}

/**
 * The signals on the phone (ADR 0070): each sound synthesized once into a
 * WAV in the cache and preloaded in its own `expo-audio` player, so a cue
 * only calls `play()`. While the test runs the screen stays on
 * (`expo-keep-awake`) and a silent loop keeps the audio session — and so the
 * app's timers — alive in the background: `UIBackgroundModes: audio` on iOS
 * (config plugin) and the media playback service on Android (lock-screen
 * controls, without which Android stops background audio after ~3 minutes).
 * Plays in silent mode; other apps' audio pauses while the test runs.
 */
export function createNativeSignalPlayer(options: {
  /** Shown on the lock screen and the Android notification (no player data). */
  readonly sessionTitle: string;
  readonly reportError: (error: unknown) => void;
}): SignalPlayer {
  const { reportError } = options;
  const players = new Map<SignalSound, AudioPlayer>();
  let keepAlive: AudioPlayer | null = null;
  let prepared: Promise<void> | null = null;
  let sessionActive = false;

  const load = async () => {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      allowsRecording: false,
    });
    for (const sound of SIGNAL_SOUNDS) {
      if (players.has(sound)) continue;
      const file = await cachedWav(sound, signalWav(sound));
      const player = createAudioPlayer({ uri: file.uri }, { keepAudioSessionActive: true });
      player.volume = 1;
      players.set(sound, player);
    }
    if (keepAlive === null) {
      const file = await cachedWav('silence', silenceWav());
      keepAlive = createAudioPlayer({ uri: file.uri }, { keepAudioSessionActive: true });
      keepAlive.loop = true;
    }
  };

  return {
    prepare() {
      prepared ??= load().catch((error: unknown) => {
        prepared = null;
        throw error;
      });
      return prepared;
    },

    async beginSession() {
      await this.prepare();
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      await setIsAudioActiveAsync(true);
      if (keepAlive !== null) {
        if (!sessionActive && Platform.OS === 'android') {
          // The media notification of the playback service needs it (Android 13+).
          await requestNotificationPermissionsAsync().catch(reportError);
          keepAlive.setActiveForLockScreen(true, { title: options.sessionTitle });
        }
        if (!keepAlive.playing) keepAlive.play();
      }
      sessionActive = true;
    },

    async endSession() {
      sessionActive = false;
      if (keepAlive !== null) {
        keepAlive.pause();
        if (Platform.OS === 'android') keepAlive.clearLockScreenControls();
      }
      await deactivateKeepAwake(KEEP_AWAKE_TAG);
      await setIsAudioActiveAsync(false);
    },

    play(sound) {
      const player = players.get(sound);
      if (player === undefined) return;
      try {
        player.play();
        setTimeout(
          () => {
            player.pause();
            player.seekTo(0).catch(reportError);
          },
          signalDurationMs(sound) + REWIND_AFTER_MS,
        );
      } catch (error) {
        reportError(error);
      }
    },
  };
}
