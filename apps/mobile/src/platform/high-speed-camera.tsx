import { requireNativeModule, requireNativeView } from 'expo';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Platform, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import {
  chooseHighSpeedConfig,
  recordedFrameRate,
  type HighSpeedCamera,
  type HighSpeedConfig,
  type HighSpeedRequest,
} from '../video/high-speed.ts';

/**
 * High-speed recording on Android (ADR 0102): the app's own
 * `HighSpeedCamera` module (`modules/high-speed-camera`, Kotlin), a
 * constrained high-speed session of Camera2 with a preview and an MP4
 * recorder. VisionCamera reads only the normal frame-rate ranges of CameraX,
 * which stop at 30 or 60 fps on phones like the Galaxy S24 Ultra; Android
 * gives 120 and 240 fps to other apps only through this session. iOS keeps
 * VisionCamera (AVFoundation lists its high-speed formats). Not tested in
 * Node: the choice of what to film at is (`src/video/high-speed.ts`).
 */

interface HighSpeedCameraNativeModule {
  getCameras(): Promise<HighSpeedCamera[]>;
}

/** The camera says what it does; the same shape as the CMJ's and the sprint's. */
export type HighSpeedCameraState =
  | { readonly status: 'preparing' }
  | { readonly status: 'ready'; readonly frameRateFps: number }
  | { readonly status: 'no_permission' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'error'; readonly error: unknown };

export interface HighSpeedRecording {
  readonly path: string;
  readonly durationMs: number;
  readonly frameRateFps: number;
}

interface NativeProps extends ViewProps {
  readonly cameraId: string;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly fps: number;
  readonly previewMinFps: number;
  readonly maxDurationMs: number;
  readonly maxFileSizeBytes: number;
  readonly orientation: 'interface' | 'device';
  readonly active: boolean;
  readonly recording: boolean;
  readonly onReady: (event: NativeSyntheticEvent<{ fps: number }>) => void;
  readonly onRecorded: (
    event: NativeSyntheticEvent<{
      path: string;
      durationMs: number;
      frameRateFps: number;
      measuredFps: number;
    }>,
  ) => void;
  readonly onError: (event: NativeSyntheticEvent<{ code: string; message: string }>) => void;
}

let nativeModule: HighSpeedCameraNativeModule | null = null;
let nativeView: ComponentType<NativeProps> | null = null;

function highSpeedModule(): HighSpeedCameraNativeModule {
  nativeModule ??= requireNativeModule<HighSpeedCameraNativeModule>('HighSpeedCamera');
  return nativeModule;
}

function HighSpeedCameraNativeView(props: NativeProps) {
  nativeView ??= requireNativeView<NativeProps>('HighSpeedCamera');
  const Native = nativeView;
  return <Native {...props} />;
}

/** The cameras are listed once per app run: they do not change. */
let cameras: Promise<HighSpeedCamera[]> | null = null;

export class HighSpeedCameraError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'HighSpeedCameraError';
    this.code = code;
  }
}

export type HighSpeedPlan =
  | { readonly status: 'checking' }
  /** `config: null`: no high-speed session reaches the minimum (or not Android): VisionCamera films. */
  | { readonly status: 'done'; readonly config: HighSpeedConfig | null };

/**
 * What the high-speed session films at on this phone: on Android, the
 * back camera, size and fixed rate of `chooseHighSpeedConfig`; elsewhere,
 * or when the phone lists no high-speed range that reaches the minimum,
 * `null` (VisionCamera films, and says when it cannot).
 */
export function useHighSpeedPlan(request: HighSpeedRequest): HighSpeedPlan {
  const [plan, setPlan] = useState<HighSpeedPlan>(
    Platform.OS === 'android' ? { status: 'checking' } : { status: 'done', config: null },
  );
  const { minFps, preferredFps, targetWidth, targetHeight } = request;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let current = true;
    cameras ??= highSpeedModule()
      .getCameras()
      .catch(() => {
        cameras = null;
        return [];
      });
    cameras
      .then((list) => {
        if (!current) return;
        setPlan({
          status: 'done',
          config: chooseHighSpeedConfig(list, { minFps, preferredFps, targetWidth, targetHeight }),
        });
      })
      .catch(() => {
        if (current) setPlan({ status: 'done', config: null });
      });
    return () => {
      current = false;
    };
  }, [minFps, preferredFps, targetWidth, targetHeight]);
  return plan;
}

export interface HighSpeedTestCameraProps {
  readonly config: HighSpeedConfig;
  readonly recording: boolean;
  readonly maxDurationS: number;
  readonly maxFileSizeBytes: number;
  /** `interface`: the video as the app shows it (CMJ); `device`: as the phone lies (sprint). */
  readonly orientation: 'interface' | 'device';
  /** Whether a frame rate is enough for the test. */
  readonly isEnough: (fps: number) => boolean;
  readonly onRecorded: (video: HighSpeedRecording) => void;
  readonly onState: (state: HighSpeedCameraState) => void;
}

/**
 * The high-speed camera of a test: asks for the camera permission once,
 * shows the preview and records at the fixed rate of `config`; the frame
 * rate handed back is what the file holds (`recordedFrameRate`).
 */
export function HighSpeedTestCamera({
  config,
  recording,
  maxDurationS,
  maxFileSizeBytes,
  orientation,
  isEnough,
  onRecorded,
  onState,
}: HighSpeedTestCameraProps) {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const asked = useRef(false);

  useEffect(() => {
    // Asked once per visit; a refusal is answered by the state below.
    if (hasPermission || !canRequestPermission || asked.current) return;
    asked.current = true;
    requestPermission().catch(() => {
      onState({ status: 'no_permission' });
    });
  }, [hasPermission, canRequestPermission, requestPermission, onState]);

  useEffect(() => {
    if (!hasPermission && !canRequestPermission) onState({ status: 'no_permission' });
  }, [hasPermission, canRequestPermission, onState]);

  if (!hasPermission) return <View style={{ flex: 1 }} />;
  return (
    <HighSpeedCameraNativeView
      style={{ flex: 1 }}
      cameraId={config.cameraId}
      videoWidth={config.width}
      videoHeight={config.height}
      fps={config.fps}
      previewMinFps={config.previewMinFps}
      maxDurationMs={maxDurationS * 1000}
      maxFileSizeBytes={maxFileSizeBytes}
      orientation={orientation}
      active
      recording={recording}
      onReady={(event) => {
        onState({ status: 'ready', frameRateFps: event.nativeEvent.fps });
      }}
      onRecorded={(event) => {
        const { path, durationMs, frameRateFps, measuredFps } = event.nativeEvent;
        const fps = recordedFrameRate(frameRateFps, measuredFps > 0 ? measuredFps : null);
        if (!isEnough(fps)) {
          // The camera ran under the minimum: the file cannot be measured.
          const file = new File(path.startsWith('file://') ? path : `file://${path}`);
          if (file.exists) file.delete();
          onState({ status: 'unsupported' });
          return;
        }
        onRecorded({ path, durationMs, frameRateFps: fps });
      }}
      onError={(event) => {
        const { code, message } = event.nativeEvent;
        onState(
          code === 'permission'
            ? { status: 'no_permission' }
            : { status: 'error', error: new HighSpeedCameraError(code, message) },
        );
      }}
    />
  );
}
