import {
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
} from '@sport-performance/contracts';
import { formatDate, formatTime } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_DRAFT,
  clubTimeZone,
  draftAfterSave,
  keptRosterSchema,
  loadDraft,
  loadKnownParticipations,
  loadSession,
  queueSave,
  refreshRoster,
  rosterKey,
  saveDraft,
  type SheetDraft,
} from '../../src/coach-session/data.ts';
import { useCoachClub, useCoachScope, useLocalRead } from '../../src/coach-session/hooks.ts';
import {
  EMPTY_CLOCK,
  canRecordParticipation,
  digitsOnly,
  fillPresent,
  finishClock,
  pauseClock,
  planSave,
  planSize,
  startClock,
  stepContacts,
  toggleOnField,
  touchRow,
  withStatus,
  type DraftRow,
  type KnownParticipation,
} from '../../src/coach-session/model.ts';
import {
  categoryName,
  clockView,
  editablePlayers,
  effectiveRows,
  rowErrors,
  sessionTitle,
  sessionWhen,
  sheetPlayers,
  summaryOf,
} from '../../src/coach-session/view.ts';
import {
  CoachSessionSheetScreen,
  type RosterState,
  type SaveNotice,
} from '../../src/screens/coach-session.tsx';
import { SyncIndicator } from '../../src/screens/sync.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { AppText, Button, ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace('/sessions');
};

const NO_KNOWN: ReadonlyMap<string, KnownParticipation> = new Map();

/**
 * The participation sheet of one session on the field (B-509, ADR 0080):
 * reads the session, its kept roster and the participation from the phone,
 * keeps every change of the draft on the phone, and a save only queues.
 */
