import {
  DEFAULT_CLUB_TIME_ZONE,
  isTimeZone,
  localDateInTimeZone,
  type LocalDate,
} from '@sport-performance/domain';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import {
  bestE1rms,
  canLogGym,
  logSetInput,
  programsInForce,
  sessionSets,
} from '../../../src/gym/model.ts';
import { GymScreen, type GymLoadState } from '../../../src/screens/gym.tsx';
import { SyncIndicator } from '../../../src/screens/sync.tsx';
import { useNow, useServices, useSession, useSyncStatus } from '../../../src/state/app-context.tsx';
import { useClubModules } from '../../../src/state/club-modules.ts';

/** The day of the device: the server dates each set by the club day it was recorded. */
function deviceToday(nowMs: number): LocalDate {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return localDateInTimeZone(nowMs, isTimeZone(zone) ? zone : DEFAULT_CLUB_TIME_ZONE);
}

/**
 * Gym tab (B-607, ADR 0075): the player's programs and sets from the local
 * database, new sets through the offline queue (`gym_set.log`). Read again
 * whenever the sync engine changes something (a pull, the queue).
 */
export default function Gym() {
  const services = useServices();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow(60_000);
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const membershipId = membership?.id ?? null;
  const moduleOn = useClubModules().gym;
  const allowed = membership !== null && canLogGym(membership.role);
  const today = deviceToday(now);
  const [state, setState] = useState<GymLoadState>({ status: 'loading' });
  const [programId, setProgramId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const { store } = services.sync;
  useEffect(() => {
    // With the module off the sync no longer pulls the gym: nothing to read (issue #215).
    if (membershipId === null || !allowed || !moduleOn) return;
    let active = true;
    Promise.all([
      store.list(membershipId, 'gym_program'),
      store.list(membershipId, 'gym_set'),
      store.pending(membershipId, ['gym_set.log']),
    ])
      .then(([programs, sets, queued]) => {
        if (!active) return;
        setState({
          status: 'ready',
          data: {
            programs: programsInForce(programs, today),
            sets: sessionSets(sets, queued, today),
            best: bestE1rms(sets),
          },
        });
      })
      .catch((error: unknown) => {
        services.reportError(error);
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [
    store,
    services,
    membershipId,
    allowed,
    moduleOn,
    today,
    version,
    syncStatus.lastSyncedAt,
    syncStatus.pendingCount,
  ]);

  const onLog = useCallback<Parameters<typeof GymScreen>[0]['onLog']>(
    async (program, day, exerciseCode, setNumber, set) => {
      try {
        await services.sync.enqueue(
          'gym_set.log',
          logSetInput({
            clientUuid: randomUUID(),
            program,
            dayKey: day,
            exerciseCode,
            setNumber,
            set,
          }),
        );
        setVersion((v) => v + 1);
        return 'logged';
      } catch (error) {
        services.reportError(error);
        return 'failed';
      }
    },
    [services],
  );

  if (session.status !== 'signedIn' || membership === null) return null;
  return (
    <GymScreen
      moduleOn={moduleOn}
      allowed={allowed}
      state={state}
      offline={session.offline && syncStatus.phase !== 'offline'}
      sync={
        <SyncIndicator
          status={syncStatus}
          nowMs={now}
          onSyncNow={() => {
            services.sync.requestSync({ force: true });
          }}
        />
      }
      programId={programId}
      dayKey={dayKey}
      onPickProgram={(id) => {
        setProgramId(id);
        setDayKey(null);
      }}
      onPickDay={setDayKey}
      onLog={onLog}
    />
  );
}
