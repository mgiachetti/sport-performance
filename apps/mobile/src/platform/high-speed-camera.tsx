import { requireNativeModule, requireNativeView } from 'expo';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Platform, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import {
  highSpeedCandidates,
  isConfigurationFailure,
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
  /** No candidates: no high-speed session reaches the minimum (or not Android): VisionCamera films. */
  | { readonly status: 'done'; readonly candidates: readonly HighSpeedConfig[] };

/**
 * What the high-speed session may film at on this phone, in order: on
 * Android, the back cameras, sizes and fixed rates of `highSpeedCandidates`
 * (the first, then the fallbacks); elsewhere, or when the phone lists no
 * high-speed range that reaches the minimum, none (VisionCamera films, and
 * says when it cannot).
 */
export function useHighSpeedPlan(request: HighSpeedRequest): HighSpeedPlan {
  const [plan, setPlan] = useState<HighSpeedPlan>(
    Platform.OS === 'android' ? { status: 'checking' } : { status: 'done', candidates: [] },
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
          candidates: highSpeedCandidates(list, {
            minFps,
            preferredFps,
            targetWidth,
            targetHeight,
          }),
        });
      })
      .catch(() => {
        if (current) setPlan({ status: 'done', candidates: [] });
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
  /** The session or the recorder refused this size or rate (`isConfigurationFailure`). */
  readonly onConfigurationFailed?: (error: HighSpeedCameraError) => void;
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
  onConfigurationFailed,
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
        const error = new HighSpeedCameraError(code, message);
        if (onConfigurationFailed !== undefined && isConfigurationFailure(code)) {
          onConfigurationFailed(error);
          return;
        }
        onState(code === 'permission' ? { status: 'no_permission' } : { status: 'error', error });
      }}
    />
  );
}

export type HighSpeedOrVisionCameraProps = Omit<
  HighSpeedTestCameraProps,
  'config' | 'onConfigurationFailed'
> & {
  readonly request: HighSpeedRequest;
  /** The VisionCamera of the test: when there is no candidate, or all of them failed. */
  readonly vision: ReactNode;
};

/**
 * The camera of a test on this phone (ADR 0102): the high-speed session
 * with the first candidate; if the session or the recorder refuses it, the
 * next one (a smaller size, then 120 fps), and VisionCamera when none is
 * left. A failure while recording stops the recording (`error`, which the
 * screen shows until the next candidate is ready); one while opening only
 * keeps the camera preparing.
 */
export function HighSpeedOrVisionCamera({
  request,
  vision,
  onState,
  recording,
  ...camera
}: HighSpeedOrVisionCameraProps) {
  const plan = useHighSpeedPlan(request);
  const [index, setIndex] = useState(0);
  if (plan.status === 'checking') return <View style={{ flex: 1 }} />;
  const config = plan.candidates[index];
  if (config === undefined) return vision;
  return (
    <HighSpeedTestCamera
      key={`${config.cameraId}:${String(config.width)}x${String(config.height)}@${String(config.fps)}`}
      {...camera}
      config={config}
      recording={recording}
      onState={onState}
      onConfigurationFailed={(error) => {
        onState(recording ? { status: 'error', error } : { status: 'preparing' });
        setIndex((current) => current + 1);
      }}
    />
  );
}
