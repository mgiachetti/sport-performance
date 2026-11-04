import { createHash } from 'node:crypto';
import type { VideoFileSystem } from '../cmj-video/captures.ts';
import type { CmjVideoPlatform } from '../cmj-video/service.ts';
import type { VideoTransfer } from '../cmj-video/uploader.ts';

/**
 * The file system and the transfer of the CMJ videos in memory, for tests:
 * paths are keys, directories exist through what they hold. `put` records
 * every upload and answers what `answerPut` says.
 */
export interface MemoryVideoPlatform extends CmjVideoPlatform {
  readonly entries: Map<string, string | Uint8Array>;
  readonly puts: { url: string; headers: Readonly<Record<string, string>>; path: string }[];
  /** Status of the next `PUT`s (default 200); an `Error` simulates no answer. */
  answerPut: (request: { url: string; path: string }) => number | Error;
  /** Writes a recording where the camera would leave it. */
  record(path: string, bytes?: Uint8Array): void;
}

export function memoryVideoPlatform(root = '/cache/cmj-videos'): MemoryVideoPlatform {
  const entries = new Map<string, string | Uint8Array>();
  const puts: MemoryVideoPlatform['puts'] = [];
  const childrenOf = (directory: string) => {
    const prefix = `${directory}/`;
    const names = new Set<string>();
    for (const path of entries.keys()) {
      if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0] ?? '');
    }
    names.delete('');
    return [...names].sort();
  };
  const files: VideoFileSystem = {
    root,
    list: (directory) => Promise.resolve(childrenOf(directory)),
    readText(path) {
      const value = entries.get(path);
      return Promise.resolve(typeof value === 'string' ? value : null);
    },
    writeText(path, text) {
      entries.set(path, text);
      return Promise.resolve();
    },
    move(from, to) {
      const value = entries.get(from);
      if (value === undefined) return Promise.reject(new Error(`No such file: ${from}`));
      entries.delete(from);
      entries.set(to, value);
      return Promise.resolve();
    },
    remove(path) {
      entries.delete(path);
      for (const key of [...entries.keys()]) if (key.startsWith(`${path}/`)) entries.delete(key);
      return Promise.resolve();
    },
  };
  const platform: MemoryVideoPlatform = {
    entries,
    puts,
    files,
    answerPut: () => 200,
    record(path, bytes = new TextEncoder().encode(`video ${path}`)) {
      entries.set(path, bytes);
    },
    transfer: {
      digest(path) {
        const value = entries.get(path);
        if (value === undefined) return Promise.reject(new Error(`No such file: ${path}`));
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
        return Promise.resolve({
          checksumSha256: createHash('sha256').update(bytes).digest('base64'),
          sizeBytes: bytes.length,
        });
      },
      put(request) {
        puts.push({ ...request });
        const answer = platform.answerPut(request);
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      exists: (path) => Promise.resolve(entries.has(path)),
    } satisfies VideoTransfer,
  };
  return platform;
}
