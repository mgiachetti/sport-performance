import { isUuid, type ClubId } from '@sport-performance/domain';
import pg from 'pg';
import type { Logger } from 'pino';

/** Channel the outbox triggers notify on commit (migration 0021). Payload: the club id. */
export const DERIVED_REFRESH_CHANNEL = 'sport_performance_derived_refresh';

export interface RefreshListenerOptions {
  /** A `sport_performance_worker` login. */
  readonly connectionString: string;
  readonly logger: Logger;
  /** Called once per club per debounce window. Errors are logged, never thrown. */
  readonly onClub: (clubId: ClubId) => Promise<void>;
  /** Notifications of a club within this window become one call. */
  readonly debounceMs?: number;
  readonly minReconnectMs?: number;
  readonly maxReconnectMs?: number;
}

export interface RefreshListener {
  /** Resolves once listening (or after the first failed attempt; it keeps retrying). */
  readonly ready: Promise<void>;
  readonly stop: () => Promise<void>;
}

/**
 * Low-latency path of "recalculate on every write": a dedicated connection
 * that `LISTEN`s to the outbox notifications and enqueues a job per club. It
 * reconnects with backoff when the connection drops. Correctness never
 * depends on it: the sweep job finds every pending mark within a minute even
 * if notifications are lost while the worker is down or reconnecting.
 */
export function startRefreshListener(options: RefreshListenerOptions): RefreshListener {
  const debounceMs = options.debounceMs ?? 250;
  const minReconnectMs = options.minReconnectMs ?? 1000;
  const maxReconnectMs = options.maxReconnectMs ?? 30_000;
  const logger = options.logger.child({ component: 'refresh-listener' });
  const timers = new Map<ClubId, NodeJS.Timeout>();
  let client: pg.Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let delayMs = minReconnectMs;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const fire = (clubId: ClubId) => {
    timers.delete(clubId);
    options.onClub(clubId).catch((error: unknown) => {
      logger.error({ err: error, clubId }, 'enqueueing a notified club failed');
    });
  };

  const schedule = () => {
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
    reconnectTimer.unref();
    delayMs = Math.min(delayMs * 2, maxReconnectMs);
  };

  const connect = async () => {
    const next = new pg.Client({
      connectionString: options.connectionString,
      application_name: 'sport-performance-worker-listener',
      keepAlive: true,
    });
    next.on('error', (error) => {
      logger.warn({ err: error }, 'listener connection failed; reconnecting');
      if (client === next) client = null;
      next.end().catch(() => undefined);
      schedule();
    });
    next.on('end', () => {
      if (client === next) {
        client = null;
        schedule();
      }
    });
    next.on('notification', (message) => {
      if (message.channel !== DERIVED_REFRESH_CHANNEL || !isUuid(message.payload)) return;
      const clubId = message.payload as ClubId;
      if (timers.has(clubId)) return;
      const timer = setTimeout(() => {
        fire(clubId);
      }, debounceMs);
      timer.unref();
      timers.set(clubId, timer);
    });
    try {
      await next.connect();
      await next.query(`listen ${DERIVED_REFRESH_CHANNEL}`);
      if (stopped) {
        await next.end();
        return;
      }
      client = next;
      delayMs = minReconnectMs;
      logger.info('listening for derived refresh notifications');
    } catch (error) {
      logger.warn({ err: error }, 'listener could not connect; retrying');
      await next.end().catch(() => undefined);
      schedule();
    } finally {
      resolveReady();
    }
  };

  void connect();

  return {
    ready,
    stop: async () => {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const current = client;
      client = null;
      await current?.end().catch(() => undefined);
    },
  };
}
