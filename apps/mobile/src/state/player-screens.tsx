import {
  ApiError,
  ApiNetworkError,
  type ConsentDocument,
  type ConsentTypeStatus,
  type MyPlayer,
  type MyTrainingSession,
} from '@sport-performance/contracts';
import {
  localDateInTimeZone,
  parseTimeZone,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { formatDate, formatTime, type Translator } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/error-message.ts';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';
import { personalRecords, testHistory } from '../player/records.ts';
import { wellnessStreak } from '../player/streak.ts';
import { checkInDays, nextTestDay, rpeRange, rpeSessions, todayWellness } from '../player/today.ts';
import { PlayerConsentsScreen, type PlayerConsentsState } from '../screens/player-consents.tsx';
import { PlayerTestsScreen, type PercentilesSection } from '../screens/player-tests.tsx';
import {
  PlayerTodayScreen,
  type PlayerTodayActions,
  type PlayerTodayState,
  type WellnessSection,
} from '../screens/player-today.tsx';
import { useTranslator } from '../ui/i18n.tsx';
import { useApi, useNow, useServices, useSession, useSyncStatus } from './app-context.tsx';
import { useLocalRead, useOfflineRead, type OfflineRead } from './offline-reads.ts';

/**
 * The player app (B-503, ADR 0074): containers that read the local
 * database and the kept API reads, and write through the offline queue.
 * The screens of `src/screens/player-*.tsx` only render what they get.
 */

/** Keys of the kept reads (`cached_read.key`). */
export const PLAYER_READS = {
  me: 'me.player',
  testDays: 'me.testDays',
  sessions: 'me.trainingSessions',
  percentiles: 'me.percentiles',
  consents: 'me.consents',
} as const;

/** How many sessions of yesterday and today one page brings (a handful). */
const SESSIONS_LIMIT = 50;

/** The caller's profile for the player app, kept for offline use. */
export function useMyPlayer(): OfflineRead<MyPlayer> {
  const api = useApi();
  return useOfflineRead({
    key: PLAYER_READS.me,
    fetch: (signal) => api.getMyPlayer(undefined, { signal }),
    staleTimeMs: 5 * 60_000,
  });
}

function useMyTestDays() {
  const api = useApi();
  return useOfflineRead({
    key: PLAYER_READS.testDays,
    fetch: (signal) => api.listMyTestDays(undefined, { signal }),
    staleTimeMs: 10 * 60_000,
  });
}

/** Today in the club's time zone, from the phone's clock: also offline (CLAUDE.md). */
function clubDay(
  me: MyPlayer | undefined,
  nowMs: number,
): { today: LocalDate; timeZone: TimeZone } | null {
  if (me === undefined) return null;
  const timeZone = parseTimeZone(me.timeZone);
  return { today: localDateInTimeZone(nowMs, timeZone), timeZone };
}

/** "Without signal: kept on dd/mm at hh:mm" when the shown data did not come from the API now. */
function keptNotice(
  reads: readonly OfflineRead<unknown>[],
  timeZone: TimeZone | null,
  translator: Translator,
): string | null {
  const kept = reads.filter((read) => read.fromCache && read.fetchedAt !== null);
  if (kept.length === 0 || timeZone === null) return null;
  const oldest = Math.min(...kept.map((read) => read.fetchedAt ?? Infinity));
  return translator.t('playerApp.kept', {
    date: formatDate(oldest, { timeZone }),
    time: formatTime(oldest, { timeZone }),
  });
}

/** Why the profile could not be read, in the player's words. */
function profileError(error: unknown, translator: Translator): string {
  if (error instanceof ApiNetworkError) return translator.t('playerApp.firstLoad');
  if (error instanceof ApiError && error.code === 'forbidden') {
    return translator.t('playerApp.noPlayer');
  }
  return errorMessage(error, 'generic', translator);
}

function wellnessSection(
  me: MyPlayer,
  rows: readonly LocalRow<'wellness'>[],
  queue: readonly QueuedMutation[],
  today: LocalDate,
): WellnessSection {
  if (me.wellness === null) return { kind: 'unavailable', reason: 'no_stage' };
  const entry = todayWellness(rows, queue, today);
  // A check-in already on the phone is shown even if the consent was revoked since.
  if (!me.permissions.submitWellness && entry === null) {
    return { kind: 'unavailable', reason: 'no_consent' };
  }
  return {
    kind: 'form',
    itemCount: me.wellness.itemCount,
    items: me.wellness.items,
    entry,
  };
}

/** "Hoy" of the player: wellness, RPE, streak and the next test day. */
export function PlayerToday({ sync }: { readonly sync?: ReactNode }) {
  const services = useServices();
  const api = useApi();
  const session = useSession();
  const translator = useTranslator();
  const now = useNow();
  const me = useMyPlayer();
  const testDays = useMyTestDays();
  const day = clubDay(me.value, now);
  const range = day === null ? null : rpeRange(day.today);
  const sessions = useOfflineRead<MyTrainingSession[]>({
    key: PLAYER_READS.sessions,
    params: [range?.from, range?.to],
    // The range moves at midnight: the morning after without signal, yesterday's
    // answer still holds the sessions whose window is open (`rpeSessions` filters).
    keptAcrossParams: true,
    enabled: range !== null && me.value?.permissions.submitRpe === true,
    fetch: async (signal) =>
      range === null
        ? []
        : (
            await api.listMyTrainingSessions(
              {
                query: { from: range.from, to: range.to, limit: SESSIONS_LIMIT, sort: 'startsAt' },
              },
              { signal },
            )
          ).items,
    staleTimeMs: 60_000,
  });
  const playerId = me.value?.player.id ?? null;
  const sessionIds = (sessions.value ?? []).map((entry) => entry.session.id);
  const local = useLocalRead(
    async (membershipId) => {
      const { store } = services.sync;
      if (playerId === null) return null;
      const participations = [];
      for (const id of sessionIds) {
        participations.push(...(await store.list(membershipId, 'participation', { parentId: id })));
      }
      return {
        wellness: await store.list(membershipId, 'wellness', { playerId }),
        participations,
        queue: await store.pending(membershipId, [
          'wellness.submit',
          'wellness.correct',
          'rpe.submit',
        ]),
      };
    },
    `${playerId ?? ''}|${sessionIds.join(',')}`,
  );

  // An acked RPE stays in the queue only for a while (ACKED_OVERLAY_MAX_MS): the
  // list is asked again as soon as the server has it, so the scale never comes
  // back from the participation of the previous answer.
  const ackedRpe = useRef<ReadonlySet<string>>(new Set());
  const queue = local.value?.queue;
  const refetchSessions = sessions.refetch;
  useEffect(() => {
    if (queue === undefined) return;
    const acked = new Set(
      queue
        .filter((queued) => queued.op === 'rpe.submit' && queued.state === 'acked')
        .map((queued) => queued.mutationId),
    );
    const fresh = [...acked].some((id) => !ackedRpe.current.has(id));
    ackedRpe.current = acked;
    if (fresh) refetchSessions();
  }, [queue, refetchSessions]);

  const greetingName =
    me.value?.player.firstName ?? (session.status === 'signedIn' ? session.user.name.trim() : '');
  const greeting =
    greetingName === ''
      ? translator.t('home.greetingAnonymous')
      : translator.t('home.greeting', { name: greetingName });

  let state: PlayerTodayState;
  if (me.value === undefined || day === null) {
    state = me.loading
      ? { status: 'loading' }
      : { status: 'error', message: profileError(me.error, translator) };
  } else if (local.value === undefined || local.value === null) {
    state = { status: 'loading' };
  } else {
    const { wellness, participations, queue } = local.value;
    state = {
      status: 'ready',
      data: {
        today: day.today,
        timeZone: day.timeZone,
        wellness: wellnessSection(me.value, wellness, queue, day.today),
        rpe: {
          allowed: me.value.permissions.submitRpe,
          sessions: rpeSessions({
            sessions: sessions.value ?? [],
            from: rpeRange(day.today).from,
            participations,
            queue,
            nowMs: now,
          }),
        },
        streak: wellnessStreak(checkInDays(wellness, queue), day.today),
        nextTestDay: nextTestDay(testDays.value?.items ?? [], day.today),
      },
    };
  }

  const actions: PlayerTodayActions = {
    onSubmitWellness: async (scores) => {
      if (day === null) return;
      await services.sync.enqueue('wellness.submit', {
        body: { clientUuid: services.randomUUID(), localDate: day.today, scores },
      });
      local.reload();
    },
    onCorrectWellness: async (target, scores, reason) => {
      await services.sync.enqueue('wellness.correct', {
        target,
        body: { changeReason: reason, scores },
      });
      local.reload();
    },
    onSubmitRpe: async (trainingSessionId, rpe, reason) => {
      await services.sync.enqueue('rpe.submit', {
        params: { trainingSessionId },
        body: {
          clientUuid: services.randomUUID(),
          rpe,
          ...(reason !== null && { changeReason: reason }),
        },
      });
      local.reload();
    },
    onRetry: () => {
      me.refetch();
      services.sync.requestSync({ force: true });
    },
  };

  return (
    <PlayerTodayScreen
      greeting={greeting}
      state={state}
      notice={keptNotice([me, sessions], day?.timeZone ?? null, translator)}
      sync={sync}
      actions={actions}
    />
  );
}

/** "Mis tests": records, percentiles from M15, history and upcoming test days. */
export function PlayerTests() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const now = useNow();
  const me = useMyPlayer();
  const testDays = useMyTestDays();
  const playerId = me.value?.player.id ?? null;
  const canSeePercentiles = me.value?.permissions.readPercentiles === true;
  const percentiles = useOfflineRead({
    key: PLAYER_READS.percentiles,
    enabled: playerId !== null && canSeePercentiles,
    fetch: (signal) =>
      api.getPlayerPercentiles({ params: { playerId: playerId ?? '' } }, { signal }),
    staleTimeMs: 10 * 60_000,
  });
  const results = useLocalRead(
    async (membershipId) =>
      playerId === null
        ? []
        : (await services.sync.store.list(membershipId, 'test_result', { playerId })).map(
            (row) => row.data,
          ),
    playerId ?? '',
  );
  const day = clubDay(me.value, now);
  const own = results.value ?? [];

  let section: PercentilesSection;
  if (!canSeePercentiles) section = { kind: 'hidden' };
  else if (percentiles.value !== undefined)
    section = { kind: 'ready', items: percentiles.value.items };
  else if (percentiles.error !== null) {
    section = { kind: 'error', message: errorMessage(percentiles.error, 'generic', translator) };
  } else section = { kind: 'loading' };

  return (
    <PlayerTestsScreen
      notice={keptNotice([testDays, percentiles], day?.timeZone ?? null, translator)}
      records={personalRecords(own)}
      percentiles={section}
      history={testHistory(own)}
      testDays={
        testDays.value === undefined
          ? testDays.loading
            ? null
            : []
          : day === null
            ? testDays.value.items
            : testDays.value.items.filter((item) => item.scheduledOn >= day.today)
      }
    />
  );
}

