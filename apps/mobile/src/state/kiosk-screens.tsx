import {
  ApiNetworkError,
  type ApiClient,
  type KioskRosterPage,
} from '@sport-performance/contracts';
import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/error-message.ts';
import { ROSTER_PAGE_LIMIT, fetchAllPages } from '../ift/roster.ts';
import type { KioskCategory, KioskConfig } from '../kiosk/controller.ts';
import { kioskLocalFacts, kioskRpeRequest, kioskWellnessRequest } from '../kiosk/local.ts';
import {
  NO_LOCAL_FACTS,
  kioskPlayers,
  kioskToday,
  rosterSnapshot,
  type KioskPlayer,
  type KioskRosterSnapshot,
} from '../kiosk/roster.ts';
import { syncScopeOf } from '../offline/session-binding.ts';
import type { CachedValue } from '../offline/read-cache.ts';
import {
  KioskExitScreen,
  KioskPickScreen,
  KioskSetupScreen,
  KioskTurn,
} from '../screens/kiosk.tsx';
import type { LoadState } from '../screens/ift-3015.tsx';
import { useTranslator } from '../ui/i18n.tsx';
import { useApi, useNow, useServices, useSession } from './app-context.tsx';
import { useLocalRead } from './offline-reads.ts';

/**
 * The kiosk mode (B-504, ADR 0086): containers that fetch and keep the
 * rosters, read what the device queued or pulled, and write through the
 * offline queue. The screens of `src/screens/kiosk.tsx` only render.
 */

/** Key of the kept roster of a category (`cached_read.key`): one read per category. */
export function kioskRosterKey(categoryId: string): string {
  return `kiosk.roster.${categoryId}`;
}

/** How often the kiosk refreshes its rosters while it has signal. */
const ROSTER_REFRESH_MS = 5 * 60_000;

