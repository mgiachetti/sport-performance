import { ROLES, type Role } from '../role.js';
import { PERMISSION_RESOURCES, type ActionOf, type ResourceKind } from './resources.js';
import { allow, deny, type PermissionRule } from './rules.js';

/** Rules of one action, one per role. Every role is explicit, denials included. */
export type RoleRules = Readonly<Record<Role, PermissionRule>>;

/** The whole matrix: resource kind → action → role → rule. */
export type PermissionMatrix = {
  readonly [K in ResourceKind]: Readonly<Record<ActionOf<K>, RoleRules>>;
};

const platform = allow('platform');
const club = allow('club');
const assigned = allow('assigned');
const self = allow('self');
const guardian = allow('guardian');

/** Denied to every role. */
const nobody: RoleRules = {
  player: deny,
  parent: deny,
  coach: deny,
  sc: deny,
  medical: deny,
  admin: deny,
  superadmin: deny,
};

/** Club administration: admin, and superadmin while supporting the club. */
const administration: RoleRules = { ...nobody, admin: club, superadmin: club };

/** Staff in their assignments, administration in the whole club. */
const staffRead: RoleRules = {
  ...administration,
  coach: assigned,
  sc: assigned,
  medical: assigned,
};

/** Staff in their assignments plus the player's own data. */
const ownAndStaffRead: RoleRules = { ...staffRead, player: self };

/**
 * The permission matrix (B-303, ADR 0025): the single source of truth of who
 * sees and does what. The API (before each handler), the web and mobile (to
 * show or hide actions) evaluate it with `can`; the database keeps its own
 * row-level policies (ADR 0006, ADR 0008) as the last barrier.
 *
 * Read it as the role table of CLAUDE.md, cell by cell:
 *
 * - **player**: their own profile, results, load, wellness and RPE (which
 *   they submit with a data consent); own percentiles from M15; rankings with
 *   names never in M13–M16, always their own value against the anonymised
 *   group reference instead; their own consents once of age.
 * - **parent**: through a guardian link, the summarised profile, availability
 *   and consents (signed while the player is a minor), parents' heights and
 *   the account of a player without email. Never rankings, never health.
 * - **coach**: assigned categories: panel, roster, sessions, participation.
 * - **sc**: assigned categories: test days, results, anthropometry, gym, CMJ
 *   videos (with an image consent), imports; club configuration.
 * - **medical**: health data of assigned players, always audited; the rest
 *   of the staff sees availability only, never the cause.
 * - **admin**: everything of the club except health data and signing
 *   consents for someone else.
 * - **superadmin**: what an admin can, in the club whose context they fix,
 *   always audited; plus the registry of clubs. Never health data, never
 *   consents, never exporting a player's data.
 *
 * Collecting data of a player (wellness, RPE, results, measurements,
 * participation, parents' heights) needs a current `data` consent; images
 * need `image` to be uploaded or shown; health records need `health`.
 */
