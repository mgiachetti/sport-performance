import { requireNativeModule } from 'expo';
import { File } from 'expo-file-system';
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
  UIImagePickerPreferredAssetRepresentationMode,
  VideoExportPreset,
} from 'expo-image-picker';
import { Platform } from 'react-native';
import { videoContentType, type VideoTimingInfo } from '../video/imported.ts';

/**
 * A slow-motion video from the gallery (ADR 0102): the system picker
 * (`expo-image-picker`; the Photo Picker on Android, no storage permission)
 * copies the file into the cache untouched, and the app's `CmjFrames`
 * module (`modules/cmj-frames`, `inspect`) reads its frame times and its
 * capture rate. Whether it can be marked is decided in Node-tested code
 * (`src/video/imported.ts`).
 */

interface VideoInspectorModule {
  inspect(uri: string): Promise<{
    frameTimesUs: number[];
    sampleCount: number;
    durationMs: number;
    nominalFps?: number;
    captureFps?: number;
    sizeBytes?: number;
  }>;
}

let inspector: VideoInspectorModule | null = null;
function inspectorModule(): VideoInspectorModule {
  inspector ??= requireNativeModule<VideoInspectorModule>('CmjFrames');
  return inspector;
}

export interface PickedVideo {
  /** The copy in the cache (`file://`): the test adopts it or deletes it. */
  readonly path: string;
  readonly contentType: string | null;
  readonly info: VideoTimingInfo;
}

function uriOf(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Deletes a picked copy that is not going to be used. */
export function discardPickedVideo(path: string): void {
  const file = new File(uriOf(path));
  if (file.exists) file.delete();
}

/**
 * Lets the evaluator pick a video and reads its timing; `null` when the
 * picker was closed without one.
 */
export async function pickSlowMotionVideo(): Promise<PickedVideo | null> {
  if (Platform.OS === 'ios') {
    // With access to the library the picker copies the original file (the
    // slow-motion capture as filmed), not a version rendered for playback.
    // Without it, it still picks: the timing check decides.
    await requestMediaLibraryPermissionsAsync(false).catch(() => null);
  }
  const result = await launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
    videoExportPreset: VideoExportPreset.Passthrough,
    preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  const path = asset.uri;
  try {
    const read = await inspectorModule().inspect(uriOf(path));
    return {
      path,
      contentType: videoContentType(asset.mimeType ?? null, path),
      info: {
        frameTimesUs: read.frameTimesUs,
        sampleCount: read.sampleCount,
        durationMs: read.durationMs,
        nominalFps: read.nominalFps ?? null,
        captureFps: read.captureFps ?? null,
        sizeBytes: read.sizeBytes ?? asset.fileSize ?? null,
      },
    };
  } catch (error) {
    discardPickedVideo(path);
    throw error;
  }
}
