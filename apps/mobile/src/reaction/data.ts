import {
  ApiError,
  categorySchema,
  clubSchema,
  deviceSchema,
  playerSchema,
  testDefinitionSchema,
  type ApiClient,
  type Device,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  isTimeZone,
  localDateInTimeZone,
  reactionProtocol,
  type LocalDate,
  type ReactionProtocol,
  type TimeZone,
} from '@sport-performance/domain';
import { ROSTER_PAGE_LIMIT, fetchAllPages } from '../ift/roster.ts';
import type { LocalStore } from '../offline/local-store.ts';
import type { SyncScopeRef } from '../offline/engine.ts';
import type { ReadCache } from '../offline/read-cache.ts';
import type { HardwareInfo } from './installation.ts';
import {
  REACTION_OPS,
  REACTION_TEST_CODE,
  reactionHistory,
  type ReactionHistoryItem,
} from './model.ts';

/**
 * What the reaction test keeps on the phone (B-606, ADR 0075): the club's
 * time zone, its categories, the protocol version in force and this phone
 * as a device of the club are a cached read; the roster of each category
 * another. Both live under the membership in the local database (deleted
 * on sign-out) and are refreshed with signal every time the screen opens,
 * so the test runs without signal once it was opened with it.
 */

/** Per installation: a database restored on another phone never takes this phone's device. */
export const reactionSetupKey = (installationId: string): string =>
  `reaction.setup.${installationId}`;
/** One key per category (no parameters: keeping one roster never drops another, ADR 0074). */
export const reactionRosterKey = (categoryId: string): string => `reaction.roster.${categoryId}`;

export const reactionSetupSchema = clubSchema.pick({ timeZone: true }).extend({
  categories: categorySchema.pick({ id: true, name: true, sortOrder: true }).array(),
  definition: testDefinitionSchema
    .pick({ id: true, version: true, attemptCount: true, protocol: true })
    .nullable(),
  /** This phone as a device of the club, found by its installation id; `null`: not registered. */
  device: deviceSchema.pick({ id: true, label: true, kind: true, retiredAt: true }).nullable(),
});
export type ReactionSetup = ReturnType<typeof reactionSetupSchema.parse>;
export type ReactionDevice = NonNullable<ReactionSetup['device']>;

/** The players of a category, by name (the API's order). */
export const reactionRosterSchema = playerSchema
  .pick({ id: true, firstName: true, lastName: true })
  .array();
export type ReactionRoster = ReturnType<typeof reactionRosterSchema.parse>;

type ReadCacheScope = SyncScopeRef;

/** A kept answer, checked again with its contract: one an older build kept is a miss. */
export interface CachedRead<T> {
  readonly data: T;
  readonly fetchedAt: number;
}

