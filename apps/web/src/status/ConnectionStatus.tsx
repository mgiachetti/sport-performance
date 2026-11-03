import type { TimeZone } from '@sport-performance/domain';
import { formatTime } from '@sport-performance/i18n';
import { useMutationState } from '@tanstack/react-query';
import { connectionStatus } from '../api/connection';
import { useServices, useStore } from '../app/services';
import { useT } from '../i18n/i18n';
import { Icon, type IconName } from '../ui/icons';

const ICONS: Record<ReturnType<typeof connectionStatus>, IconName> = {
  online: 'ok',
  offline: 'offline',
  unreachable: 'sync',
};

/** Mutations waiting for the connection (paused by TanStack Query while offline). */
export function usePendingChanges(): number {
  return useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length;
}

/**
 * Connection and sync status of the shell (ADR 0057), always icon + text and
 * announced politely: online / offline / API unreachable, changes waiting to
 * be sent and the time of the last answer, in the club's time zone.
 */
export function ConnectionStatus(props: { timeZone: TimeZone }) {
  const t = useT();
  const { connection } = useServices();
  const state = useStore(connection);
  const status = connectionStatus(state);
  const pending = usePendingChanges();

  return (
    <div
      className={`sp-connection sp-connection--${status}`}
      role="status"
      aria-live="polite"
      aria-label={t('connection.label')}
    >
      <p className="sp-connection__line">
        <Icon name={ICONS[status]} />
        <span>{t(`connection.${status}`)}</span>
      </p>
      {status === 'offline' ? (
        <p className="sp-connection__detail">{t('connection.offlineDetail')}</p>
      ) : null}
      {pending > 0 ? (
        <p className="sp-connection__line">
          <Icon name="sync" />
          <span>{t('sync.pending', { count: pending })}</span>
        </p>
      ) : null}
      {state.lastResponseAt === null ? null : (
        <p className="sp-connection__detail">
          {t('connection.updatedAt', {
            time: formatTime(state.lastResponseAt, { timeZone: props.timeZone }),
          })}
        </p>
      )}
    </div>
  );
}
