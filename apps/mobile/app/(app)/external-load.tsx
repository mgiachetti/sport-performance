import { parseTimeZone, type TimeZone } from '@sport-performance/domain';
import { useEffect, useState } from 'react';
import { clubDay, deviceTimeZone } from '../../src/external-load/club-day.ts';
import {
  queueExternalLoadArchive,
  queueExternalLoadCorrection,
  queueExternalLoadReport,
  readExternalLoadWeek,
} from '../../src/external-load/data.ts';
import { canReportExternalLoad } from '../../src/external-load/model.ts';
import type { ExternalLoadItem } from '../../src/external-load/model.ts';
import { ExternalLoadScreen } from '../../src/screens/external-load.tsx';
import { SyncIndicator } from '../../src/screens/sync.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';

/** Before the club's zone is known and when the phone's cannot be read. */
const FALLBACK_TIME_ZONE = parseTimeZone('America/Argentina/Buenos_Aires');

/**
 * External load (B-511, ADR 0084): the player's activities outside the club.
 * Reads the week from the local database and writes through the offline
 * queue, so it works without signal; the club's time zone is kept on the
 * phone after the first time it is fetched.
 */
export default function ExternalLoad() {
  const services = useServices();
  const api = useApi();
  const { t } = useTranslator();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const now = useNow();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const membershipId = membership?.id ?? null;
  const clubId = membership?.club.id ?? null;
  const allowed = membership !== null && canReportExternalLoad(membership.role);

  const [clubZone, setClubZone] = useState<TimeZone | null>(null);
  useEffect(() => {
    if (clubId === null || !allowed) return;
    let active = true;
    services.clubTimeZones
      .get(clubId)
      .then((stored) => {
        if (active && stored !== null) setClubZone(stored);
      })
      .catch(services.reportError);
    // With signal, the zone the club has today (it may have changed).
    api
      .getClub()
      .then(async (club) => {
        await services.clubTimeZones.save(clubId, club.timeZone);
        if (active) setClubZone(parseTimeZone(club.timeZone));
      })
      .catch(() => {
        // Without signal the stored zone (or the phone's) stands.
      });
    return () => {
      active = false;
    };
  }, [api, services, clubId, allowed]);

  const timeZone = clubZone ?? deviceTimeZone() ?? FALLBACK_TIME_ZONE;
  const today = clubDay(now, timeZone);

  const [items, setItems] = useState<readonly ExternalLoadItem[]>([]);
  useEffect(() => {
    if (membershipId === null || !allowed) return;
    let active = true;
    // Again whenever the queue or a sync cycle changes something: a write queued here, a pull
    // that brings the rows, a mutation that leaves the queue.
    readExternalLoadWeek(services.sync.store, membershipId, today)
      .then((next) => {
        if (active) setItems(next);
      })
      .catch(services.reportError);
    return () => {
      active = false;
    };
  }, [services, membershipId, allowed, today, syncStatus]);

  if (membership === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t('externalLoad.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }
  return (
    <ExternalLoadScreen
      // A new club day starts the form over on that day.
      key={today}
      today={today}
      timeZoneKnown={clubZone !== null}
      items={items}
      sync={
        <SyncIndicator
          status={syncStatus}
          nowMs={now}
          onSyncNow={() => {
            services.sync.requestSync({ force: true });
          }}
        />
      }
      // Each write changes the queue, and so the sync status the list is read on.
      onReport={(draft) => queueExternalLoadReport(services.sync, draft, services.randomUUID)}
      onCorrect={(item, draft, reason) =>
        queueExternalLoadCorrection(services.sync, item, draft, reason)
      }
      onArchive={(item) => queueExternalLoadArchive(services.sync, item)}
    />
  );
}
