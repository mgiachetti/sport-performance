import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdown, installProcessHandlers } from './shutdown.js';
import { fakeDatabase, recordingReporter, testApp } from './testing/support.js';

afterEach(() => {
  vi.useRealTimers();
});

async function setup(
  options: {
    close?: () => Promise<void>;
    timeoutMs?: number;
    register?: (app: FastifyInstance) => void;
  } = {},
) {
  const events: string[] = [];
  const db = fakeDatabase({
    close: async () => {
      events.push('db.close');
      await options.close?.();
    },
  });
  const { app, logs } = await testApp({
    db,
    ...(options.register && { register: options.register }),
  });
  app.addHook('onClose', () => {
    events.push('app.close');
    return Promise.resolve();
  });
  const reporter = recordingReporter();
  const flush = reporter.flush.bind(reporter);
  reporter.flush = (timeoutMs) => {
    events.push('flush');
    return flush(timeoutMs);
  };
  const exits: number[] = [];
  const shutdown = createShutdown({
    app,
    db,
    reporter,
    logger: logs.logger,
    timeoutMs: options.timeoutMs ?? 5000,
    exit: (code) => {
      events.push(`exit:${String(code)}`);
      exits.push(code);
    },
  });
  return { app, logs, events, exits, shutdown, reporter };
}

describe('createShutdown', () => {
  it('drains, closes the server, then the pool, flushes and exits 0', async () => {
    const { app, events, shutdown } = await setup();
    await shutdown('SIGTERM');
    expect(app.lifecycle.draining).toBe(true);
    expect(events).toEqual(['app.close', 'db.close', 'flush', 'exit:0']);
  });

  it('lets an in-flight request finish before closing the pool', async () => {
    let finish: (() => void) | undefined;
    const { app, events, shutdown } = await setup({
      register: (instance) => {
        instance.get('/slow', async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          events.push('request.done');
          return { ok: true };
        });
      },
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const pending = fetch(`${address}/slow`);
    await vi.waitFor(() => {
      expect(finish).toBeTypeOf('function');
    });
    const done = shutdown('SIGTERM');
    // The server is closing but still waits for the request in flight.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).not.toContain('db.close');
    expect(events).not.toContain('exit:0');
    finish?.();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('connection')).toBe('close');
    await done;
    expect(events.slice(events.indexOf('request.done'))).toEqual([
      'request.done',
      'db.close',
      'flush',
      'exit:0',
    ]);
  });

  it('exits 1 when closing fails', async () => {
    const { exits, shutdown, logs } = await setup({
      close: () => Promise.reject(new Error('pool stuck')),
    });
    await shutdown('SIGTERM');
    expect(exits).toEqual([1]);
    expect(logs.lines().some((line) => line.msg === 'error while shutting down')).toBe(true);
  });

  it('is idempotent', async () => {
    const { exits, shutdown } = await setup();
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(exits).toEqual([0]);
  });

  it('forces exit 1 after the timeout', async () => {
    vi.useFakeTimers();
    const { exits, shutdown } = await setup({
      close: () => new Promise(() => undefined),
      timeoutMs: 1000,
    });
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(exits).toEqual([1]);
  });
});

describe('installProcessHandlers', () => {
  it('shuts down with 0 on signals and with 1 on fatal errors, reporting them', async () => {
    const { logs, reporter } = await setup();
    const proc = new EventEmitter();
    const calls: [string, number | undefined][] = [];
    installProcessHandlers(
      proc,
      (reason, code) => {
        calls.push([reason, code]);
        return Promise.resolve();
      },
      logs.logger,
      reporter,
    );
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    const fatal = new Error('boom');
    proc.emit('uncaughtException', fatal);
    proc.emit('unhandledRejection', 'rejected');
    expect(calls).toEqual([
      ['SIGTERM', 0],
      ['SIGINT', 0],
      ['uncaughtException', 1],
      ['unhandledRejection', 1],
    ]);
    expect(reporter.captured.map((entry) => entry.context?.source)).toEqual([
      'uncaughtException',
      'unhandledRejection',
    ]);
    expect(logs.lines().filter((line) => line.level === 'fatal')).toHaveLength(2);
  });
});
