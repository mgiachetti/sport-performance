import type { MenstrualCycleStatus } from '@sport-performance/contracts';
import { addDays, type LocalDate } from '@sport-performance/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  EMPTY_CYCLE_DRAFT,
  cycleScreenState,
  menstrualCycleMutation,
  type CycleDraft,
} from '../../src/menstrual-cycle/model.ts';
import { MenstrualCycleScreen, type CycleSaved } from '../../src/screens/menstrual-cycle.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { clubDay, useMyPlayer } from '../../src/state/player-screens.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';

/**
 * "Mi ciclo" (B-806, ADR 0087). The status, the days and who sees them come
 * from the server and are never kept on the phone (health data: no local
 * collection, no read cache). The day goes to the offline queue
 * (`menstrual_cycle.log`, with its `clientUuid` and the club day from the
 * phone's clock) and leaves the phone once the server applied it; turning it
 * on or off and authorizing someone need a connection.
 */
export default function MenstrualCycle() {
  const services = useServices();
  const api = useApi();
  const queryClient = useQueryClient();
  const translator = useTranslator();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const membershipId = membership?.id ?? null;
  const isPlayer = membership?.role === 'player';
  const offline =
    (session.status === 'signedIn' && session.offline) || syncStatus.phase === 'offline';
  const me = useMyPlayer();
  const now = useNow();
  const clock = clubDay(me.value, now);
  const today = clock?.today ?? null;
  const yesterday = today === null ? null : addDays(today, -1);

  const statusKey = [membershipId, 'menstrual-cycle', 'status'];
  const status = useQuery({
    queryKey: statusKey,
    enabled: isPlayer,
    // Health data: never kept once the screen is gone.
    gcTime: 0,
    queryFn: ({ signal }) => api.getMenstrualCycleStatus({}, { signal }),
  });
  const playerId = status.data?.playerId ?? null;
  const days = useQuery({
    queryKey: [membershipId, 'menstrual-cycle', 'days', playerId, syncStatus.pendingCount],
    enabled: playerId !== null && status.data?.tracking === true,
    gcTime: 0,
    queryFn: ({ signal }) =>
      api.getMenstrualCycleDays({ params: { playerId: playerId ?? '' }, query: {} }, { signal }),
  });

  const [draft, setDraft] = useState<CycleDraft>(EMPTY_CYCLE_DRAFT);
  const [pickedDay, setPickedDay] = useState<LocalDate | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<CycleSaved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  if (!isPlayer || membershipId === null) return null;
  const day = pickedDay ?? today;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await services.sync.enqueue(
        'menstrual_cycle.log',
        menstrualCycleMutation(draft, {
          clientUuid: services.randomUUID(),
          ...(day !== null && { localDate: day }),
        }),
      );
      services.sync.requestSync();
      setSaved({ queued: offline });
      setDraft(EMPTY_CYCLE_DRAFT);
      await queryClient.invalidateQueries({ queryKey: [membershipId, 'menstrual-cycle', 'days'] });
    } catch (cause) {
      services.reportError(cause);
      setError(translator.t('cycle.error.queue'));
    } finally {
      setSaving(false);
    }
  }

  async function change(run: () => Promise<MenstrualCycleStatus | unknown>) {
    setBusy(true);
    setSettingsError(null);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: [membershipId, 'menstrual-cycle'] });
    } catch (cause) {
      services.reportError(cause);
      setSettingsError(translator.t('cycle.viewers.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MenstrualCycleScreen
      state={cycleScreenState({ status: status.data, failed: status.isError, offline })}
      today={today}
      yesterday={yesterday}
      day={day}
      onPickDay={setPickedDay}
      days={days.data ?? null}
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        setSaved(null);
      }}
      onSave={() => {
        void save();
      }}
      saving={saving}
      saved={saved}
      error={error}
      onStart={() => {
        void change(() =>
          api.startMenstrualCycleTracking({ body: { clientUuid: services.randomUUID() } }),
        );
      }}
      onEnd={() => {
        void change(() => api.endMenstrualCycleTracking({ body: {} }));
      }}
      onAuthorize={(membershipToAuthorize) => {
        void change(() =>
          api.authorizeMenstrualCycleViewer({
            body: { clientUuid: services.randomUUID(), membershipId: membershipToAuthorize },
          }),
        );
      }}
      onRevoke={(shareId) => {
        void change(() => api.revokeMenstrualCycleViewer({ params: { shareId }, body: {} }));
      }}
      busy={busy}
      settingsError={settingsError}
      onRetry={() => {
        void status.refetch();
      }}
    />
  );
}
