import type { Category } from '@sport-performance/contracts';
import {
  PERMISSION_RESOURCES,
  can,
  type ActionOf,
  type CategoryFacts,
  type PermissionResource,
  type PermissionSubject,
  type PlayerFacts,
  type ResourceKind,
} from '@sport-performance/domain';
import type { ReactNode } from 'react';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Notice } from '../ui/components';

/**
 * What a check is about, besides the club: the player or the category of the
 * screen. Without either, a category or player resource is checked against
 * the categories the user sees (see {@link canSomewhere}).
 */
export interface PermissionTarget {
  readonly player?: PlayerFacts;
  readonly category?: CategoryFacts;
}

export function categoryFacts(category: Pick<Category, 'id' | 'sport'>): CategoryFacts {
  return { id: category.id, sport: category.sport };
}

function resourceOf<K extends ResourceKind>(
  kind: K,
  clubId: PermissionSubject['clubId'],
  target: PermissionTarget,
): PermissionResource<K> {
  return {
    kind,
    clubId,
    ...(target.player === undefined ? {} : { player: target.player }),
    ...(target.category === undefined ? {} : { category: target.category }),
  };
}

/**
 * Whether the subject may do `action` on `kind` in at least one place it
 * sees: the club for club resources, any visible category for category
 * resources. For navigation ("is there anything here for me?"); a screen
 * still checks the concrete category or player with {@link useCan}. Player
 * resources need the player's facts and are never allowed here.
 */
export function canSomewhere<K extends ResourceKind>(
  subject: PermissionSubject,
  kind: K,
  action: ActionOf<K>,
  categories: readonly Pick<Category, 'id' | 'sport'>[],
): boolean {
  const target = PERMISSION_RESOURCES[kind].target;
  if (target === 'category') {
    return categories.some((category) =>
      can(subject, action, resourceOf(kind, subject.clubId, { category: categoryFacts(category) })),
    );
  }
  if (target === 'player') return false;
  return can(subject, action, resourceOf(kind, subject.clubId, {}));
}

/**
 * The permission matrix of the domain (ADR 0025) for the active club: the web
 * shows or hides what the API would allow or deny. The API decides again.
 */
export function useCan<K extends ResourceKind>(
  kind: K,
  action: ActionOf<K>,
  target?: PermissionTarget,
): boolean {
  const { subject, categories } = useActiveClub();
  if (target === undefined) return canSomewhere(subject, kind, action, categories);
  return can(subject, action, resourceOf(kind, subject.clubId, target));
}

/** Renders `children` only when allowed (or `fallback`). */
export function Can<K extends ResourceKind>(props: {
  kind: K;
  action: ActionOf<K>;
  target?: PermissionTarget;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const allowed = useCan(props.kind, props.action, props.target);
  return <>{allowed ? props.children : (props.fallback ?? null)}</>;
}

/**
 * Guard of a screen: its content, or "No tenés permiso" when the matrix
 * denies it (the API would answer `403` anyway; this avoids the round trip).
 */
export function RequirePermission<K extends ResourceKind>(props: {
  kind: K;
  action: ActionOf<K>;
  target?: PermissionTarget;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Can
      kind={props.kind}
      action={props.action}
      {...(props.target === undefined ? {} : { target: props.target })}
      fallback={
        <Notice level="warning" role="alert">
          <p>{t('error.forbidden')}</p>
        </Notice>
      }
    >
      {props.children}
    </Can>
  );
}
