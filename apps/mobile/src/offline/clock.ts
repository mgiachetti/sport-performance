import {
  HLC_NODE_PATTERN,
  formatHlc,
  parseHlc,
  receiveHlc,
  tickHlc,
  type Hlc,
} from '@sport-performance/domain';
import { eq } from 'drizzle-orm';
import type { LocalDb } from './db/database.ts';
import { deviceMeta } from './db/schema.ts';

const NODE_KEY = 'hlc.node';
const LAST_KEY = 'hlc.last';

/**
 * The device's hybrid logical clock (ADR 0015, ADR 0050), persisted in the
 * local database so it never goes back across launches, also when the
 * phone's time does. The node is random per installation (32 hex: a UUID
 * without dashes), not the session `deviceId`, and it is not personal: it
 * survives signing out.
 */
export interface DeviceClock {
  /** Stamps a local event; inside the transaction that stores it. */
  tick(db: LocalDb): Promise<string>;
  /** Moves the clock past a clock the server answered (`serverHlc`). */
  receive(db: LocalDb, remote: string): Promise<void>;
}

async function readMeta(db: LocalDb, key: string): Promise<string | null> {
  const [row] = await db.select().from(deviceMeta).where(eq(deviceMeta.key, key));
  return row?.value ?? null;
}

async function writeMeta(db: LocalDb, key: string, value: string): Promise<void> {
  await db
    .insert(deviceMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: deviceMeta.key, set: { value } });
}

export function createDeviceClock(options: {
  readonly now: () => number;
  readonly randomUUID: () => string;
}): DeviceClock {
  async function node(db: LocalDb): Promise<string> {
    const stored = await readMeta(db, NODE_KEY);
    if (stored !== null && HLC_NODE_PATTERN.test(stored)) return stored;
    const fresh = options.randomUUID().replaceAll('-', '').toLowerCase();
    if (!HLC_NODE_PATTERN.test(fresh)) throw new Error('randomUUID did not return a UUID');
    await writeMeta(db, NODE_KEY, fresh);
    return fresh;
  }

  async function last(db: LocalDb): Promise<Hlc | null> {
    const stored = await readMeta(db, LAST_KEY);
    if (stored === null) return null;
    try {
      return parseHlc(stored);
    } catch {
      return null;
    }
  }

  return {
    async tick(db) {
      const next = tickHlc(await last(db), options.now(), await node(db));
      const text = formatHlc(next);
      await writeMeta(db, LAST_KEY, text);
      return text;
    },
    async receive(db, remote) {
      const next = receiveHlc(await last(db), parseHlc(remote), options.now(), await node(db));
      await writeMeta(db, LAST_KEY, formatHlc(next));
    },
  };
}