/** Every page of a category's kiosk roster, as one snapshot. */
export async function fetchKioskRoster(
  api: ApiClient,
  categoryId: string,
  signal?: AbortSignal,
): Promise<KioskRosterSnapshot> {
  const pages: KioskRosterPage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await api.getKioskRoster(
      {
        params: { categoryId },
        query: { limit: ROSTER_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      },
      signal === undefined ? undefined : { signal },
    );
    pages.push(result);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return rosterSnapshot(categoryId, pages, Date.now());
}

/** The setup of the kiosk, opened from Inicio by the staff. */
export function KioskSetup({ onCancel }: { readonly onCancel: () => void }) {
  const api = useApi();
  const services = useServices();
  const state = useSession();
  const translator = useTranslator();
  const scope = syncScopeOf(state);
  const membershipId = scope?.membershipId ?? null;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ['club', membershipId, 'kiosk', 'categories'],
    enabled: scope !== null,
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCategories(
          {
            query: {
              status: 'active',
              limit: ROSTER_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
  const categoryState: LoadState<readonly KioskCategory[]> =
    categories.data !== undefined
      ? { status: 'ready', data: categories.data.map((c) => ({ id: c.id, name: c.name })) }
      : categories.isError
        ? { status: 'error', message: errorMessage(categories.error, 'generic', translator) }
        : { status: 'loading' };

  const start = (categoryIds: readonly string[], pin: string) => {
    if (scope === null || categoryState.status !== 'ready') return;
    const chosen = categoryState.data.filter((c) => categoryIds.includes(c.id));
    setStarting(true);
    setError(null);
    void (async () => {
      try {
        // The rosters first: a kiosk that opens has what it needs without signal.
        for (const category of chosen) {
          const snapshot = await fetchKioskRoster(api, category.id);
          await services.readCache.put(
            scope,
            kioskRosterKey(category.id),
            snapshot,
            snapshot.fetchedAt,
          );
        }
        await services.kiosk.start(scope, chosen, pin);
      } catch (cause) {
        if (!(cause instanceof ApiNetworkError)) services.reportError(cause);
        setError(
          cause instanceof ApiNetworkError
            ? translator.t('kiosk.setup.needsConnection')
            : translator.t('kiosk.setup.loadError'),
        );
        setStarting(false);
      }
    })();
  };

  return (
    <KioskSetupScreen
      categories={categoryState}
      starting={starting}
      error={error}
      onStart={start}
      onCancel={onCancel}
    />
  );
}

/** The rosters of the kiosk: the kept ones at once, refreshed from the API with signal. */
function useKioskRosters(config: KioskConfig): {
  readonly snapshots: readonly KioskRosterSnapshot[];
  readonly kept: boolean;
  readonly loading: boolean;
  readonly error: unknown;
} {
  const api = useApi();
  const services = useServices();
  const { membershipId, userId } = config.scope;
  const kept = useQueries({
    queries: config.categories.map((category) => ({
      queryKey: ['club', membershipId, 'kiosk', 'kept', category.id],
      queryFn: () =>
        services.readCache.get<KioskRosterSnapshot>(membershipId, kioskRosterKey(category.id)),
      staleTime: Infinity,
    })),
  });
  const live = useQueries({
    queries: config.categories.map((category) => ({
      queryKey: ['club', membershipId, 'kiosk', 'live', category.id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const snapshot = await fetchKioskRoster(api, category.id, signal);
        await services.readCache
          .put({ membershipId, userId }, kioskRosterKey(category.id), snapshot, snapshot.fetchedAt)
          .catch(services.reportError);
        return snapshot;
      },
      staleTime: ROSTER_REFRESH_MS / 2,
      refetchInterval: ROSTER_REFRESH_MS,
    })),
  });
  const snapshots: KioskRosterSnapshot[] = [];
  let fromCache = false;
  let loading = false;
  let error: unknown = null;
  config.categories.forEach((_, index) => {
    const fresh = live[index]?.data;
    const stored: CachedValue<KioskRosterSnapshot> | null = kept[index]?.data ?? null;
    if (fresh !== undefined) snapshots.push(fresh);
    else if (stored !== null) {
      snapshots.push(stored.value);
      fromCache = true;
    } else if (live[index]?.isError === true) error = live[index].error;
    else loading = true;
  });
  return { snapshots, kept: fromCache, loading, error };
}

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'turn'; readonly player: KioskPlayer; readonly turn: number }
  | { readonly kind: 'exit' };

/** The kiosk itself: the list of players, one player's turn, and the exit with the PIN. */
export function KioskMode({
  config,
  sync,
}: {
  readonly config: KioskConfig;
  /** The sync indicator, for the staff around the device. */
  readonly sync?: ReactNode;
}) {
  const services = useServices();
  const translator = useTranslator();
  const { t } = translator;
  const now = useNow(15_000);
  const rosters = useKioskRosters(config);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [turns, setTurns] = useState(0);
  const { snapshots } = rosters;
  const timeZone = snapshots[0]?.timeZone ?? DEFAULT_CLUB_TIME_ZONE;
  const today = snapshots.length === 0 ? null : kioskToday(snapshots, now);
  const sessionIds = useMemo(
    () => [
      ...new Set(
        snapshots.flatMap((s) => s.entries.flatMap((e) => e.sessions.map((x) => x.session.id))),
      ),
    ],
    [snapshots],
  );
  const facts = useLocalRead(
    (membershipId) =>
      today === null
        ? Promise.resolve(NO_LOCAL_FACTS)
        : kioskLocalFacts(services.sync.store, membershipId, today, sessionIds),
    `kiosk|${today ?? ''}|${sessionIds.join(',')}`,
  );
  const players = useMemo(
    () => kioskPlayers(snapshots, facts.value ?? NO_LOCAL_FACTS, now),
    [snapshots, facts.value, now],
  );

  if (mode.kind === 'exit') {
    return (
      <KioskExitScreen
        timeZone={timeZone}
        onSubmit={(pin) => services.kiosk.exit(pin)}
        onCancel={() => {
          setMode({ kind: 'list' });
        }}
      />
    );
  }

  if (mode.kind === 'turn' && today !== null) {
    const { player } = mode;
    return (
      <KioskTurn
        // A new turn is a new component: nothing of the previous player is left.
        key={mode.turn}
        player={player}
        timeZone={timeZone}
        actions={{
          onSubmitWellness: async (scores) => {
            await services.sync.enqueue(
              'wellness.submit',
              kioskWellnessRequest({
                playerId: player.id,
                today,
                scores,
                clientUuid: services.randomUUID(),
              }),
            );
            facts.reload();
          },
          onSubmitRpe: async (sessionId, rpe) => {
            await services.sync.enqueue(
              'rpe.submit',
              kioskRpeRequest({
                playerId: player.id,
                sessionId,
                rpe,
                clientUuid: services.randomUUID(),
              }),
            );
            facts.reload();
          },
          onFinish: () => {
            setMode({ kind: 'list' });
          },
        }}
      />
    );
  }

  const list: LoadState<readonly KioskPlayer[]> =
    snapshots.length > 0 && !rosters.loading
      ? { status: 'ready', data: players }
      : rosters.error !== null && snapshots.length === 0
        ? { status: 'error', message: errorMessage(rosters.error, 'generic', translator) }
        : { status: 'loading' };
  const keptAt = rosters.kept ? Math.min(...snapshots.map((snapshot) => snapshot.fetchedAt)) : null;
  return (
    <KioskPickScreen
      title={t('kiosk.title', { categories: config.categories.map((c) => c.name).join(', ') })}
      players={list}
      keptAt={keptAt}
      timeZone={timeZone}
      sync={sync}
      onPick={(playerId) => {
        const player = players.find((p) => p.id === playerId);
        if (player === undefined) return;
        setTurns((n) => n + 1);
        setMode({ kind: 'turn', player, turn: turns + 1 });
      }}
      onExit={() => {
        setMode({ kind: 'exit' });
      }}
    />
  );
}
