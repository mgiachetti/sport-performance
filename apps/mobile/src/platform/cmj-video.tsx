import {
  CMJ_VIDEO_MIN_FPS,
  CMJ_VIDEO_PREFERRED_FPS,
  FILE_KIND_POLICIES,
  isCmjVideoFrameRate,
} from '@sport-performance/domain';
import { requireNativeModule } from 'expo';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useVideoOutput,
  type CameraSessionConfig,
  type Recorder,
} from 'react-native-vision-camera';
import type { VideoFileSystem } from '../cmj-video/captures.ts';
import { hexToBase64 } from '../cmj-video/digest.ts';
import type { CmjVideoPlatform } from '../cmj-video/service.ts';
import { CMJ_VIDEO_MAX_DURATION_S, cmjCameraFrameRate } from '../cmj-video/camera.ts';
import type { CmjCameraProps, FrameSource } from '../screens/cmj-video.tsx';
import { HighSpeedOrVisionCamera } from './high-speed-camera.tsx';

/**
 * The phone side of the CMJ by video (B-604, ADR 0085): the high-speed
 * camera (`react-native-vision-camera`), the exact frames and the duration
 * of a recording for the marking (the app's own `CmjFrames` module in
 * `modules/cmj-frames`, at the middle of each frame) and the files and the
 * upload (`expo-file-system`, SHA-256 computed natively). Not tested in
 * Node: the logic around it is (`src/cmj-video`).
 */

/**
 * `modules/cmj-frames`: the frame at an exact time, never the nearest key
 * frame (Android `MediaMetadataRetriever` with `OPTION_CLOSEST`, iOS
 * `AVAssetImageGenerator` with zero tolerances), and the duration from the
 * file's metadata.
 */
interface CmjFramesNativeModule {
  durationMs(uri: string): Promise<number>;
  frameAt(uri: string, timeMs: number, quality: number): Promise<string>;
  release(): Promise<void>;
}

let cmjFrames: CmjFramesNativeModule | null = null;
function cmjFramesModule(): CmjFramesNativeModule {
  cmjFrames ??= requireNativeModule<CmjFramesNativeModule>('CmjFrames');
  return cmjFrames;
}

/** Duration of a recording from its metadata (not the time the camera ran). */
export function recordingDurationMs(path: string): Promise<number> {
  return cmjFramesModule().durationMs(uriOf(path));
}

/** `file://` URI of a filesystem path (the camera hands out plain paths). */
function uriOf(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function ensureDirectory(path: string): void {
  new Directory(uriOf(path)).create({ intermediates: true, idempotent: true });
}

/**
 * The videos live in the app's cache directory, which iOS never copies to a
 * backup (they are images of minors, ADR 0044); the system may clear it when
 * the phone runs out of space, and then the capture says the file is gone
 * (the attempt stays).
 */
const root = new Directory(Paths.cache, 'cmj-videos').uri.replace(/\/$/, '');

const files: VideoFileSystem = {
  root,
  list(directory) {
    const dir = new Directory(uriOf(directory));
    return Promise.resolve(dir.exists ? dir.list().map((entry) => entry.name) : []);
  },
  async readText(path) {
    const file = new File(uriOf(path));
    return file.exists ? file.text() : null;
  },
  async writeText(path, text) {
    ensureDirectory(parentOf(path));
    const temporary = new File(uriOf(`${path}.tmp`));
    await temporary.write(text);
    await temporary.move(new File(uriOf(path)), { overwrite: true });
  },
  async move(from, to) {
    ensureDirectory(parentOf(to));
    await new File(uriOf(from)).move(new File(uriOf(to)), { overwrite: true });
  },
  remove(path) {
    const file = new File(uriOf(path));
    if (file.exists) {
      file.delete();
      return Promise.resolve();
    }
    const dir = new Directory(uriOf(path));
    if (dir.exists) dir.delete();
    return Promise.resolve();
  },
};

export const nativeCmjVideoPlatform: CmjVideoPlatform = {
  files,
  transfer: {
    async digest(path) {
      const file = new File(uriOf(path));
      return { checksumSha256: hexToBase64(await file.digest('SHA-256')), sizeBytes: file.size };
    },
    async put({ url, headers, path }) {
      const result = await new File(uriOf(path)).upload(url, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { ...headers },
        // Keeps going if the evaluator locks the phone or changes app.
        sessionType: 'background',
      });
      return result.status;
    },
    exists: (path) => Promise.resolve(new File(uriOf(path)).exists),
  },
};

/**
 * The image of a frame, from the recording: each call writes a JPEG to the
 * cache; the previous one is deleted, and the last one when the marking
 * ends (`release`).
 */
export function createNativeFrameSource(): FrameSource {
  let last: string | null = null;
  const drop = () => {
    if (last === null) return;
    const file = new File(last);
    if (file.exists) file.delete();
    last = null;
  };
  return {
    async frameAt(videoPath, timeMs) {
      const uri = await cmjFramesModule().frameAt(uriOf(videoPath), timeMs, 0.7);
      drop();
      last = uri;
      return uri;
    },
    async release() {
      drop();
      await cmjFramesModule().release();
    },
  };
}

