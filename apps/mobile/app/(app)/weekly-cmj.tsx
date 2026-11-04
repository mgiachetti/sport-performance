import { formatDateTime } from '@sport-performance/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CachedValue } from '../../src/offline/read-cache.ts';
import {
  WeeklyCmjScreen,
  type WeeklyCmjRosterState,
  type WeeklyCmjSetupState,
} from '../../src/screens/weekly-cmj.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { AppText, ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';
import {
  clubTimeZoneOf,
  loadWeeklyCmjRoster,
  loadWeeklyCmjSettings,
  loadWeeklyCmjSetup,
  readWeeklyCmjView,
  recordWeeklyCmjAttempts,
  refreshWeeklyCmjRoster,
  refreshWeeklyCmjSetup,
  saveWeeklyCmjSettings,
  voidWeeklyCmjAttempt,
  type WeeklyCmjRosterDoc,
  type WeeklyCmjSetup,
  type WeeklyCmjView,
} from '../../src/weekly-cmj/data.ts';
import {
  DEFAULT_WEEKLY_CMJ_SETTINGS,
  canRecordWeeklyCmj,
  hasWeeklyCmj,
  todayResultFor,
  type WeeklyCmjSettings,
} from '../../src/weekly-cmj/model.ts';

type Loaded<T> = { readonly status: 'loading' } | { readonly status: 'done'; readonly value: T };

/**
 * Weekly CMJ (B-506, ADR 0079): reads the roster and the protocol from the
 * phone (refreshed with signal), the history from the synced results and
 * the queue, and writes every attempt through the queue.
 */
