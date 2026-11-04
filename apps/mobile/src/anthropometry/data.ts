import {
  ANTHRO_BATCH_MAX,
  type AnthroMeasurement,
  type ApiClient,
  type Page,
  type SyncOperationInput,
} from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  SEXES,
  STAGES,
  isTimeZone,
  parseLocalDate,
  ruleFor,
  type LocalDate,
  type Role,
  type Sex,
  type Stage,
  type TimeZone,
} from '@sport-performance/domain';
import type { SyncEngine, SyncScopeRef } from '../offline/engine.ts';
import { applyOverlay } from '../offline/overlay.ts';
import type { CachedValue, ReadCache, ReadSchema } from '../offline/read-cache.ts';
import {
  valuesOf,
  type QueuedMeasurement,
  type ServedMeasurement,
  type SquadPlayer,
} from './model.ts';

/**
 * The field anthropometry through the local database (B-508, ADR 0083).
 * The measurements are the synced `anthro_measurement` rows plus the
 * creates of the queue; the categories, the squad and what the server
 * knows of each player (stage, consent, parents' heights) are cached reads,
 * refreshed whenever there is signal. Nothing here talks to the API but
 * those refreshes; every write goes through the sync queue.
 */

/** Who loads measurements on the phone: whoever the matrix lets record them (`sc`, admin). */
export function canRecordAnthropometry(role: Role): boolean {
  return ruleFor('anthropometry', 'record', role).effect === 'allow';
}

export const CONTEXT_KEY = 'anthro.context';
export const squadKey = (categoryId: string) => `anthro.squad:${categoryId}`;

// ─── Cached documents and their checks ──────────────────────────────────────────────

export interface AnthroCategory {
  readonly id: string;
  readonly name: string;
}

/** The club's day (its time zone) and the categories where the user records measurements. */
export interface AnthroContext {
  readonly timeZone: string;
  readonly categories: readonly AnthroCategory[];
}

