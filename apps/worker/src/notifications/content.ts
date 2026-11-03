import type { NotificationKind } from '@sport-performance/domain';
import { formatTime, type Translator } from '@sport-performance/i18n';
import type { NotificationClub } from './club.js';

/**
 * The text of a notification, rendered when it is sent (never stored), in
 * the club's locale. The same title and body go to push and email. Only
 * what is not health data: the kind of session, a category name, counts.
 */
export interface NotificationContent {
  readonly title: string;
  readonly body: string;
  /** Path in the app and the web (`/alerts/<id>`); the device routes the tap with it. */
  readonly path: string;
  readonly priority: 'default' | 'high';
}

export type ContentInput =
  | {
      readonly kind: 'rpe_request' | 'rpe_reminder';
      readonly sessionId: string;
      readonly sessionKind: 'training' | 'match';
    }
  | {
      readonly kind: 'critical_alert';
      readonly alertId: string;
      readonly categoryName: string;
    }
  | {
      readonly kind: 'pre_training_summary';
      readonly sessionId: string;
      readonly sessionKind: 'training' | 'match';
      readonly categoryName: string;
      readonly startsAt: Date;
      readonly criticalAlerts: number;
      readonly warningAlerts: number;
      /** `null` when the wellness module is off. */
      readonly wellness: { readonly submitted: number; readonly players: number } | null;
    };

export function notificationContent(
  t: Translator['t'],
  club: NotificationClub,
  input: ContentInput,
): NotificationContent {
  switch (input.kind) {
    case 'rpe_request':
    case 'rpe_reminder':
      return {
        title: t(`notification.${input.kind}.title`),
        body: t(`notification.${input.kind}.body`, { session: input.sessionKind }),
        path: `/training-sessions/${input.sessionId}/rpe`,
        priority: 'default',
      };
    case 'critical_alert':
      return {
        title: t('notification.critical_alert.title', { categoryName: input.categoryName }),
        body: t('notification.critical_alert.body', { categoryName: input.categoryName }),
        path: `/alerts/${input.alertId}`,
        priority: 'high',
      };
    case 'pre_training_summary': {
      const common = {
        time: formatTime(input.startsAt, { timeZone: club.timeZone }),
        critical: input.criticalAlerts,
        warning: input.warningAlerts,
      };
      return {
        title: t('notification.pre_training_summary.title', {
          categoryName: input.categoryName,
          session: input.sessionKind,
        }),
        body:
          input.wellness === null
            ? t('notification.pre_training_summary.bodyWithoutWellness', common)
            : t('notification.pre_training_summary.body', {
                ...common,
                wellnessSubmitted: input.wellness.submitted,
                players: input.wellness.players,
              }),
        path: `/training-sessions/${input.sessionId}`,
        priority: 'default',
      };
    }
  }
}

/** Kinds whose recipient is the player themself (the rest go to the staff). */
export function isPlayerKind(kind: NotificationKind): kind is 'rpe_request' | 'rpe_reminder' {
  return kind === 'rpe_request' || kind === 'rpe_reminder';
}