export default function CoachSession() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const syncStatus = useSyncStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const trainingSessionId = typeof params.id === 'string' ? params.id : '';
  const scope = useCoachScope();
  const membershipId = scope?.membershipId ?? null;
  const allowed = scope !== null && canRecordParticipation(scope.role);
  const readId = allowed && trainingSessionId !== '' ? membershipId : null;
  const club = useCoachClub(allowed ? scope : null);
  const timeZone = clubTimeZone(club);
  const offline = session.status === 'signedIn' && session.offline;

  const trainingSession = useLocalRead(readId, `session:${trainingSessionId}`, (id) =>
    loadSession(services.sync, id, trainingSessionId),
  );
  const kept = useLocalRead(readId, `roster:${trainingSessionId}`, (id) =>
    services.readCache.get(id, rosterKey(trainingSessionId), keptRosterSchema),
  );
  const live = useQuery({
    queryKey: [membershipId, 'coachSession', 'roster', trainingSessionId],
    enabled: readId !== null && !offline,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (scope === null) return null;
      const roster = await refreshRoster(api, services.readCache, scope, trainingSessionId, signal);
      return { roster, fetchedAt: Date.now() };
    },
  });
  const entries = live.data?.roster.entries ?? kept.value?.value.entries ?? null;
  const rosterFetchedAt = live.data?.fetchedAt ?? kept.value?.fetchedAt ?? null;
  const known = useLocalRead(
    entries === null ? null : readId,
    `known:${trainingSessionId}:${String(rosterFetchedAt)}`,
    (id) => loadKnownParticipations(services.sync, id, trainingSessionId, entries ?? []),
  );

  // The draft: read once from the phone, then kept there on every change.
  // Keyed by membership and session: never the draft of another one while this one loads.
  const draftKeyNow = `${readId ?? ''}|${trainingSessionId}`;
  const [loadedDraft, setLoadedDraft] = useState<{ key: string; draft: SheetDraft } | null>(null);
  const draftRef = useRef<{ key: string; draft: SheetDraft } | null>(null);
  const draft = loadedDraft?.key === draftKeyNow ? loadedDraft.draft : null;
  useEffect(() => {
    if (readId === null) return;
    let active = true;
    loadDraft(services.readCache, readId, trainingSessionId)
      .then((value) => {
        if (!active) return;
        const next = { key: `${readId}|${trainingSessionId}`, draft: value };
        draftRef.current = next;
        setLoadedDraft(next);
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
  }, [readId, trainingSessionId, services]);

  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<SaveNotice>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const running = (draft?.clock?.runningSinceMs ?? null) !== null;
  const now = useNow(running ? 1000 : 30_000);

  const current = draft ?? EMPTY_DRAFT;
  const knownMap = known.value ?? NO_KNOWN;
  const editable = useMemo(() => editablePlayers(entries ?? []), [entries]);
  const rowsNow = useMemo(
    () => effectiveRows(entries ?? [], knownMap, current),
    [entries, knownMap, current],
  );
  const shown = useMemo(
    () =>
      entries === null || known.value === undefined
        ? null
        : sheetPlayers(entries, knownMap, current, rowErrors(rowsNow, editable), now),
    [entries, known.value, knownMap, current, rowsNow, editable, now],
  );
  const plan = useMemo(
    () =>
      entries === null || known.value === undefined ? null : planSave(entries, knownMap, rowsNow),
    [entries, known.value, knownMap, rowsNow],
  );

  if (scope === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t('coachSession.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }
  if (trainingSession.value === null) {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t('coachSession.session.notFound')}</StatusMessage>
        <Button variant="link" label={t('coachSession.back')} onPress={goBack} />
      </ScreenBody>
    );
  }
  if (trainingSession.value === undefined || draft === null) {
    return (
      <ScreenBody>
        <AppText tone="secondary">{t('coachSession.roster.loading')}</AppText>
      </ScreenBody>
    );
  }
  const sessionDto = trainingSession.value;
  const activeScope = scope;

  function update(change: (base: SheetDraft) => SheetDraft) {
    const base = draftRef.current?.key === draftKeyNow ? draftRef.current.draft : EMPTY_DRAFT;
    const next = change(base);
    draftRef.current = { key: draftKeyNow, draft: next };
    setLoadedDraft(draftRef.current);
    setNotice(null);
    setConfirmDiscard(false);
    saveDraft(services.readCache, activeScope, trainingSessionId, next).catch(services.reportError);
  }
  const rowsOf = (base: SheetDraft) => effectiveRows(entries ?? [], knownMap, base);
  function updateRow(playerId: string, change: (row: DraftRow) => DraftRow) {
    if (!editable.has(playerId)) return;
    update((base) => {
      const row = rowsOf(base).get(playerId);
      if (row === undefined) return base;
      const entry = touchRow(base.rows[playerId], row, change(row));
      return { ...base, rows: { ...base.rows, [playerId]: entry } };
    });
  }
  /**
   * Rows a change rewrote join the draft with the fields it changed; the
   * others keep following what the phone knows.
   */
  function mergeRows(base: SheetDraft, next: ReadonlyMap<string, DraftRow>): SheetDraft['rows'] {
    const before = rowsOf(base);
    const merged = { ...base.rows };
    for (const [playerId, row] of next) {
      const previous = before.get(playerId);
      if (previous === undefined || previous === row) continue;
      merged[playerId] = touchRow(base.rows[playerId], previous, row);
    }
    return merged;
  }

  let rosterState: RosterState;
  if (shown !== null) {
    rosterState = {
      status: 'ready',
      players: shown,
      // Shown from the phone because the API could not be asked now.
      staleSince:
        live.data === undefined && rosterFetchedAt !== null && (offline || live.isError)
          ? {
              date: formatDate(rosterFetchedAt, { timeZone }),
              time: formatTime(rosterFetchedAt, { timeZone }),
            }
          : null,
    };
  } else if (entries !== null || kept.value === undefined) {
    rosterState = { status: 'loading' };
  } else if (live.isFetching && !live.isError) {
    // Nothing on the phone yet: the first download.
    rosterState = { status: 'loading' };
  } else {
    rosterState = { status: 'missing', retrying: live.isFetching };
  }

  return (
    <CoachSessionSheetScreen
      title={sessionTitle(sessionDto, categoryName(club, sessionDto.categoryId), translator)}
      when={sessionWhen(sessionDto, timeZone, translator)}
      plannedMinutes={sessionDto.plannedDurationMin}
      roster={rosterState}
      clock={clockView(current.clock, now)}
      summary={summaryOf(shown ?? [])}
      changeCount={plan === null ? 0 : planSize(plan)}
      needsReason={plan?.needsReason ?? false}
      reason={reason}
      reasonMissing={reasonMissing}
      saving={saving}
      notice={notice}
      confirmDiscard={confirmDiscard}
      sync={
        <SyncIndicator
          status={syncStatus}
          nowMs={now}
          onSyncNow={() => {
            services.sync.requestSync({ force: true });
          }}
        />
      }
      onBack={goBack}
      onRetryRoster={() => {
        void live.refetch();
      }}
      onStatus={(playerId, status) => {
        updateRow(playerId, (row) => withStatus(row, status));
      }}
      onMinutes={(playerId, text) => {
        updateRow(playerId, (row) => ({
          ...row,
          minutes: digitsOnly(text, PARTICIPATION_MINUTES_MAX),
        }));
      }}
      onContacts={(playerId, delta) => {
        updateRow(playerId, (row) => stepContacts(row, delta));
      }}
      onContactsText={(playerId, text) => {
        updateRow(playerId, (row) => ({
          ...row,
          contacts: digitsOnly(text, PARTICIPATION_CONTACTS_MAX),
        }));
      }}
      onToggleField={(playerId) => {
        if (!editable.has(playerId)) return;
        update((base) => ({
          ...base,
          clock: toggleOnField(base.clock ?? EMPTY_CLOCK, playerId, Date.now()),
        }));
      }}
      onStartClock={() => {
        update((base) => ({ ...base, clock: startClock(base.clock ?? EMPTY_CLOCK, Date.now()) }));
      }}
      onPauseClock={() => {
        update((base) =>
          base.clock === null ? base : { ...base, clock: pauseClock(base.clock, Date.now()) },
        );
      }}
      onFinishClock={() => {
        update((base) => {
          if (base.clock === null) return base;
          const next = finishClock(base.clock, rowsOf(base), editable, Date.now());
          return { rows: mergeRows(base, next), clock: null };
        });
      }}
      onFillPresent={() => {
        update((base) => ({
          ...base,
          rows: mergeRows(base, fillPresent(rowsOf(base), editable, sessionDto.plannedDurationMin)),
        }));
      }}
      onReason={(text) => {
        setReason(text);
        setReasonMissing(false);
      }}
      onSave={() => {
        if (plan === null || saving) return;
        if (plan.errors.size > 0) {
          setNotice({ kind: 'invalid' });
          return;
        }
        if (planSize(plan) === 0) {
          setNotice({ kind: 'nothing' });
          return;
        }
        if (plan.needsReason && reason.trim() === '') {
          setReasonMissing(true);
          return;
        }
        setSaving(true);
        queueSave(services.sync, trainingSessionId, plan, plan.needsReason ? reason : null, () =>
          services.randomUUID(),
        )
          .then(async (saved) => {
            // What the phone knows first, so the saved rows never show the old values.
            await known.reload().catch(services.reportError);
            update((base) => draftAfterSave(base, saved));
            setReason('');
            setNotice({ kind: 'saved', count: saved.length });
          })
          .catch((error: unknown) => {
            services.reportError(error);
            setNotice({ kind: 'failed' });
          })
          .finally(() => {
            setSaving(false);
          });
      }}
      onDiscard={() => {
        if (!confirmDiscard) {
          setConfirmDiscard(true);
          return;
        }
        update(() => EMPTY_DRAFT);
        setReason('');
      }}
      onCancelDiscard={() => {
        setConfirmDiscard(false);
      }}
    />
  );
}
