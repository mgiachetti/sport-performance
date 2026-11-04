import { localDateInTimeZone } from '@sport-performance/domain';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import {
  clubTimeZone,
  draftedSessions,
  loadSessions,
  olderDraftSessions,
  prefetchRosters,
} from '../../src/coach-session/data.ts';
import { useCoachClub, useCoachScope, useLocalRead } from '../../src/coach-session/hooks.ts';
import {
  RECENT_SESSION_DAYS,
  canRecordParticipation,
  sessionLists,
} from '../../src/coach-session/model.ts';
import { sessionListItems } from '../../src/coach-session/view.ts';
import { CoachSessionListScreen } from '../../src/screens/coach-session.tsx';
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

/**
 * The coach's sessions on the field (B-509, ADR 0080): today's and the
 * week's, from the local database, with the rosters downloaded in the
 * background while there is signal so the sheet opens on the field without it.
 */
export default function Sessions() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow();
  const scope = useCoachScope();
  const membershipId = scope?.membershipId ?? null;
  const allowed = scope !== null && canRecordParticipation(scope.role);
  const club = useCoachClub(allowed ? scope : null);
  const timeZone = clubTimeZone(club);
  const today = localDateInTimeZone(now, timeZone);

  const sessions = useLocalRead(allowed ? membershipId : null, `sessions:${today}`, (id) =>
    loadSessions(services.sync, id, today),
  );
  const drafted = useLocalRead(allowed ? membershipId : null, 'drafts', (id) =>
    draftedSessions(services.readCache, id),
  );
  const reloadDrafts = drafted.reload;
  useFocusEffect(
    useCallback(() => {
      // Back from a sheet: its draft may have changed or been saved.
      reloadDrafts().catch(services.reportError);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [membershipId]),
  );
  const lists = sessionLists(sessions.value ?? [], today);
  const shownIds = [...lists.today, ...lists.recent].map((s) => s.id);
  const offline = session.status === 'signedIn' && session.offline;
  // The local database comes from a finished sync: what it lacks really left the phone.
  const synced = syncStatus.lastSyncedAt !== null && syncStatus.phase !== 'syncing';
  const older = useLocalRead(
    allowed && drafted.value !== undefined && sessions.value !== undefined ? membershipId : null,
    `olderDrafts:${shownIds.join(',')}:${[...(drafted.value ?? [])].join(',')}:${String(synced)}`,
    (id) => olderDraftSessions(services.sync, services.readCache, id, shownIds, { prune: synced }),
  );

  const prefetch = useQuery({
    queryKey: [membershipId, 'coachSession', 'prefetch', shownIds.join(','), synced],
    enabled: allowed && sessions.value !== undefined && !offline,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      scope === null
        ? { fetched: 0, failed: 0 }
        : prefetchRosters(api, services.readCache, scope, shownIds, { signal, prune: synced }),
  });

  if (scope === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('coachSession.list.title')}
        </AppText>
        <StatusMessage level="warning">{t('coachSession.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }
  const draftedIds = drafted.value ?? new Set<string>();
  return (
    <CoachSessionListScreen
      today={sessionListItems(lists.today, club, timeZone, draftedIds, translator)}
      recent={sessionListItems(lists.recent, club, timeZone, draftedIds, translator)}
      recentDays={RECENT_SESSION_DAYS}
      olderDrafts={sessionListItems(older.value ?? [], club, timeZone, draftedIds, translator)}
      loading={sessions.value === undefined}
      neverSynced={syncStatus.lastSyncedAt === null && (sessions.value?.length ?? 0) === 0}
      rostersFailed={offline ? 0 : (prefetch.data?.failed ?? 0)}
      sync={
        <SyncIndicator
          status={syncStatus}
          nowMs={now}
          onSyncNow={() => {
            services.sync.requestSync({ force: true });
          }}
        />
      }
      onOpen={(id) => {
        router.push({ pathname: '/session', params: { id } });
      }}
    />
  );
}
