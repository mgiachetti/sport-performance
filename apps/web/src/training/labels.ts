import type { Category, TrainingSession } from '@sport-performance/contracts';
import type { AvailabilityStatus } from '@sport-performance/domain';
import type { Translator } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';

/** How the training screens name a session and show statuses. */

type T = Translator['t'];

export function categoryName(
  categories: readonly Pick<Category, 'id' | 'name'>[],
  categoryId: string | null,
  t: T,
): string {
  if (categoryId === null) return t('training.session.noCategory');
  return categories.find((category) => category.id === categoryId)?.name ?? t('common.noData');
}

/** The title, or "Partido contra CASI" / "Entrenamiento M15". */
export function sessionName(
  session: Pick<TrainingSession, 'title' | 'kind' | 'categoryId'> &
    Partial<Pick<TrainingSession, 'opponent'>>,
  categories: readonly Pick<Category, 'id' | 'name'>[],
  t: T,
): string {
  if (session.title !== null) return session.title;
  if (session.kind === 'match' && session.opponent !== undefined && session.opponent !== null) {
    return t('training.session.matchAgainst', { opponent: session.opponent });
  }
  const category = categoryName(categories, session.categoryId, t);
  return session.kind === 'match'
    ? t('training.session.untitledMatch', { category })
    : t('training.session.untitledTraining', { category });
}

export const AVAILABILITY_LEVELS: Record<AvailabilityStatus, StatusLevel> = {
  available: 'ok',
  limited: 'warning',
  unavailable: 'critical',
};
