/**
 * The videos of the sprint by video (B-605, ADR 0082) are temporary: they
 * are images of minors that never leave the phone. A recording waits in a
 * directory of its own in the app's cache (out of backups) only while the
 * evaluator marks it, and is deleted when the attempt is saved or
 * discarded, when the user or the club changes and when the app starts
 * (one left by a crash). What stays are the frames of the attempt.
 */

/** The files of the directory, behind an interface (`expo-file-system` on the phone). */
export interface SprintVideoFiles {
  /** Absolute path of the directory of the recordings. */
  readonly root: string;
  /** Names of the files in `root` (none when it does not exist). */
  list(): Promise<string[]>;
  /** Moves a file into `root` with `name` (creating the directory). */
  adopt(from: string, name: string): Promise<void>;
  /** Deletes a file; nothing when it is not there. */
  remove(path: string): Promise<void>;
}

export interface SprintRecordings {
  /**
   * Takes a recording of the camera into the directory, named after the
   * attempt; returns its new path. The camera's own file is gone after it.
   */
  adopt(cameraPath: string, attemptId: string): Promise<string>;
  /** Deletes a recording (saved or discarded). */
  discard(path: string): Promise<void>;
  /** Deletes every recording in the directory (start of the app, change of user or club). */
  sweep(): Promise<void>;
}

const EXTENSION = /\.(mp4|mov)$/i;

export function createSprintRecordings(files: SprintVideoFiles): SprintRecordings {
  const pathOf = (name: string) => `${files.root}/${name}`;
  return {
    async adopt(cameraPath, attemptId) {
      const extension = EXTENSION.exec(cameraPath)?.[1]?.toLowerCase() ?? 'mp4';
      const name = `${attemptId}.${extension}`;
      await files.adopt(cameraPath, name);
      return pathOf(name);
    },
    async discard(path) {
      // Only files of the directory: a path from elsewhere is never deleted here.
      if (!path.startsWith(`${files.root}/`) || path.slice(files.root.length + 1).includes('/')) {
        return;
      }
      await files.remove(path);
    },
    async sweep() {
      for (const name of await files.list()) await files.remove(pathOf(name));
    },
  };
}
