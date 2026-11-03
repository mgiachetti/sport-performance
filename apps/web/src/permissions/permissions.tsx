import type { Category } from '@sport-performance/contracts';
import {
  CONSENT_TYPES,
  PERMISSION_RESOURCES,
  can,
  listScope,
  parsePlayerId,
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
 * resources count when the matrix gives the subject some players to list
 * (`listScope`: the club, its assignments, its own player or wards); the
 * consents and conditions of each player are checked where they are shown.
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
  if (target === 'player') return listScope(subject, kind, action).kind !== 'none';
  return can(subject, action, resourceOf(kind, subject.clubId, {}));
}

/** Placeholder id of {@link categoryPlayerFacts}: no real player has it. */
const ANY_PLAYER_ID = parsePlayerId('00000000-0000-4000-8000-000000000000');

/**
 * Facts of "a player of this category" for the matrix: in the category, with
 * every consent signed. It answers whether the role may act on the players
 * of a category at all (a sheet of the squad); each player's consent and
 * age are still checked by the API, row by row.
 */
export function categoryPlayerFacts(category: Pick<Category, 'id' | 'sport'>): PlayerFacts {
  return {
    id: ANY_PLAYER_ID,
    sport: category.sport,
    categoryIds: [category.id],
    consents: [...CONSENT_TYPES],
  };
}

/**
 * Whether the subject may do `action` on a player resource for the players
 * of at least one of `categories` (see {@link categoryPlayerFacts}). For
 * navigation and squad screens of player resources, where
 * {@link canSomewhere} answers `false` without a concrete player.
 */
export function canOnCategoryPlayers<K extends ResourceKind>(
  subject: PermissionSubject,
  kind: K,
  action: ActionOf<K>,
  categories: readonly Pick<Category, 'id' | 'sport'>[],
): boolean {
  return categories.some((category) =>
    can(
      subject,
      action,
      resourceOf(kind, subject.clubId, { player: categoryPlayerFacts(category) }),
    ),
  );
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
