/**
 * Minimal observable value for the app's client-side state (club selection,
 * connection, theme). React reads it with `useSyncExternalStore`; routes and
 * the API client read it synchronously, outside React.
 */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get = (): T => this.#value;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  protected set(next: T): void {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const listener of this.#listeners) listener();
  }
}

/** The subset of the Web Storage API the stores use (absent in private modes or tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Reads JSON from storage; anything unreadable is `undefined` (and never throws). */
export function readJson(storage: KeyValueStorage | null, key: string): unknown {
  if (storage === null) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** Writes JSON (or removes the key for `null`); storage errors (quota, disabled) are ignored. */
export function writeJson(storage: KeyValueStorage | null, key: string, value: unknown): void {
  if (storage === null) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience: the app keeps working with the in-memory value.
  }
}

/** `window.localStorage` / `sessionStorage`, or `null` when the browser blocks them. */
export function browserStorage(kind: 'local' | 'session'): KeyValueStorage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
