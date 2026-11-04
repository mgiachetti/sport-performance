import type { SprintVideoFiles } from '../sprint-video/recordings.ts';

/**
 * The directory of the sprint videos in memory (tests): `record` puts a
 * file where the camera would; `files` lists every path that exists.
 */
export function memorySprintVideoFiles(root = '/cache/sprint-videos') {
  const existing = new Set<string>();
  const directory: SprintVideoFiles = {
    root,
    list: () =>
      Promise.resolve(
        [...existing]
          .filter((path) => path.startsWith(`${root}/`))
          .map((path) => path.slice(root.length + 1)),
      ),
    adopt(from, name) {
      if (!existing.delete(from)) return Promise.reject(new Error(`${from} does not exist`));
      existing.add(`${root}/${name}`);
      return Promise.resolve();
    },
    remove(path) {
      existing.delete(path);
      return Promise.resolve();
    },
  };
  return {
    directory,
    record(path: string) {
      existing.add(path);
    },
    files: () => [...existing].sort(),
  };
}
