import { ApiError } from '@sport-performance/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '../../../src/api/error-message.ts';
import { AlertDetailScreen, type AlertView } from '../../../src/screens/staff.tsx';
import {
  canReviewAlerts,
  canSeeStaffBoard,
  findPanelAlert,
  findPanelPlayer,
} from '../../../src/staff/board.ts';
import { useKeyedState } from '../../../src/state/keyed-state.ts';
import { useNow, useServices, useSession, useSyncStatus } from '../../../src/state/app-context.tsx';
import {
  useInvalidateStaffReads,
  useStaffAlert,
  useStaffPanel,
} from '../../../src/state/staff-data.ts';
import { useTranslator } from '../../../src/ui/i18n.tsx';

/**
 * An alert of a player (B-510): what a critical push opens and the board
 * links to. The detail of the API, kept on the phone; without signal and
 * without a kept copy, the panel's. The review is online only (ADR 0081).
 */
export default function AlertDetail() {
  const services = useServices();
  const state = useSession();
  const sync = useSyncStatus();
  const translator = useTranslator();
  const now = useNow();
  const params = useLocalSearchParams<{ alertId: string }>();
  const alertId = params.alertId;
  const membership = state.status === 'signedIn' ? state.activeMembership : null;
  const allowed = membership !== null && canSeeStaffBoard(membership.role);
  const detail = useStaffAlert(alertId, allowed && alertId !== '');
  const panel = useStaffPanel(allowed);
  const invalidate = useInvalidateStaffReads();
  // A Tabs screen: it stays mounted and only its `alertId` changes, so the
  // review's state belongs to the alert it was for.
  const [reviewing, setReviewing] = useKeyedState(alertId, false);
  const [notice, setNotice] = useKeyedState<{
    level: 'ok' | 'warning' | 'critical';
    text: string;
  } | null>(alertId, null);

  if (!allowed) return null;
  const fromPanel = findPanelAlert(panel.value, alertId);
  const view: AlertView | null =
    detail.value !== undefined
      ? { source: 'detail', alert: detail.value }
      : fromPanel !== null
        ? { source: 'board', alert: fromPanel.alert }
        : null;
  const player =
    detail.value !== undefined
      ? findPanelPlayer(panel.value, detail.value.playerId)
      : (fromPanel?.player ?? null);
  const online =
    !(state.status === 'signedIn' && state.offline) &&
    sync.phase !== 'offline' &&
    !detail.fromCache;
  const notFound = detail.error instanceof ApiError && detail.error.code === 'not_found';

  return (
    <AlertDetailScreen
      view={view}
      playerName={player === null ? null : `${player.firstName} ${player.lastName}`}
      loading={detail.loading}
      error={
        detail.error === null || notFound ? null : errorMessage(detail.error, 'generic', translator)
      }
      freshness={{
        fetchedAt: view?.source === 'board' ? panel.fetchedAt : detail.fetchedAt,
        fromCache: view?.source === 'board' ? true : detail.fromCache,
        nowMs: now,
      }}
      canReview={canReviewAlerts(membership.role)}
      online={online}
      reviewing={reviewing}
      notice={notice}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/staff');
      }}
      onReview={(status, note) => {
        if (detail.value === undefined) return;
        setReviewing(true);
        setNotice(null);
        services.api.client
          .reviewAlert({
            params: { alertId },
            body: {
              version: detail.value.version,
              status,
              ...(note === '' ? {} : { note }),
            },
          })
          .then(() => {
            setNotice({ level: 'ok', text: translator.t('staff.alert.reviewed') });
          })
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.code === 'conflict') {
              setNotice({ level: 'warning', text: translator.t('staff.alert.conflict') });
              return;
            }
            setNotice({ level: 'critical', text: errorMessage(error, 'generic', translator) });
          })
          .finally(() => {
            setReviewing(false);
            invalidate(membership.id, alertId);
          });
      }}
    />
  );
}
