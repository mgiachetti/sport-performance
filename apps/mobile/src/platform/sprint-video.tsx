import { isSprintVideoFrameRate } from '@sport-performance/domain';
import { Directory, File, Paths } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';
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
import type { SprintVideoFiles } from '../sprint-video/recordings.ts';
import {
  SPRINT_VIDEO_MAX_DURATION_S,
  SPRINT_VIDEO_MAX_SIZE_BYTES,
  sprintCameraFrameRate,
} from '../sprint-video/camera.ts';
import type { SprintCameraProps, SprintFrameSource } from '../screens/sprint-video.tsx';

/**
 * The phone side of the sprint by video (B-605, ADR 0082): the high-speed
 * camera (`react-native-vision-camera`), the frames of a recording for the
 * marking (`expo-video-thumbnails` at the middle of each frame, patched on
 * Android to decode the exact frame instead of the nearest keyframe: see
 * `patches/`) and the
 * directory of the temporary recordings (`expo-file-system`). Not tested in
 * Node: the logic around it is (`src/sprint-video`).
 */

/** `file://` URI of a filesystem path (the camera hands out plain paths). */
function uriOf(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * The cache directory of the app: iOS never copies it to a backup and
 * Android's backups are off (`allowBackup: false`); the system may clear it
 * when the phone runs out of space.
 */
const root = new Directory(Paths.cache, 'sprint-videos').uri.replace(/\/$/, '');

export const nativeSprintVideoFiles: SprintVideoFiles = {
  root,
  list() {
    const dir = new Directory(root);
    return Promise.resolve(dir.exists ? dir.list().map((entry) => entry.name) : []);
  },
  async adopt(from, name) {
    new Directory(root).create({ intermediates: true, idempotent: true });
    await new File(uriOf(from)).move(new File(`${root}/${name}`), { overwrite: true });
  },
  remove(path) {
    const file = new File(uriOf(path));
    if (file.exists) file.delete();
    return Promise.resolve();
  },
};

/**
 * The image of a frame, from the recording: each call writes a JPEG to the
 * cache; the previous one is deleted, and the last one when the marking
 * ends (`release`).
 */
export function createNativeSprintFrameSource(): SprintFrameSource {
  let last: string | null = null;
  const drop = () => {
    if (last === null) return;
    const file = new File(last);
    if (file.exists) file.delete();
    last = null;
  };
  return {
    async frameAt(videoPath, timeMs) {
      const { uri } = await getThumbnailAsync(uriOf(videoPath), {
        time: Math.round(timeMs),
        quality: 0.8,
      });
      drop();
      last = uri;
      return uri;
    },
    release() {
      drop();
      return Promise.resolve();
    },
  };
}

/**
 * The high-speed camera: back camera, no audio, the frame rate of the
 * sprint (`sprintCameraFrameRate`, 120 fps at least), 1080p and the
 * orientation of the phone (it films lying sideways on its tripod). The
 * frame rate the session negotiated is the one stored with the attempt.
 */
export function NativeSprintCamera({ recording, onRecorded, onState }: SprintCameraProps) {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const frameRate = useMemo(
    () => (device === undefined ? null : sprintCameraFrameRate(device.supportedFPSRanges)),
    [device],
  );
  const video = useVideoOutput({
    targetResolution: { width: 1920, height: 1080 },
    enableAudio: false,
    fileType: 'mp4',
  });
  const [selectedFps, setSelectedFps] = useState<number | null>(null);
  const recorder = useRef<Recorder | null>(null);
  /** A recording is being created or runs: never two at once. */
  const busy = useRef(false);
  const startedAt = useRef(0);
  /** Seconds of video the recorder had when it was asked to stop. */
  const recordedS = useRef(0);
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
      (selectedFps !== null && !isSprintVideoFrameRate(selectedFps))
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
      maxDuration: SPRINT_VIDEO_MAX_DURATION_S,
      maxFileSize: SPRINT_VIDEO_MAX_SIZE_BYTES,
    });
    recorder.current = created;
    startedAt.current = Date.now();
    recordedS.current = 0;
    await created.startRecording(
      (filePath, reason) => {
        recorder.current = null;
        busy.current = false;
        // The duration of the video itself (the recorder reports 0 once it
        // finished): what it had at the stop, or the limit it reached; the
        // wall clock only when neither is known.
        const durationS =
          reason === 'max-duration-reached' ? SPRINT_VIDEO_MAX_DURATION_S : recordedS.current;
        onRecorded({
          path: filePath,
          durationMs: durationS > 0 ? durationS * 1000 : Date.now() - startedAt.current,
          frameRateFps: selectedFps ?? frameRate ?? 0,
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
      recordedS.current = recorder.current.recordedDuration;
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
      // The phone lies sideways on its tripod: the video follows it, the app stays upright.
      orientationSource="device"
    />
  );
}