export const PERMISSION_MATRIX: PermissionMatrix = {
  club_registry: {
    read: { ...nobody, superadmin: platform },
    create: { ...nobody, superadmin: platform },
    update: { ...nobody, superadmin: platform },
  },
  club: {
    read: {
      player: club,
      parent: club,
      coach: club,
      sc: club,
      medical: club,
      admin: club,
      superadmin: club,
    },
    update: administration,
  },
  membership: {
    read: administration,
    invite: administration,
    update: administration,
    revoke: administration,
  },
  staff_assignment: {
    read: administration,
    manage: administration,
  },
  category: {
    read: staffRead,
    manage: administration,
  },
  metric_catalog: {
    read: {
      player: club,
      parent: club,
      coach: club,
      sc: club,
      medical: club,
      admin: club,
      superadmin: club,
    },
  },
  configuration: {
    read: { ...administration, coach: club, sc: club, medical: club },
    update: { ...administration, sc: club },
  },
  data_import: {
    run: { ...administration, sc: assigned },
  },
  change_history: {
    read: staffRead,
  },
  player_profile: {
    read: ownAndStaffRead,
    create: administration,
    update: { ...administration, coach: assigned, sc: assigned },
    archive: administration,
  },
  player_summary: {
    read: { ...ownAndStaffRead, parent: guardian },
  },
  guardian_link: {
    read: { ...administration, player: self, parent: guardian },
    manage: administration,
  },
  player_account: {
    invite: { ...administration, parent: allow('guardian', 'minor') },
  },
  consent: {
    read: { ...ownAndStaffRead, parent: guardian },
    sign: { ...nobody, player: allow('self', 'adult'), parent: allow('guardian', 'minor') },
    revoke: { ...nobody, player: allow('self', 'adult'), parent: allow('guardian', 'minor') },
  },
  parent_height: {
    read: { ...administration, parent: guardian, sc: assigned },
    report: {
      ...nobody,
      // Only while the player is a minor: an adult keeps the guardian's read access only.
      parent: allow('guardian', 'data', 'minor'),
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  wellness: {
    read: ownAndStaffRead,
    submit: { ...nobody, player: allow('self', 'data') },
  },
  rpe: {
    read: ownAndStaffRead,
    submit: { ...nobody, player: allow('self', 'data') },
  },
  training_session: {
    read: staffRead,
    manage: { ...administration, coach: assigned },
  },
  participation: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      coach: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  test_session: {
    read: staffRead,
    manage: { ...administration, sc: assigned },
  },
  test_result: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
    correct: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  anthropometry: {
    read: ownAndStaffRead,
    record: {
      ...nobody,
      sc: allow('assigned', 'data'),
      admin: allow('club', 'data'),
      superadmin: allow('club', 'data'),
    },
  },
  gym_program: {
    read: { ...administration, player: self, coach: assigned, sc: assigned },
    manage: { ...administration, sc: assigned },
  },
  load_metrics: {
    read: ownAndStaffRead,
  },
  alert: {
    read: staffRead,
    acknowledge: staffRead,
  },
  percentile: {
    read: { ...staffRead, player: allow('self', 'own_percentiles') },
  },
  // The player cell is `self`, but the ranking shows the other players of the
  // group: the endpoint must take the group from the viewer's own player and
  // never accept an arbitrary player id (see the resource kind).
  // The player cell is `self`, but the ranking shows the other players of the
  // group: the endpoint must take the group from the viewer's own player and
  // never accept an arbitrary player id (see the resource kind).
  named_ranking: {
    read: { ...staffRead, player: allow('self', 'named_rankings') },
  },
  group_reference: {
    read: ownAndStaffRead,
  },
  media: {
    read: {
      ...nobody,
      player: allow('self', 'image'),
      coach: allow('assigned', 'image'),
      sc: allow('assigned', 'image'),
      admin: allow('club', 'image'),
      superadmin: allow('club', 'image'),
    },
    upload: {
      ...nobody,
      sc: allow('assigned', 'image'),
      admin: allow('club', 'image'),
      superadmin: allow('club', 'image'),
    },
    delete: { ...administration, sc: assigned },
  },
  availability: {
    read: { ...ownAndStaffRead, parent: guardian },
  },
  medical_record: {
    read: { ...nobody, medical: assigned },
    record: { ...nobody, medical: allow('assigned', 'health') },
    update: { ...nobody, medical: allow('assigned', 'health') },
  },
  medical_block: {
    read: { ...nobody, medical: assigned },
    set: { ...nobody, medical: assigned },
    lift: { ...nobody, medical: assigned },
  },
  data_export: {
    export: {
      ...nobody,
      player: allow('self', 'adult'),
      parent: allow('guardian', 'minor'),
      admin: allow('club', 'data'),
    },
  },
};

/** One cell of the matrix, flattened. */
export interface PermissionCell {
  readonly kind: ResourceKind;
  readonly action: string;
  readonly role: Role;
  readonly rule: PermissionRule;
}

/** The rule of one cell. */
export function ruleFor<K extends ResourceKind>(
  kind: K,
  action: ActionOf<K>,
  role: Role,
): PermissionRule {
  // Unreachable for typed callers; fail closed for untyped ones: an unknown
  // kind, an action that is not an own key (`constructor`, `toString`) or an
  // unknown role is a denial, never a crash.
  if (!Object.hasOwn(PERMISSION_MATRIX, kind)) return deny;
  const actions = PERMISSION_MATRIX[kind] as Readonly<Record<string, RoleRules>>;
  if (!Object.hasOwn(actions, action)) return deny;
  const rules = actions[action] as Readonly<Record<string, PermissionRule>>;
  if (!Object.hasOwn(rules, role)) return deny;
  return rules[role] ?? deny;
}

/** Every cell, in resource, action and role order (for tests, docs and audits). */
export function permissionCells(): readonly PermissionCell[] {
  const cells: PermissionCell[] = [];
  for (const kind of Object.keys(PERMISSION_RESOURCES) as ResourceKind[]) {
    for (const action of PERMISSION_RESOURCES[kind].actions) {
      for (const role of ROLES) {
        cells.push({
          kind,
          action,
          role,
          rule: ruleFor(kind, action, role),
        });
      }
    }
  }
  return cells;
}