/** What the CMJ asks of a high-speed session: 240 fps (120 at least) at 720p. */
const CMJ_HIGH_SPEED = {
  minFps: CMJ_VIDEO_MIN_FPS,
  preferredFps: CMJ_VIDEO_PREFERRED_FPS,
  targetWidth: 1280,
  targetHeight: 720,
} as const;

/**
 * The high-speed camera of the CMJ. On Android, the app's own constrained
 * high-speed session (ADR 0102) whenever the phone
 * lists one that reaches 120 fps: it is the only way Android films at 120 or
 * 240 fps for an app; a size or rate the phone refuses falls back to the
 * next one, then to VisionCamera (`HighSpeedOrVisionCamera`). Elsewhere (iOS,
 * or an Android phone without it), VisionCamera, which says when the phone
 * cannot.
 */
export function NativeCmjCamera(props: CmjCameraProps) {
  return (
    <HighSpeedOrVisionCamera
      request={CMJ_HIGH_SPEED}
      vision={<VisionCmjCamera {...props} />}
      recording={props.recording}
      maxDurationS={CMJ_VIDEO_MAX_DURATION_S}
      maxFileSizeBytes={FILE_KIND_POLICIES.cmj_video.maxSizeBytes}
      // As the app shows it (portrait): the phone stands still on its tripod.
      orientation="interface"
      isEnough={isCmjVideoFrameRate}
      onState={props.onState}
      onRecorded={(video) => {
        props.onRecorded({ ...video, contentType: 'video/mp4' });
      }}
    />
  );
}

/**
 * VisionCamera: back camera, no audio, the frame rate of the CMJ
 * (`cmjCameraFrameRate`, 120 fps at least) and a recording that stops alone
 * after a few seconds. The frame rate the session negotiated is the one
 * stored with the attempt.
 */
function VisionCmjCamera({ recording, onRecorded, onState }: CmjCameraProps) {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const frameRate = useMemo(
    () => (device === undefined ? null : cmjCameraFrameRate(device.supportedFPSRanges)),
    [device],
  );
  const video = useVideoOutput({
    targetResolution: { width: 1280, height: 720 },
    enableAudio: false,
    fileType: 'mp4',
  });
  const [selectedFps, setSelectedFps] = useState<number | null>(null);
  const recorder = useRef<Recorder | null>(null);
  /** A recording is being created or runs: never two at once. */
  const busy = useRef(false);
  const asked = useRef(false);
  const { hasPermission, canRequestPermission, requestPermission } = permission;

  useEffect(() => {
    // Asked once per visit; a refusal is answered by the state below.
    if (hasPermission || !canRequestPermission || asked.current) return;
    asked.current = true;
    requestPermission().catch(() => {
      onState({ status: 'no_permission' });
    });
  }, [hasPermission, canRequestPermission, requestPermission, onState]);

  useEffect(() => {
    if (!hasPermission && !canRequestPermission) {
      onState({ status: 'no_permission' });
    } else if (
      (device !== undefined && frameRate === null) ||
      (selectedFps !== null && !isCmjVideoFrameRate(selectedFps))
    ) {
      // The camera, or what the session settled on, is under the minimum frame rate.
      onState({ status: 'unsupported' });
    } else if (hasPermission && selectedFps !== null) {
      onState({ status: 'ready', frameRateFps: selectedFps });
    }
  }, [hasPermission, canRequestPermission, device, frameRate, selectedFps, onState]);

  const start = useCallback(async () => {
    busy.current = true;
    const created = await video.createRecorder({
      maxDuration: CMJ_VIDEO_MAX_DURATION_S,
      maxFileSize: FILE_KIND_POLICIES.cmj_video.maxSizeBytes,
    });
    recorder.current = created;
    await created.startRecording(
      (filePath) => {
        recorder.current = null;
        // The frames the file holds come from its own duration, not from the time the camera ran.
        recordingDurationMs(filePath)
          .then((durationMs) => {
            busy.current = false;
            onRecorded({
              path: filePath,
              // Android always records MP4; iOS too with `fileType: 'mp4'`.
              contentType: 'video/mp4',
              durationMs,
              frameRateFps: selectedFps ?? frameRate ?? 0,
            });
          })
          .catch((error: unknown) => {
            busy.current = false;
            onState({ status: 'error', error });
          });
      },
      (error) => {
        recorder.current = null;
        busy.current = false;
        onState({ status: 'error', error });
      },
    );
  }, [video, onRecorded, onState, selectedFps, frameRate]);

  useEffect(() => {
    if (recording && !busy.current) {
      start().catch((error: unknown) => {
        busy.current = false;
        onState({ status: 'error', error });
      });
    } else if (!recording && recorder.current?.isRecording === true) {
      recorder.current.stopRecording().catch((error: unknown) => {
        onState({ status: 'error', error });
      });
    }
  }, [recording, start, onState]);

  if (device === undefined || frameRate === null || !hasPermission) {
    return <View style={{ flex: 1 }} />;
  }
  return (
    <Camera
      style={{ flex: 1 }}
      isActive
      device={device}
      outputs={[video]}
      constraints={[{ fps: frameRate }]}
      onSessionConfigSelected={(config: CameraSessionConfig) => {
        setSelectedFps(config.selectedFPS ?? frameRate);
      }}
      onError={(error) => {
        onState({ status: 'error', error });
      }}
      // As the app shows it (portrait): the phone stands still on its tripod.
      orientationSource="interface"
    />
  );
}