async function kept<T>(
  cache: ReadCache,
  membershipId: string,
  key: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Promise<CachedRead<T> | null> {
  const stored = await cache.get<unknown>(membershipId, key);
  if (stored === null) return null;
  const parsed = schema.safeParse(stored.value);
  return parsed.success ? { data: parsed.data, fetchedAt: stored.fetchedAt } : null;
}

type SetupApi = Pick<
  ApiClient,
  'getClub' | 'listCategories' | 'listTestDefinitions' | 'listDevices'
>;

const withSignal = (signal: AbortSignal | undefined) => (signal === undefined ? {} : { signal });
const page = (cursor: string | undefined) => ({
  limit: ROSTER_PAGE_LIMIT,
  ...(cursor === undefined ? {} : { cursor }),
});

function deviceOf(device: Device | undefined): ReactionDevice | null {
  return device === undefined
    ? null
    : { id: device.id, label: device.label, kind: device.kind, retiredAt: device.retiredAt };
}

/** This phone among the club's devices (in use or retired), by its installation id. */
async function findThisDevice(
  api: Pick<ApiClient, 'listDevices'>,
  installationId: string,
  signal?: AbortSignal,
): Promise<ReactionDevice | null> {
  const found = await api.listDevices(
    { query: { serialNumber: installationId, status: 'all', limit: 10 } },
    withSignal(signal),
  );
  // A phone and a tablet never share an installation id; prefer the one in use.
  const inUse = found.items.find((device) => device.retiredAt === null);
  return deviceOf(inUse ?? found.items[0]);
}

/** Reads the setup from the API and keeps it. */
export async function refreshReactionSetup(
  api: SetupApi,
  cache: ReadCache,
  scope: ReadCacheScope,
  installationId: string,
  signal?: AbortSignal,
): Promise<ReactionSetup> {
  const options = withSignal(signal);
  const [club, categories, definitions, device] = await Promise.all([
    api.getClub(undefined, options),
    fetchAllPages((cursor) =>
      api.listCategories({ query: { status: 'active', ...page(cursor) } }, options),
    ),
    api.listTestDefinitions({ query: { code: REACTION_TEST_CODE, limit: 10 } }, options),
    findThisDevice(api, installationId, signal),
  ]);
  // The version in force today; with several (one per sport), the latest.
  const definition = [...definitions.items].sort((a, b) => b.version - a.version)[0];
  const setup: ReactionSetup = {
    timeZone: club.timeZone,
    categories: [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
      .map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    definition:
      definition === undefined
        ? null
        : {
            id: definition.id,
            version: definition.version,
            attemptCount: definition.attemptCount,
            protocol: definition.protocol,
          },
    device,
  };
  await cache.put(scope, reactionSetupKey(installationId), setup, Date.now());
  return setup;
}

export function loadReactionSetup(
  cache: ReadCache,
  membershipId: string,
  installationId: string,
): Promise<CachedRead<ReactionSetup> | null> {
  return kept(cache, membershipId, reactionSetupKey(installationId), reactionSetupSchema);
}

/** Reads the players of a category and keeps them. */
export async function refreshReactionRoster(
  api: Pick<ApiClient, 'listPlayers'>,
  cache: ReadCache,
  scope: ReadCacheScope,
  categoryId: string,
  signal?: AbortSignal,
): Promise<ReactionRoster> {
  const players = await fetchAllPages((cursor) =>
    api.listPlayers({ query: { categoryId, ...page(cursor) } }, withSignal(signal)),
  );
  const roster: ReactionRoster = players.map(({ id, firstName, lastName }) => ({
    id,
    firstName,
    lastName,
  }));
  await cache.put(scope, reactionRosterKey(categoryId), roster, Date.now());
  return roster;
}

export function loadReactionRoster(
  cache: ReadCache,
  membershipId: string,
  categoryId: string,
): Promise<CachedRead<ReactionRoster> | null> {
  return kept(cache, membershipId, reactionRosterKey(categoryId), reactionRosterSchema);
}

/** Why registering this phone failed, as the screen tells it. */
export type RegisterFailure = 'already_registered' | 'other';

/**
 * Registers this phone as a device of the club (online: the device is the
 * club's, the API names it), or restores it if it was retired, and keeps
 * the setup with it. Idempotent by its `clientUuid`; a phone that another
 * user already registered is found by its installation id instead.
 */
export async function registerThisDevice(
  api: Pick<ApiClient, 'registerDevice' | 'restoreDevice' | 'listDevices'>,
  cache: ReadCache,
  scope: ReadCacheScope,
  input: {
    readonly setup: ReactionSetup;
    readonly installationId: string;
    readonly label: string;
    readonly hardware: HardwareInfo;
    readonly clientUuid: string;
  },
): Promise<ReactionSetup> {
  let device: ReactionDevice | null;
  if (input.setup.device !== null && input.setup.device.retiredAt !== null) {
    device = deviceOf(await api.restoreDevice({ params: { deviceId: input.setup.device.id } }));
  } else {
    try {
      device = deviceOf(
        await api.registerDevice({
          body: {
            clientUuid: input.clientUuid,
            kind: input.hardware.kind,
            label: input.label,
            serialNumber: input.installationId,
            ...(input.hardware.model !== null && { model: input.hardware.model }),
            ...(input.hardware.osVersion !== null && { firmwareVersion: input.hardware.osVersion }),
          },
        }),
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'conflict') throw error;
      device = await findThisDevice(api, input.installationId);
      if (device === null) throw error;
    }
  }
  const setup: ReactionSetup = { ...input.setup, device };
  await cache.put(scope, reactionSetupKey(input.installationId), setup, Date.now());
  return setup;
}

export function clubTimeZoneOf(setup: ReactionSetup | null): TimeZone {
  return setup !== null && isTimeZone(setup.timeZone) ? setup.timeZone : DEFAULT_CLUB_TIME_ZONE;
}

/** "Today" on the club's clock, also without signal. */
export function clubToday(setup: ReactionSetup | null, nowMs: number): LocalDate {
  return localDateInTimeZone(new Date(nowMs), clubTimeZoneOf(setup));
}

/** The protocol of the version in force (its parameters and its valid stimuli). */
export function protocolOf(setup: ReactionSetup): ReactionProtocol {
  return reactionProtocol(setup.definition?.protocol.parameters, setup.definition?.attemptCount);
}

/** The player's earlier means on this device, from the local database and the queue. */
export async function readReactionHistory(input: {
  readonly store: LocalStore;
  readonly membershipId: string;
  readonly playerId: string;
  readonly deviceId: string;
}): Promise<Record<'simple' | 'go_no_go', ReactionHistoryItem[]>> {
  const [rows, queue] = await Promise.all([
    input.store.list(input.membershipId, 'test_result', { playerId: input.playerId }),
    input.store.pending(input.membershipId, REACTION_OPS),
  ]);
  return reactionHistory({ rows, queue, playerId: input.playerId, deviceId: input.deviceId });
}