/** The squad of a category as it was downloaded, for the sheet without signal. */
export interface SquadDocument {
  readonly categoryId: string;
  /** The day the stage and the gaps were read for. */
  readonly measuredOn: LocalDate;
  readonly players: readonly SquadPlayer[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';

function localDateOrNull(value: unknown): LocalDate | null {
  if (!isString(value)) return null;
  try {
    return parseLocalDate(value);
  } catch {
    return null;
  }
}

export const contextSchema: ReadSchema<AnthroContext> = {
  safeParse(value) {
    if (!isRecord(value) || !isString(value.timeZone) || !Array.isArray(value.categories)) {
      return { success: false };
    }
    const categories: AnthroCategory[] = [];
    for (const item of value.categories as unknown[]) {
      if (!isRecord(item) || !isString(item.id) || !isString(item.name)) return { success: false };
      categories.push({ id: item.id, name: item.name });
    }
    return { success: true, data: { timeZone: value.timeZone, categories } };
  },
};

function squadPlayerOf(value: unknown): SquadPlayer | null {
  if (!isRecord(value)) return null;
  const { id, name, sex, birthDate, stage, blocked, parentHeightsMissing } = value;
  const birth = localDateOrNull(birthDate);
  if (
    !isString(id) ||
    !isString(name) ||
    !(SEXES as readonly unknown[]).includes(sex) ||
    birth === null ||
    !(stage === null || (STAGES as readonly unknown[]).includes(stage)) ||
    typeof blocked !== 'boolean' ||
    typeof parentHeightsMissing !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    name,
    sex: sex as Sex,
    birthDate: birth,
    stage: stage as Stage | null,
    blocked,
    parentHeightsMissing,
  };
}

export const squadSchema: ReadSchema<SquadDocument> = {
  safeParse(value) {
    if (!isRecord(value) || !isString(value.categoryId) || !Array.isArray(value.players)) {
      return { success: false };
    }
    const measuredOn = localDateOrNull(value.measuredOn);
    if (measuredOn === null) return { success: false };
    const players: SquadPlayer[] = [];
    for (const item of value.players as unknown[]) {
      const player = squadPlayerOf(item);
      if (player === null) return { success: false };
      players.push(player);
    }
    return { success: true, data: { categoryId: value.categoryId, measuredOn, players } };
  },
};

/** The club's time zone: "today" is the club's day (CLAUDE.md), the default until it is read. */
export function clubTimeZone(context: AnthroContext | null): TimeZone {
  return context !== null && isTimeZone(context.timeZone)
    ? context.timeZone
    : DEFAULT_CLUB_TIME_ZONE;
}

// ─── Refreshing the cached reads (with signal) ──────────────────────────────────────

export interface KeptThenFresh<T> {
  /** What the phone has (`null`: nothing, or a document that no longer reads). */
  readonly read: () => Promise<CachedValue<T> | null>;
  /** The server's, kept on the phone by the refresh itself. */
  readonly refresh: () => Promise<T>;
  readonly now: () => number;
  readonly onValue: (value: { readonly data: T; readonly savedAt: number }) => void;
  /** Nothing on the phone and the refresh failed (no signal, a refusal): why. */
  readonly onMissing: (error: unknown) => void;
  readonly onRefreshing?: (refreshing: boolean) => void;
  /** The screen left or asked for something else: nothing more is reported. */
  readonly cancelled: () => boolean;
}

/**
 * What the phone has at once, then the server's when there is signal. A
 * failed refresh keeps what was shown: without signal, the sheet works with
 * the last squad it read.
 */
export async function keptThenFresh<T>(options: KeptThenFresh<T>): Promise<void> {
  const kept = await options.read();
  if (options.cancelled()) return;
  if (kept !== null) options.onValue({ data: kept.value, savedAt: kept.fetchedAt });
  options.onRefreshing?.(true);
  try {
    const fresh = await options.refresh();
    if (!options.cancelled()) options.onValue({ data: fresh, savedAt: options.now() });
  } catch (error) {
    if (!options.cancelled() && kept === null) options.onMissing(error);
  } finally {
    if (!options.cancelled()) options.onRefreshing?.(false);
  }
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

async function allPages<Item>(
  fetchPage: (cursor: string | undefined) => Promise<Page<Item>>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return items;
}

type ContextApi = Pick<ApiClient, 'getClub' | 'listCategories' | 'listMyStaffAssignments'>;

/**
 * The categories where the user records: the whole club for the
 * administration, the assigned ones (by category or by sport) for the
 * staff, as the matrix scopes `anthropometry.record`.
 */
export async function refreshContext(
  api: ContextApi,
  cache: Pick<ReadCache, 'put'>,
  scope: SyncScopeRef,
  role: Role,
  signal?: AbortSignal,
): Promise<AnthroContext> {
  const options = signal === undefined ? {} : { signal };
  const club = await api.getClub(undefined, options);
  const categories = await allPages((cursor) =>
    api.listCategories(
      {
        query: {
          status: 'active',
          limit: PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        },
      },
      options,
    ),
  );
  const rule = ruleFor('anthropometry', 'record', role);
  let visible = categories;
  if (rule.effect === 'deny') visible = [];
  else if (rule.scope === 'assigned') {
    const assignments = await allPages((cursor) =>
      api.listMyStaffAssignments(
        {
          query: {
            status: 'current',
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          },
        },
        options,
      ),
    );
    const ids = new Set<string>();
    const sports = new Set<string>();
    for (const { target } of assignments) {
      if (target.kind === 'category') ids.add(target.categoryId);
      else sports.add(target.sport);
    }
    visible = categories.filter((c) => ids.has(c.id) || sports.has(c.sport));
  }
  const context: AnthroContext = {
    timeZone: club.timeZone,
    categories: visible.map((c) => ({ id: c.id, name: c.name })),
  };
  await cache.put(scope, CONTEXT_KEY, context);
  return context;
}

type SquadApi = Pick<ApiClient, 'listPlayers' | 'previewAnthroMeasurements'>;

/**
 * The active squad of a category and, from the preview of an empty sheet
 * (ADR 0064), each player's stage on the day, whether their data may be
 * kept and whether the parents' heights are missing. Kept whole: the sheet
 * opens with it without signal.
 */
export async function refreshSquad(
  api: SquadApi,
  cache: Pick<ReadCache, 'put'>,
  scope: SyncScopeRef,
  categoryId: string,
  measuredOn: LocalDate,
  signal?: AbortSignal,
): Promise<SquadDocument> {
  const options = signal === undefined ? {} : { signal };
  const players = await allPages((cursor) =>
    api.listPlayers(
      {
        query: {
          categoryId,
          status: 'active',
          sort: 'name',
          limit: PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        },
      },
      options,
    ),
  );
  const preview = new Map<string, { stage: Stage | null; blocked: boolean; parents: boolean }>();
  for (let from = 0; from < players.length; from += ANTHRO_BATCH_MAX) {
    const chunk = players.slice(from, from + ANTHRO_BATCH_MAX);
    const answer = await api.previewAnthroMeasurements(
      { body: { measurements: chunk.map((p) => ({ playerId: p.id, measuredOn })) } },
      options,
    );
    for (const item of answer.items) {
      preview.set(item.playerId, {
        stage: item.stage,
        blocked: item.blockedBy !== null,
        parents: item.gaps.adultHeight.includes('parent_heights_missing'),
      });
    }
  }
  const document: SquadDocument = {
    categoryId,
    measuredOn,
    players: players.map((player) => {
      const known = preview.get(player.id);
      return {
        id: player.id,
        name: `${player.firstName} ${player.lastName}`,
        sex: player.sex,
        birthDate: player.birthDate,
        stage: known?.stage ?? null,
        blocked: known?.blocked ?? false,
        parentHeightsMissing: known?.parents ?? false,
      };
    }),
  };
  await cache.put(scope, squadKey(categoryId), document);
  return document;
}

// ─── Measurements from the local database and the queue ────────────────────────────

/**
 * The served measurements of the players on the day and the creates of the
 * queue with the corrections queued after them (a create not served yet
 * has no row to lay them over: they are applied here, in queue order, with
 * the same overlay the served rows get).
 */
export async function loadMeasurements(
  sync: Pick<SyncEngine, 'store'>,
  membershipId: string,
  measuredOn: LocalDate,
  playerIds: ReadonlySet<string>,
): Promise<{ served: ServedMeasurement[]; queued: QueuedMeasurement[] }> {
  const rows = await sync.store.list(membershipId, 'anthro_measurement', {
    from: measuredOn,
    to: measuredOn,
  });
  const served = rows
    .filter((row) => playerIds.has(row.data.playerId))
    .map((row) => ({ data: row.data, clientUuid: row.clientUuid, pending: row.pending }));
  const queue = await sync.store.pending(membershipId, ['anthro.record', 'anthro.update']);
  const creates = new Map<string, AnthroMeasurement>();
  for (const mutation of queue) {
    if (mutation.op === 'anthro.record') {
      const input = mutation.input as QueuedInput<'anthro.record'>;
      for (const measurement of input.body.measurements) {
        if (measurement.clientUuid === undefined || !playerIds.has(measurement.playerId)) continue;
        creates.set(measurement.clientUuid, queuedDto(measurement, mutation.createdAt));
      }
      continue;
    }
    const input = mutation.input as QueuedInput<'anthro.update'>;
    if (!('clientUuid' in input.target)) continue;
    const create = creates.get(input.target.clientUuid);
    if (create === undefined) continue;
    creates.set(
      input.target.clientUuid,
      applyOverlay('anthro.update', create, input, {
        enqueuedAt: mutation.createdAt,
      }) as AnthroMeasurement,
    );
  }
  const queued: QueuedMeasurement[] = [...creates.entries()].map(([clientUuid, dto]) => ({
    clientUuid,
    playerId: dto.playerId,
    measuredOn: dto.measuredOn,
    values: valuesOf(dto),
  }));
  return { served, queued };
}

type QueuedInput<Op extends 'anthro.record' | 'anthro.update'> = SyncOperationInput<Op>;

type QueuedCreate = QueuedInput<'anthro.record'>['body']['measurements'][number];

/** The shape of a served row for a create of the queue, so a correction lays over it the same. */
function queuedDto(measurement: QueuedCreate, enqueuedAt: number): AnthroMeasurement {
  const at = new Date(enqueuedAt).toISOString();
  return {
    id: measurement.clientUuid ?? '',
    playerId: measurement.playerId,
    testSessionId: measurement.testSessionId ?? null,
    measuredOn: measurement.measuredOn ?? ('' as LocalDate),
    heightCm: measurement.heightCm ?? null,
    sittingHeightCm: measurement.sittingHeightCm ?? null,
    weightKg: measurement.weightKg ?? null,
    skinfoldsSumMm: measurement.skinfoldsSumMm ?? null,
    method: measurement.method ?? 'manual',
    evaluatorId: measurement.evaluatorId ?? null,
    conditions: { ...measurement.conditions },
    notes: measurement.notes ?? null,
    maturation: {
      phvOffsetYears: null,
      maturityOffsetEquation: null,
      predictedAdultHeightCm: null,
      adultHeightPct: null,
      growthVelocityCmYear: null,
      derivedAt: null,
    },
    createdAt: at,
    updatedAt: at,
    version: '',
  } as AnthroMeasurement;
}
