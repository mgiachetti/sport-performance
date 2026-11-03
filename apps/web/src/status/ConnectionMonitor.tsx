import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isConnected } from '../api/connection';
import { useServices, useStore } from '../app/services';

/** Seconds between `/v1/health` probes while the API does not answer. */
export const HEALTH_PROBE_INTERVAL_MS = 10_000;

/**
 * Keeps the connection store and TanStack Query's `onlineManager` in step
 * (ADR 0056): queries and mutations pause while the browser is offline *or*
 * the API does not answer, and resume when it does. While unreachable, it
 * probes `/v1/health` (any answer marks the API reachable again).
 */
export function ConnectionMonitor() {
  const { api, connection } = useServices();
  const state = useStore(connection);

  useEffect(() => connection.attach(window), [connection]);

  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      setOnline(isConnected(connection.get()));
      return connection.subscribe(() => {
        setOnline(isConnected(connection.get()));
      });
    });
  }, [connection]);

  const probing = state.browserOnline && !state.apiReachable;
  useEffect(() => {
    if (!probing) return;
    const timer = window.setInterval(() => {
      api.getHealth().catch(() => undefined);
    }, HEALTH_PROBE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [api, probing]);

  return null;
}
