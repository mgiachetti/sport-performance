import { localDateInTimeZone } from '@sport-performance/domain';
import { formatDate } from '@sport-performance/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import {
  CONTEXT_KEY,
  canRecordAnthropometry,
  clubTimeZone,
  contextSchema,
  keptThenFresh,
  loadMeasurements,
  refreshContext,
  refreshSquad,
  squadKey,
  squadSchema,
  type AnthroContext,
  type SquadDocument,
} from '../../src/anthropometry/data.ts';
import {
  dayMeasurements,
  recordInput,
  type DayMeasurement,
} from '../../src/anthropometry/model.ts';
import {
  AnthropometryCategoriesScreen,
  AnthropometrySheetScreen,
  type CategoriesState,
  type SquadState,
} from '../../src/screens/anthropometry.tsx';
import { SyncIndicator } from '../../src/screens/sync.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { AppText, ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';

type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'missing'; readonly message: string | null }
  | { readonly status: 'ready'; readonly data: T; readonly savedAt: number };

/**
 * Field anthropometry (B-508, ADR 0083): the sheet of a category for the
 * club's day, read from the phone (cached squad and context, synced
 * measurements and the queue) and refreshed from the API whenever there is
 * signal. Saving and correcting only queue mutations: the sync engine
 * takes them to the server.
 */
export default function Anthropometry() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const membershipId = membership?.id ?? null;
  const role = membership?.role ?? null;
  const allowed = role !== null && canRecordAnthropometry(role);
  const offline =
    (session.status === 'signedIn' && session.offline) || syncStatus.phase === 'offline';
  const cache = services.readCache;

  const [context, setContext] = useState<Loaded<AnthroContext>>({ status: 'loading' });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [squad, setSquad] = useState<Loaded<SquadDocument>>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [measurements, setMeasurements] = useState<ReadonlyMap<string, DayMeasurement>>(new Map());
  const [reloads, setReloads] = useState(0);

  const timeZone = clubTimeZone(context.status === 'ready' ? context.data : null);
  const measuredOn = localDateInTimeZone(now, timeZone);
  const failure = useCallback(
    (error: unknown) =>
      t('anthropometry.field.loadFailed', { reason: errorMessage(error, 'generic', translator) }),
    [t, translator],
  );

  // The context: what the phone has at once, then the server's when there is signal.
  useEffect(() => {
    if (membershipId === null || userId === null || role === null || !allowed) return;
    const controller = new AbortController();
    const scope = { membershipId, userId };
    keptThenFresh({
      read: () => cache.get(membershipId, CONTEXT_KEY, contextSchema),
      refresh: () => refreshContext(api, cache, scope, role, controller.signal),
      now: Date.now,
      onValue: ({ data, savedAt }) => {
        setContext({ status: 'ready', data, savedAt });
      },
      onMissing: (error) => {
        setContext({ status: 'missing', message: failure(error) });
      },
      cancelled: () => controller.signal.aborted,
    }).catch(services.reportError);
    return () => {
      controller.abort();
    };
  }, [api, cache, membershipId, userId, role, allowed, failure, services.reportError]);

  // The squad of the chosen category, the same way (again when the club's day changes).
  useEffect(() => {
    if (membershipId === null || userId === null || categoryId === null) return;
    const controller = new AbortController();
    const scope = { membershipId, userId };
    keptThenFresh({
      read: () => cache.get(membershipId, squadKey(categoryId), squadSchema),
      refresh: () => refreshSquad(api, cache, scope, categoryId, measuredOn, controller.signal),
      now: Date.now,
      onValue: ({ data, savedAt }) => {
        setSquad({ status: 'ready', data, savedAt });
      },
      onMissing: (error) => {
        setSquad({ status: 'missing', message: failure(error) });
      },
      onRefreshing: setRefreshing,
      cancelled: () => controller.signal.aborted,
    }).catch(services.reportError);
    return () => {
      controller.abort();
    };
  }, [api, cache, membershipId, userId, categoryId, measuredOn, failure, services.reportError]);

  const playerIds = useMemo(
    () => new Set(squad.status === 'ready' ? squad.data.players.map((p) => p.id) : []),
    [squad],
  );

  // The measurements of the day: again after each save, sync cycle or change of the queue.
  useEffect(() => {
    if (membershipId === null || playerIds.size === 0) return;
    let active = true;
    loadMeasurements(services.sync, membershipId, measuredOn, playerIds)
      .then(({ served, queued }) => {
        if (active) setMeasurements(dayMeasurements(served, queued, measuredOn));
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
  }, [
    services,
    membershipId,
    measuredOn,
    playerIds,
    reloads,
    syncStatus.pendingCount,
    syncStatus.lastSyncedAt,
  ]);

  if (membership === null || membershipId === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('anthropometry.field.open')}
        </AppText>
        <StatusMessage level="warning">{t('anthropometry.error.player')}</StatusMessage>
      </ScreenBody>
    );
  }

  const sync = (
    <SyncIndicator
      status={syncStatus}
      nowMs={now}
      onSyncNow={() => {
        services.sync.requestSync({ force: true });
      }}
    />
  );
  const category =
    context.status === 'ready'
      ? context.data.categories.find((candidate) => candidate.id === categoryId)
      : undefined;

  if (categoryId === null || category === undefined) {
    const state: CategoriesState =
      context.status === 'ready'
        ? { status: 'ready', categories: context.data.categories }
        : context;
    return (
      <AnthropometryCategoriesScreen
        state={state}
        offline={offline}
        sync={sync}
        onSelect={(id) => {
          setSquad({ status: 'loading' });
          setCategoryId(id);
        }}
      />
    );
  }

  const squadState: SquadState =
    squad.status === 'ready'
      ? { status: 'ready', players: squad.data.players, savedAt: squad.savedAt }
      : squad;
  return (
    <AnthropometrySheetScreen
      categoryName={category.name}
      measuredOn={measuredOn}
      squad={squadState}
      measurements={measurements}
      offline={offline}
      refreshing={refreshing}
      formatSavedAt={(epochMs) => formatDate(epochMs, { timeZone })}
      sync={sync}
      onChangeCategory={() => {
        setCategoryId(null);
        setMeasurements(new Map());
      }}
      onSave={async (playerId, values) => {
        await services.sync.enqueue(
          'anthro.record',
          recordInput(services.randomUUID(), playerId, measuredOn, values),
        );
        setReloads((n) => n + 1);
      }}
      onCorrect={async (input) => {
        await services.sync.enqueue('anthro.update', input);
        setReloads((n) => n + 1);
      }}
    />
  );
}
