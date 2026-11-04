import type { NotificationPreference } from '@sport-performance/contracts';
import type { NotificationKind } from '@sport-performance/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import { readCacheKey } from '../../src/offline/read-cache.ts';
import { NotificationSettingsScreen } from '../../src/screens/staff.tsx';
import { useServices, useSession, useSyncStatus } from '../../src/state/app-context.tsx';
import { useOfflineRead } from '../../src/state/offline-reads.ts';
import { usePushState } from '../../src/state/staff-data.ts';
import { useTranslator } from '../../src/ui/i18n.tsx';

/** Read of the preferences of the membership, kept on the phone. */
const PREFERENCES_READ = 'notifications.preferences';

/**
 * The notifications of this phone and the person's preferences in the
 * active club (B-510, ADR 0054): any role, opened from Cuenta.
 */
export default function NotificationSettings() {
  const services = useServices();
  const state = useSession();
  const sync = useSyncStatus();
  const translator = useTranslator();
  const push = usePushState();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const preferences = useOfflineRead<NotificationPreference[]>({
    key: PREFERENCES_READ,
    fetch: async (signal) =>
      (await services.api.client.getMyNotificationPreferences(undefined, { signal })).items,
  });
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  const membershipId = state.activeMembership.id;
  const online = !state.offline && sync.phase !== 'offline' && !preferences.fromCache;

  return (
    <NotificationSettingsScreen
      push={push}
      preferences={preferences.value ?? null}
      loading={preferences.loading}
      error={
        preferences.error === null ? null : errorMessage(preferences.error, 'generic', translator)
      }
      saveError={saveError}
      online={online}
      saving={saving}
      onEnablePush={() => {
        services.push.enable().catch(services.reportError);
      }}
      onDisablePush={() => {
        services.push.disable().catch(services.reportError);
      }}
      onOpenSettings={() => {
        services.push.openSettings().catch(services.reportError);
      }}
      onChange={(kind: NotificationKind, channel, value) => {
        setSaving(true);
        setSaveError(null);
        services.api.client
          .updateMyNotificationPreferences({
            body: { preferences: [{ kind, [channel]: value }] },
          })
          .then(async (next) => {
            const key = readCacheKey(PREFERENCES_READ);
            const fetchedAt = Date.now();
            queryClient.setQueryData(['club', membershipId, 'live', key], {
              value: next.items,
              fetchedAt,
            });
            await services.readCache
              .put({ membershipId, userId: state.user.id }, key, next.items, fetchedAt)
              .catch(services.reportError);
          })
          .catch((error: unknown) => {
            setSaveError(errorMessage(error, 'generic', translator));
          })
          .finally(() => {
            setSaving(false);
          });
      }}
    />
  );
}
