import { isUuid, type ClubId } from '@sport-performance/domain';
import pg from 'pg';
import type { Logger } from 'pino';

/** Channel the outbox triggers notify on commit (migration 0021). Payload: the club id. */
export const DERIVED_REFRESH_CHANNEL = 'sport_performance_derived_refresh';
/** Channel a new player report notifies on commit (migration 0036, B-602). Payload: the club id. */
export const PLAYER_REPORT_CHANNEL = 'sport_performance_player_report';
/** Channel of the requests of a CSV export (migration 0037, ADR 0072). Payload: the club id. */
export const DATA_EXPORT_CHANNEL = 'sport_performance_data_export';

export interface RefreshListenerOptions {
  /** A `sport_performance_worker` login. */
  readonly connectionString: string;
  readonly logger: Logger;
  /** Called once per club per debounce window. Errors are logged, never thrown. */
  readonly onClub: (clubId: ClubId) => Promise<void>;
  /** Called for a club with a new player report; without it the channel is not listened to. */
  readonly onReportClub?: (clubId: ClubId) => Promise<void>;
  /** Called for a club with a new CSV export request; without it the channel is not listened to. */
  readonly onExportClub?: (clubId: ClubId) => Promise<void>;
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
  /** Pending calls by `<channel>:<club>`. */
  const timers = new Map<string, NodeJS.Timeout>();
  const handlers = new Map<string, (clubId: ClubId) => Promise<void>>([
    [DERIVED_REFRESH_CHANNEL, options.onClub],
    ...(options.onReportClub === undefined
      ? []
      : [[PLAYER_REPORT_CHANNEL, options.onReportClub] as const]),
    ...(options.onExportClub === undefined
      ? []
      : [[DATA_EXPORT_CHANNEL, options.onExportClub] as const]),
  ]);
  let client: pg.Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let delayMs = minReconnectMs;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const fire = (channel: string, clubId: ClubId) => {
    timers.delete(`${channel}:${clubId}`);
    const handler = handlers.get(channel);
    if (handler === undefined) return;
    handler(clubId).catch((error: unknown) => {
      logger.error({ err: error, clubId, channel }, 'enqueueing a notified club failed');
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
      if (!handlers.has(message.channel) || !isUuid(message.payload)) return;
      const clubId = message.payload as ClubId;
      const key = `${message.channel}:${clubId}`;
      if (timers.has(key)) return;
      const timer = setTimeout(() => {
        fire(message.channel, clubId);
      }, debounceMs);
      timer.unref();
      timers.set(key, timer);
    });
    try {
      await next.connect();
      for (const channel of handlers.keys()) await next.query(`listen ${channel}`);
      if (stopped) {
        await next.end();
        return;
      }
      client = next;
      delayMs = minReconnectMs;
      logger.info({ channels: [...handlers.keys()] }, 'listening for notifications');
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
