import type { Category, TrainingSession } from '@sport-performance/contracts';
import { can } from '@sport-performance/domain';
import type { ActiveClub } from '../club/active-club';
import { categoryFacts } from '../permissions/permissions';

/**
 * The permission matrix (ADR 0025) for the training screens: where the
 * caller may create and edit sessions (`training_session.manage`). The API
 * decides again; this only shows or hides the actions.
 */

export function manageableCategories(active: ActiveClub): Category[] {
  return active.categories.filter((category) =>
    can(active.subject, 'manage', {
      kind: 'training_session',
      clubId: active.club.id,
      category: categoryFacts(category),
    }),
  );
}

export function canManageSession(
  active: ActiveClub,
  session: Pick<TrainingSession, 'categoryId' | 'sport'>,
): boolean {
  return can(active.subject, 'manage', {
    kind: 'training_session',
    clubId: active.club.id,
    // A session without a category (a whole-sport import) is only for the whole club.
    ...(session.categoryId === null
      ? {}
      : { category: { id: session.categoryId, sport: session.sport } }),
  });
}