/** The player's consents: read; an adult signs and revokes online. */
export function PlayerConsents({ onBack }: { readonly onBack: () => void }) {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const syncStatus = useSyncStatus();
  const session = useSession();
  const me = useMyPlayer();
  const playerId = me.value?.player.id ?? null;
  const consents = useOfflineRead({
    key: PLAYER_READS.consents,
    enabled: playerId !== null,
    fetch: (signal) => api.getPlayerConsents({ params: { playerId: playerId ?? '' } }, { signal }),
  });
  const [document, setDocument] = useState<ConsentDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ level: StatusLevel; text: string } | null>(null);
  const offline =
    (session.status === 'signedIn' && session.offline) || syncStatus.phase === 'offline';
  const timeZone = me.value === undefined ? null : parseTimeZone(me.value.timeZone);

  const run = (task: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    task()
      .then(() => {
        setNotice({ level: 'ok', text: done });
        setDocument(null);
        consents.refetch();
        // The permissions of the profile (loading wellness, RPE) follow the data consent.
        me.refetch();
      })
      .catch((failure: unknown) => {
        setError(errorMessage(failure, 'generic', translator));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  let state: PlayerConsentsState;
  // The signatures are dated in the club's time zone: the list waits for the profile.
  if (consents.value !== undefined && timeZone !== null) {
    state = { status: 'ready', consents: consents.value, timeZone };
  } else if (consents.loading || me.loading) state = { status: 'loading' };
  else {
    state = {
      status: 'error',
      message:
        me.value === undefined
          ? profileError(me.error, translator)
          : errorMessage(consents.error, 'generic', translator),
    };
  }
  const kept = keptNotice([consents], timeZone, translator);

  return (
    <PlayerConsentsScreen
      state={state}
      document={document}
      offline={offline}
      busy={busy}
      notice={notice ?? (kept === null ? null : { level: 'warning', text: kept })}
      error={error}
      actions={{
        onRead: (documentId) => {
          setError(null);
          api
            .getConsentDocument({ params: { documentId } })
            .then(setDocument)
            .catch((failure: unknown) => {
              setError(errorMessage(failure, 'generic', translator));
            });
        },
        onSign: (documentId) => {
          if (playerId === null) return;
          run(async () => {
            await api.signConsent({
              params: { playerId },
              body: { clientUuid: services.randomUUID(), documentId },
            });
          }, translator.t('guardian.consents.signed'));
        },
        onRevoke: (type: ConsentTypeStatus['type']) => {
          if (playerId === null) return;
          run(async () => {
            await api.revokeConsent({ params: { playerId, type } });
          }, translator.t('guardian.consents.revoked'));
        },
        onCloseDocument: () => {
          setDocument(null);
          setError(null);
        },
        onBack,
        onRetry: () => {
          me.refetch();
          consents.refetch();
        },
      }}
    />
  );
}