export default function WeeklyCmj() {
  const services = useServices();
  const api = useApi();
  const { t } = useTranslator();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const offline = session.status === 'signedIn' && session.offline;
  const membershipId = membership?.id ?? null;
  const allowed = membership !== null && canRecordWeeklyCmj(membership.role);
  const scope = useMemo(
    () => (membershipId === null || userId === null ? null : { membershipId, userId }),
    [membershipId, userId],
  );
  const { store } = services.sync;
  const cache = services.readCache;

  const [setup, setSetup] = useState<Loaded<CachedValue<WeeklyCmjSetup> | null>>({
    status: 'loading',
  });
  const [settings, setSettings] = useState<WeeklyCmjSettings>(DEFAULT_WEEKLY_CMJ_SETTINGS);
  const [roster, setRoster] = useState<{
    readonly categoryId: string;
    readonly value: CachedValue<WeeklyCmjRosterDoc> | null;
  } | null>(null);
  const [view, setView] = useState<{
    readonly roster: WeeklyCmjRosterDoc;
    readonly view: WeeklyCmjView;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [writes, setWrites] = useState(0);
  const categoryId = settings.categoryId;
  const loaded = setup.status === 'done';

  // What the phone already has: shown at once, also without signal.
  useEffect(() => {
    if (scope === null || !allowed) return;
    let active = true;
    Promise.all([
      loadWeeklyCmjSetup(cache, scope.membershipId),
      loadWeeklyCmjSettings(cache, scope.membershipId),
    ])
      .then(([stored, storedSettings]) => {
        if (!active) return;
        setSetup({ status: 'done', value: stored });
        setSettings(storedSettings);
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
  }, [cache, scope, allowed, services.reportError]);

  useEffect(() => {
    if (scope === null || categoryId === null) return;
    let active = true;
    loadWeeklyCmjRoster(cache, scope.membershipId, categoryId)
      .then((stored) => {
        if (active) setRoster({ categoryId, value: stored });
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
  }, [cache, scope, categoryId, services.reportError]);

  const run = useCallback(
    async (task: () => Promise<void>, signal?: AbortSignal) => {
      setRefreshing(true);
      try {
        await task();
        setRefreshFailed(false);
      } catch (error) {
        if (signal?.aborted !== true) {
          setRefreshFailed(true);
          services.reportError(error);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [services],
  );

  const refreshRoster = useCallback(
    async (id: string, signal?: AbortSignal) => {
      if (scope === null) return;
      const doc = await refreshWeeklyCmjRoster(api, cache, scope, id, signal);
      if (signal?.aborted === true) return;
      setRoster((current) =>
        id === (current?.categoryId ?? id)
          ? { categoryId: id, value: { value: doc, fetchedAt: Date.now() } }
          : current,
      );
    },
    [api, cache, scope],
  );

  /** With signal: the setup and the rosters of the M17/M19 categories, for later offline. */
  const refreshAll = useCallback(
    (signal?: AbortSignal) =>
      run(async () => {
        if (scope === null) return;
        const fresh = await refreshWeeklyCmjSetup(api, cache, scope, signal);
        if (signal?.aborted === true) return;
        setSetup({ status: 'done', value: { value: fresh, fetchedAt: Date.now() } });
        const wanted = fresh.categories
          .filter((category) => category.id === categoryId || hasWeeklyCmj(category.defaultStage))
          .map((category) => category.id);
        for (const id of wanted) await refreshRoster(id, signal);
      }, signal),
    [run, api, cache, scope, categoryId, refreshRoster],
  );

  // Once per opening (and when the signal comes back); "Actualizar plantel" on demand.
  useEffect(() => {
    if (!allowed || offline || scope === null || !loaded) return;
    const controller = new AbortController();
    // After this render: the refresh shows its own progress.
    const handle = setTimeout(() => {
      void refreshAll(controller.signal);
    }, 0);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, offline, scope, loaded]);

  const setupData = setup.status === 'done' ? (setup.value?.value ?? null) : null;
  const rosterRead = roster !== null && roster.categoryId === categoryId ? roster.value : undefined;
  const rosterData = rosterRead?.value ?? null;

  useEffect(() => {
    if (scope === null || setupData === null || rosterData === null) return;
    let active = true;
    readWeeklyCmjView({
      store,
      membershipId: scope.membershipId,
      setup: setupData,
      roster: rosterData,
      settings,
      nowMs: now,
    })
      .then((next) => {
        if (active) setView({ roster: rosterData, view: next });
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
    // Re-read when the queue moves or a pull lands (the indicator's state), and after a write.
  }, [
    store,
    scope,
    setupData,
    rosterData,
    settings,
    now,
    writes,
    syncStatus.pendingCount,
    syncStatus.lastSyncedAt,
    syncStatus.phase,
    services.reportError,
  ]);

  if (membership === null || userId === null || scope === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('weeklyCmj.title')}
        </AppText>
        <StatusMessage level="warning">{t('weeklyCmj.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }

  const setupState: WeeklyCmjSetupState =
    setup.status === 'loading'
      ? { status: 'loading' }
      : setupData === null
        ? { status: 'missing' }
        : setupData.test === null
          ? { status: 'no_test' }
          : {
              status: 'ready',
              protocol: {
                version: setupData.test.protocolVersion,
                attemptCount: setupData.test.attemptCount,
                aggregation: setupData.test.attemptAggregation,
              },
              categories: setupData.categories,
            };
  const timeZone = clubTimeZoneOf(setupData);
  const current = view !== null && view.roster === rosterData ? view.view : null;
  const rosterState: WeeklyCmjRosterState | null =
    categoryId === null
      ? null
      : rosterRead === undefined
        ? { status: 'loading' }
        : rosterRead === null
          ? refreshing
            ? { status: 'loading' }
            : { status: 'missing' }
          : current === null
            ? { status: 'loading' }
            : {
                status: 'ready',
                rows: current.rows,
                otherStages: current.otherStages,
                savedAt: formatDateTime(new Date(rosterRead.fetchedAt), { timeZone }),
              };

  const test = setupData?.test ?? null;
  return (
    <WeeklyCmjScreen
      setup={setupState}
      roster={rosterState}
      settings={settings}
      offline={offline}
      refreshing={refreshing}
      refreshFailed={refreshFailed}
      onRefresh={() => {
        void refreshAll();
      }}
      onChangeSettings={(next) => {
        setSettings(next);
        saveWeeklyCmjSettings(cache, scope, next).catch(services.reportError);
        if (next.categoryId !== null && next.categoryId !== categoryId && !offline) {
          const id = next.categoryId;
          void run(() => refreshRoster(id));
        }
      }}
      onRecord={async (row, values) => {
        if (test === null || current === null) return;
        await recordWeeklyCmjAttempts(services.sync, {
          existing: todayResultFor(row, settings.method),
          playerId: row.player.playerId,
          testDefinitionId: test.testDefinitionId,
          today: current.today,
          method: settings.method,
          mode: settings.mode,
          evaluatorId: userId,
          values,
          randomUUID: services.randomUUID,
          nowMs: Date.now(),
        });
        setWrites((count) => count + 1);
      }}
      onVoid={async (target, entryId, reason) => {
        await voidWeeklyCmjAttempt(services.sync, { target, entryId, reason });
        setWrites((count) => count + 1);
      }}
    />
  );
}
