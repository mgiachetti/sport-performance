import {
  archiveGymProgram,
  correctGymSet,
  createGymProgram,
  getGymProgram,
  getGymSet,
  getPlayerGymPrograms,
  getPlayerGymSummary,
  listGymPrograms,
  listGymSets,
  logGymSets,
  restoreGymProgram,
  updateGymProgram,
  voidGymSet,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { gymProgram, gymSet } from '@sport-performance/db/schema';
import {
  GYM_SUMMARY_DEFAULT_DAYS,
  addDays,
  compareLocalDates,
  gymPlanIssues,
  gymSetIssues,
  isWithinGymLogWindow,
  summarizeGymSets,
  type CategoryId,
  type ClubId,
  type GymPlan,
  type GymSetValues,
  type LocalDate,
  type PermissionSubject,
  type PlayerId,
  type StrengthAssessment,
} from '@sport-performance/domain';
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../../db/database.js';
import { registerEndpoint } from '../../http/endpoint.js';
import { HttpError } from '../../http/errors.js';
import { keysetPage, type KeysetSpec } from '../../http/pagination.js';
import { clubToday, type RequestPermissions } from '../../http/permissions.js';
import {
  archiveStatusFilter,
  markReplay,
  updateAtVersion,
  versionMatches,
} from '../../http/writes.js';
import {
  loadPlayer,
  loadStageSources,
  stageContext,
  stageContextOn,
  type PlayerContext,
} from '../tests/model.js';
import {
  appliesTo,
  assessmentOf,
  assignedPrograms,
  assignedSetPlayers,
  categoryAssessment,
  categoryFacts,
  clubDayOf,
  exerciseSpecOf,
  gymProgramColumns,
  gymProgramDto,
  gymSetColumns,
  gymSetDto,
  gymSetDtos,
  issue,
  loadE1rmProtocols,
  planOf,
  playerDayOf,
  programAppliesTo,
  programCategories,
  programValidOn,
  readGymProgram,
  readGymSet,
  storedSpec,
  throwIssues,
  type GymProgramRow,
  type GymSetRow,
} from './model.js';

/**
 * Gym (B-607, ADR 0075): programs by stage and the sets the players
 * perform, with the e1RM of the strength protocol. The offline queue writes
 * sets through these same handlers (`gym_set.*`, ADR 0050).
 */

async function playerContext(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: string,
): Promise<PlayerContext> {
  const context = await loadPlayer(db, clubId, playerId);
  if (context === undefined) throw new HttpError('not_found', 'Player not found');
  return context;
}

// ─── Programs: authorization and rules ───────────────────────────────────────────────

/**
 * Authorizes an action on a program. A player's program targets that
 * player; a category's, the category (the staff) or, for a player reading
 * it, the player it applies to today.
 */
async function authorizeProgram(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  row: Pick<GymProgramRow, 'playerId' | 'categoryId' | 'stage'>,
  action: 'read' | 'manage',
): Promise<void> {
  if (row.playerId !== null) {
    const context = await playerContext(db, clubId, row.playerId);
    await permissions.authorize('gym_program', action, { player: context.facts });
    return;
  }
  const subject = await permissions.subject();
  if (action === 'read' && subject.role === 'player') {
    const own = subject.playerId ?? null;
    if (own === null) throw new HttpError('not_found', 'Gym program not found');
    const today = await clubToday(db);
    const day = playerDayOf(await loadStageSources(db, clubId, [own]), own, today);
    if (!programAppliesTo(row, day)) throw new HttpError('not_found', 'Gym program not found');
    const context = await playerContext(db, clubId, own);
    await permissions.authorize('gym_program', 'read', { player: context.facts });
    return;
  }
  if (row.categoryId === null) throw new Error('gym_program_target: a program without target');
  const facts = await categoryFacts(db, clubId, row.categoryId);
  await permissions.authorize('gym_program', action, {
    category: { id: facts.id, sport: facts.sport },
  });
}

/**
 * How strength is assessed for the target of a program: the stage given (or
 * the category's) for a category; the player's stage that day for a player.
 */
async function programAssessment(
  db: TenantDatabase,
  clubId: ClubId,
  target: {
    categoryId: CategoryId | null;
    playerId: PlayerId | null;
    stage: GymProgramRow['stage'];
  },
  on: LocalDate,
): Promise<StrengthAssessment> {
  if (target.categoryId !== null) {
    return categoryAssessment(await categoryFacts(db, clubId, target.categoryId), target.stage);
  }
  if (target.playerId === null) throw new Error('gym_program_target: a program without target');
  const assessment = assessmentOf(await stageContext(db, clubId, target.playerId, on, null));
  if (assessment === null) {
    throw new HttpError('conflict', 'The player is not in any category that day');
  }
  return assessment;
}

const PLAN_MESSAGES: Record<string, string> = {
  load_kind_mismatch: 'The library exercise has another load kind',
  measure_mismatch: 'The library exercise has another measure',
  name_required: "A club's own exercise needs a name",
  reps_required: 'A range of reps',
  reps_range: 'repsMax must be at least repsMin',
  reps_not_applicable: 'A timed exercise has no reps',
  duration_required: 'The seconds of the hold',
  duration_not_applicable: 'An exercise for reps has no duration',
  load_not_applicable: 'A bodyweight exercise has no load',
  loaded_exercise_not_allowed: 'M13/M14 train with the body or a stick: no external or added load',
  target_rir_required: 'M15/M16: a loaded exercise prescribes its reps in reserve',
  target_rir_below_protocol: 'M15/M16: never to failure, RIR at or above the protocol minimum',
  duplicate_day_key: 'Repeated day key',
  duplicate_exercise: 'The exercise is already in the day',
};

async function assertPlan(
  db: TenantDatabase,
  clubId: ClubId,
  plan: GymPlan,
  assessment: StrengthAssessment,
  sport: Parameters<Awaited<ReturnType<typeof loadE1rmProtocols>>>[0],
  on: LocalDate,
): Promise<void> {
  const protocol = (await loadE1rmProtocols(db, clubId))(sport, on);
  const issues = gymPlanIssues(plan, assessment, protocol).map((i) =>
    issue(['body', 'plan', ...i.path], PLAN_MESSAGES[i.code] ?? i.code),
  );
  throwIssues(issues, 'The plan breaks the rules of the stage');
}

async function sportOfTarget(
  db: TenantDatabase,
  clubId: ClubId,
  target: { categoryId: CategoryId | null; playerId: PlayerId | null },
) {
  if (target.categoryId !== null) return (await categoryFacts(db, clubId, target.categoryId)).sport;
  if (target.playerId !== null)
    return (await playerContext(db, clubId, target.playerId)).facts.sport;
  return null;
}

const PROGRAM_KEYS: KeysetSpec<GymProgramRow, 'name' | 'validFrom'> = {
  fields: {
    name: { column: gymProgram.name, type: 'text', value: (row) => row.name },
    validFrom: {
      column: sql`${gymProgram.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
  },
  id: { column: gymProgram.id, value: (row) => row.id },
};

const SET_KEYS: KeysetSpec<GymSetRow, 'performedOn'> = {
  fields: {
    performedOn: {
      column: sql`${gymSet.performedOn}::text`,
      type: 'text',
      value: (row) => row.performedOn,
    },
  },
  id: { column: gymSet.id, value: (row) => row.id },
};

// ─── Sets: rules ─────────────────────────────────────────────────────────────────────

const SET_MESSAGES: Record<string, string> = {
  reps_required: 'The reps done (at least 1)',
  reps_not_applicable: 'A timed exercise has no reps',
  duration_required: 'The seconds held',
  duration_not_applicable: 'An exercise for reps has no duration',
  load_required: 'The kg of the load (0 for no added load)',
  load_not_applicable: 'A bodyweight exercise has no load',
  loaded_exercise_not_allowed: 'M13/M14 train with the body or a stick: no external or added load',
  rir_required: 'From M15 a loaded set reports its reps in reserve',
};

/** Whether the caller logs as the player (their own sets) or as staff. */
function loggerOf(subject: PermissionSubject): 'player' | 'staff' {
  return subject.role === 'player' ? 'player' : 'staff';
}

/** The day the windows are checked against: when the device recorded it, or now. */
async function windowToday(
  db: TenantDatabase,
  clubId: ClubId,
  recordedAt: Date | undefined,
): Promise<LocalDate> {
  return recordedAt === undefined ? clubToday(db) : clubDayOf(db, clubId, recordedAt);
}

/**
 * The technique score is the staff's: the player may only echo the one stored (none on a
 * new set). Sending `null` over the score the `sc` gave would clear it.
 */
function techniqueByPlayer(
  by: 'player' | 'staff',
  techniqueScore: number | null | undefined,
  stored: number | null,
  path: (string | number)[],
): ValidationIssue[] {
  if (by === 'player' && techniqueScore !== undefined && techniqueScore !== stored) {
    return [issue(path, 'The technique score is given by the staff')];
  }
  return [];
}

function setValueIssues(
  values: GymSetValues,
  spec: ReturnType<typeof storedSpec>,
  assessment: StrengthAssessment,
  base: (string | number)[],
): ValidationIssue[] {
  return gymSetIssues(values, spec, assessment).map((i) =>
    issue([...base, i.field], SET_MESSAGES[i.code] ?? i.code),
  );
}

export function registerGymRoutes(app: FastifyInstance): void {
  // ─── Programs ──────────────────────────────────────────────────────────────────────

  registerEndpoint(app, listGymPrograms, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('gym_program', 'read');
      const plan = keysetPage(PROGRAM_KEYS, query, {
        categoryId: query.categoryId,
        playerId: query.playerId,
        status: query.status,
      });
      if (scope.kind === 'none' || scope.kind === 'platform')
        return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        throw new Error('listGymPrograms: the matrix asks for a row check the list does not do');
      }
      const today = await clubToday(db);
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedPrograms(today, scope.categoryIds, scope.sports);
          break;
        case 'players': {
          const sources = await loadStageSources(db, clubId, scope.playerIds);
          const days = scope.playerIds.map((id) => appliesTo(playerDayOf(sources, id, today)));
          inScope = days.length === 0 ? sql`false` : sql`(${sql.join(days, sql` or `)})`;
          break;
        }
      }
      const rows = await db
        .select(gymProgramColumns)
        .from(gymProgram)
        .where(
          and(
            eq(gymProgram.clubId, clubId),
            inScope,
            archiveStatusFilter(gymProgram.archivedAt, query.status),
            query.categoryId === undefined
              ? undefined
              : eq(gymProgram.categoryId, query.categoryId),
            query.playerId === undefined ? undefined : eq(gymProgram.playerId, query.playerId),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, gymProgramDto);
    },
  });

  registerEndpoint(app, getGymProgram, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readGymProgram(db, clubId, params.gymProgramId);
      await authorizeProgram(db, permissions, clubId, row, 'read');
      return gymProgramDto(row);
    },
  });

  registerEndpoint(app, createGymProgram, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const target = {
        categoryId: body.categoryId ?? null,
        playerId: body.playerId ?? null,
        stage: body.stage ?? null,
      };
      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select(gymProgramColumns)
          .from(gymProgram)
          .where(and(eq(gymProgram.clubId, clubId), eq(gymProgram.clientUuid, body.clientUuid)));
        if (replay !== undefined) {
          await authorizeProgram(db, permissions, clubId, replay, 'manage');
          markReplay(reply);
          return gymProgramDto(replay);
        }
      }
      await authorizeProgram(db, permissions, clubId, target, 'manage');
      const today = await clubToday(db);
      const on = compareLocalDates(body.validFrom, today) > 0 ? body.validFrom : today;
      const assessment = await programAssessment(db, clubId, target, on);
      await assertPlan(
        db,
        clubId,
        body.plan,
        assessment,
        await sportOfTarget(db, clubId, target),
        on,
      );
      const [row] = await db
        .insert(gymProgram)
        .values({
          clubId,
          ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
          name: body.name,
          ...target,
          plan: body.plan,
          notes: body.notes ?? null,
          validFrom: body.validFrom,
          validTo: body.validTo ?? null,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        })
        .onConflictDoNothing({ target: [gymProgram.clubId, gymProgram.clientUuid] })
        .returning(gymProgramColumns);
      // The same clientUuid committed by a concurrent request, or of a row not visible.
      if (row === undefined) throw new HttpError('conflict', 'This clientUuid was already used');
      return gymProgramDto(row);
    },
  });

  registerEndpoint(app, updateGymProgram, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await readGymProgram(db, clubId, params.gymProgramId);
      await authorizeProgram(db, permissions, clubId, current, 'manage');
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'An archived program is restored before editing');
      }
      if (body.stage !== undefined && body.stage !== null && current.categoryId === null) {
        throw new HttpError('validation_failed', 'A stage only with a category', {
          details: [issue(['body', 'stage'], "A player's program follows the player's stage")],
        });
      }
      const next = {
        stage: body.stage === undefined ? current.stage : body.stage,
        validFrom: body.validFrom ?? current.validFrom,
        validTo: body.validTo === undefined ? current.validTo : body.validTo,
        plan: body.plan ?? planOf(current),
      };
      if (next.validTo !== null && compareLocalDates(next.validTo, next.validFrom) <= 0) {
        throw new HttpError('validation_failed', 'The end is after the start', {
          details: [issue(['body', 'validTo'], 'After validFrom')],
        });
      }
      // The rules of the stage are checked whenever what they depend on changes.
      if (body.plan !== undefined || body.stage !== undefined || body.validFrom !== undefined) {
        const today = await clubToday(db);
        const on = compareLocalDates(next.validFrom, today) > 0 ? next.validFrom : today;
        const target = {
          categoryId: current.categoryId,
          playerId: current.playerId,
          stage: next.stage,
        };
        await assertPlan(
          db,
          clubId,
          next.plan,
          await programAssessment(db, clubId, target, on),
          await sportOfTarget(db, clubId, target),
          on,
        );
      }
      const row = await updateAtVersion({
        resource: 'Gym program',
        update: async () =>
          (
            await db
              .update(gymProgram)
              .set({
                ...(body.name !== undefined && { name: body.name }),
                ...(body.stage !== undefined && { stage: body.stage }),
                ...(body.plan !== undefined && { plan: body.plan }),
                ...(body.notes !== undefined && { notes: body.notes }),
                ...(body.validFrom !== undefined && { validFrom: body.validFrom }),
                ...(body.validTo !== undefined && { validTo: body.validTo }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(gymProgram.clubId, clubId),
                  eq(gymProgram.id, current.id),
                  versionMatches(gymProgram.updatedAt, body.version),
                ),
              )
              .returning(gymProgramColumns)
          )[0],
        exists: () => Promise.resolve(true),
      });
      return gymProgramDto(row);
    },
  });

  for (const [endpoint, archived] of [
    [archiveGymProgram, true],
    [restoreGymProgram, false],
  ] as const) {
    registerEndpoint(app, endpoint, {
      transaction: true,
      handler: async ({ params }, { db, permissions, auth: caller }) => {
        const { clubId } = caller.membership;
        const row = await readGymProgram(db, clubId, params.gymProgramId);
        await authorizeProgram(db, permissions, clubId, row, 'manage');
        if ((row.archivedAt !== null) === archived) return gymProgramDto(row);
        await db
          .update(gymProgram)
          .set({ archivedAt: archived ? sql`now()` : null, updatedBy: caller.userId })
          .where(and(eq(gymProgram.clubId, clubId), eq(gymProgram.id, row.id)));
        return gymProgramDto(await readGymProgram(db, clubId, row.id));
      },
    });
  }

  registerEndpoint(app, getPlayerGymPrograms, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const context = await playerContext(db, clubId, params.playerId);
      await permissions.authorize('gym_program', 'read', { player: context.facts });
      const on = query.on ?? (await clubToday(db));
      const sources = await loadStageSources(db, clubId, [context.id]);
      const day = playerDayOf(sources, context.id, on);
      const stageContextOfDay = await stageContext(db, clubId, context.id, on, null);
      const rows = await db
        .select(gymProgramColumns)
        .from(gymProgram)
        .where(
          and(
            eq(gymProgram.clubId, clubId),
            isNull(gymProgram.archivedAt),
            programValidOn(on),
            appliesTo(day),
          ),
        );
      // The player's own first, then the category's; by name.
      rows.sort(
        (a, b) =>
          Number(a.playerId === null) - Number(b.playerId === null) ||
          a.name.localeCompare(b.name, 'es'),
      );
      const protocol = (await loadE1rmProtocols(db, clubId))(
        stageContextOfDay?.sport ?? context.facts.sport,
        on,
      );
      return {
        playerId: context.id,
        on,
        stage: day.stage,
        strengthAssessment: assessmentOf(stageContextOfDay),
        e1rmProtocol: { ...protocol },
        programs: rows.map(gymProgramDto),
      };
    },
  });

  // ─── Sets ──────────────────────────────────────────────────────────────────────────

  registerEndpoint(app, logGymSets, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply, recordedAt }) => {
      const { clubId } = caller.membership;
      const subject = await permissions.subject();
      const by = loggerOf(subject);
      const playerId = body.playerId ?? subject.playerId ?? null;
      if (playerId === null) {
        // Neither a player nor a player in the body: the matrix answers (or the body is wrong).
        await permissions.authorize('gym_set', 'log');
        throw new HttpError('validation_failed', 'Which player the sets are of', {
          details: [issue(['body', 'playerId'], 'Required unless you are the player')],
        });
      }
      const context = await playerContext(db, clubId, playerId);
      await permissions.authorize('gym_set', 'log', { player: context.facts });

      // Replays of the offline queue answer what they created, even once the window closed.
      const uuids = body.sets.flatMap((set) =>
        set.clientUuid === undefined ? [] : [set.clientUuid],
      );
      const existing =
        uuids.length === 0
          ? []
          : await db
              .select(gymSetColumns)
              .from(gymSet)
              .where(and(eq(gymSet.clubId, clubId), inArray(gymSet.clientUuid, uuids)));
      const byUuid = new Map(existing.map((row) => [row.clientUuid, row]));
      for (const row of existing) {
        if (row.playerId !== context.id) {
          throw new HttpError('conflict', 'This clientUuid was already used');
        }
      }
      const fresh = body.sets
        .map((set, index) => ({ set, index }))
        .filter(({ set }) => set.clientUuid === undefined || !byUuid.has(set.clientUuid));

      const today = await windowToday(db, clubId, recordedAt);
      const day = body.performedOn ?? today;
      const issues: ValidationIssue[] = [];
      let program: GymProgramRow | null = null;
      const inserted = new Map<number, GymSetRow>();
      if (fresh.length > 0) {
        if (!isWithinGymLogWindow(day, today, by)) {
          throw new HttpError('validation_failed', 'Sets are logged for a past day', {
            details: [
              issue(
                ['body', 'performedOn'],
                by === 'player'
                  ? `A club day of the last week, up to today (${today})`
                  : `A club day up to today (${today})`,
              ),
            ],
          });
        }
        const sources = await loadStageSources(db, clubId, [context.id]);
        const programId = body.gymProgramId ?? null;
        const dayKey = body.dayKey ?? null;
        if (programId !== null) {
          const [row] = await db
            .select(gymProgramColumns)
            .from(gymProgram)
            .where(and(eq(gymProgram.clubId, clubId), eq(gymProgram.id, programId)));
          const applies =
            row?.archivedAt === null &&
            compareLocalDates(row.validFrom, day) <= 0 &&
            (row.validTo === null || compareLocalDates(row.validTo, day) > 0) &&
            programAppliesTo(row, playerDayOf(sources, context.id, day));
          if (!applies) {
            issues.push(
              issue(['body', 'gymProgramId'], 'A program in force for the player that day'),
            );
          } else {
            program = row;
            if (dayKey !== null && !planOf(row).days.some((d) => d.key === dayKey)) {
              issues.push(issue(['body', 'dayKey'], 'A day of the program'));
            }
          }
        }
        // Against a category program, the stage in that category (a player in two that day).
        const assessment = assessmentOf(
          stageContextOn(sources, context.id, day, program?.categoryId ?? null),
        );
        if (assessment === null) {
          throw new HttpError('conflict', 'The player is not in any category that day');
        }
        const specs = fresh.map(({ set, index }) => {
          const base = ['body', 'sets', index];
          issues.push(
            ...techniqueByPlayer(by, set.techniqueScore, null, [...base, 'techniqueScore']),
          );
          const spec = exerciseSpecOf(set.exerciseCode, program, dayKey);
          if (spec === undefined) {
            issues.push(
              issue([...base, 'exerciseCode'], 'An exercise of the program or of the library'),
            );
            return undefined;
          }
          const values: GymSetValues = {
            reps: set.reps ?? null,
            loadKg: set.loadKg ?? null,
            rir: set.rir ?? null,
            techniqueScore: set.techniqueScore ?? null,
            durationS: set.durationS ?? null,
          };
          issues.push(...setValueIssues(values, spec, assessment, base));
          return spec;
        });
        throwIssues(issues, 'The sets do not fit the exercises or the stage');
        for (const [position, { set, index }] of fresh.entries()) {
          const spec = specs[position];
          if (spec === undefined) continue;
          const [row] = await db
            .insert(gymSet)
            .values({
              clubId,
              ...(set.clientUuid !== undefined && { clientUuid: set.clientUuid }),
              playerId: context.id,
              gymProgramId: program?.id ?? null,
              dayKey: program === null ? null : dayKey,
              performedOn: day,
              exerciseCode: set.exerciseCode,
              loadKind: spec.loadKind,
              setNumber: set.setNumber,
              reps: set.reps ?? null,
              loadKg: set.loadKg ?? null,
              rir: set.rir ?? null,
              techniqueScore: set.techniqueScore ?? null,
              durationS: set.durationS ?? null,
              notes: set.notes ?? null,
              createdBy: caller.userId,
              updatedBy: caller.userId,
            })
            .onConflictDoNothing({ target: [gymSet.clubId, gymSet.clientUuid] })
            .returning(gymSetColumns);
          if (row === undefined)
            throw new HttpError('conflict', 'This clientUuid was already used');
          inserted.set(index, row);
        }
      } else {
        markReplay(reply);
      }
      const rows = body.sets.map((set, index) => {
        const created = inserted.get(index);
        if (created !== undefined) return { outcome: 'created' as const, row: created };
        const replayed = set.clientUuid === undefined ? undefined : byUuid.get(set.clientUuid);
        if (replayed === undefined)
          throw new Error('logGymSets: a set neither created nor replayed');
        return { outcome: 'replayed' as const, row: replayed };
      });
      const dtos = await gymSetDtos(
        db,
        clubId,
        rows.map((r) => r.row),
      );
      return {
        items: dtos.map((set, index) => ({ outcome: rows[index]?.outcome ?? 'created', set })),
      };
    },
  });

  registerEndpoint(app, correctGymSet, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller, recordedAt }) => {
      const { clubId } = caller.membership;
      const current = await readGymSet(db, clubId, params.gymSetId);
      const context = await playerContext(db, clubId, current.playerId);
      await permissions.authorize('gym_set', 'correct', { player: context.facts });
      if (current.voidedAt !== null) throw new HttpError('conflict', 'The set was voided');
      const by = loggerOf(await permissions.subject());
      const today = await windowToday(db, clubId, recordedAt);
      if (!isWithinGymLogWindow(current.performedOn, today, by)) {
        throw new HttpError('conflict', 'The player corrects the sets of the last week only');
      }
      const issues = techniqueByPlayer(by, body.techniqueScore, current.techniqueScore, [
        'body',
        'techniqueScore',
      ]);
      const values: GymSetValues = {
        reps: body.reps === undefined ? current.reps : body.reps,
        loadKg: body.loadKg === undefined ? current.loadKg : body.loadKg,
        rir: body.rir === undefined ? current.rir : body.rir,
        techniqueScore:
          body.techniqueScore === undefined ? current.techniqueScore : body.techniqueScore,
        durationS: body.durationS === undefined ? current.durationS : body.durationS,
      };
      const programCategory =
        current.gymProgramId === null
          ? null
          : ((await programCategories(db, clubId, [current.gymProgramId])).get(
              current.gymProgramId,
            ) ?? null);
      const assessment = assessmentOf(
        await stageContext(db, clubId, current.playerId, current.performedOn, programCategory),
      );
      if (assessment === null) {
        throw new HttpError('conflict', 'The player is not in any category that day');
      }
      issues.push(...setValueIssues(values, storedSpec(current), assessment, ['body']));
      throwIssues(issues, 'The set does not fit the exercise or the stage');
      const row = await updateAtVersion({
        resource: 'Gym set',
        update: async () =>
          (
            await db
              .update(gymSet)
              .set({
                ...values,
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(gymSet.clubId, clubId),
                  eq(gymSet.id, current.id),
                  versionMatches(gymSet.updatedAt, body.version),
                ),
              )
              .returning(gymSetColumns)
          )[0],
        exists: () => Promise.resolve(true),
      });
      return gymSetDto(db, clubId, row);
    },
  });

  registerEndpoint(app, voidGymSet, {
    transaction: true,
    changeReason: ({ body }) => body.reason,
    handler: async ({ params, body }, { db, permissions, auth: caller, recordedAt }) => {
      const { clubId } = caller.membership;
      const current = await readGymSet(db, clubId, params.gymSetId);
      const context = await playerContext(db, clubId, current.playerId);
      await permissions.authorize('gym_set', 'correct', { player: context.facts });
      // The window holds for a replay too: past it, voiding is the staff's.
      const by = loggerOf(await permissions.subject());
      if (by === 'player' && current.voidedAt === null) {
        // A set the staff logged (with its technique score) is the staff's to void.
        const [owner] = await db
          .select({ createdBy: gymSet.createdBy })
          .from(gymSet)
          .where(and(eq(gymSet.clubId, clubId), eq(gymSet.id, current.id)));
        if (owner?.createdBy !== caller.userId) {
          throw new HttpError('forbidden', 'The player voids the sets they logged only');
        }
      }
      const today = await windowToday(db, clubId, recordedAt);
      if (!isWithinGymLogWindow(current.performedOn, today, by)) {
        throw new HttpError('conflict', 'The player voids the sets of the last week only');
      }
      if (current.voidedAt === null) {
        await db
          .update(gymSet)
          .set({
            voidedAt: sql`now()`,
            voidedBy: caller.userId,
            voidReason: body.reason,
            updatedBy: caller.userId,
          })
          .where(and(eq(gymSet.clubId, clubId), eq(gymSet.id, current.id)));
      }
      const row = await readGymSet(db, clubId, current.id);
      return gymSetDto(db, clubId, row);
    },
  });

  registerEndpoint(app, listGymSets, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('gym_set', 'read');
      const plan = keysetPage(SET_KEYS, query, {
        playerId: query.playerId,
        exerciseCode: query.exerciseCode,
        from: query.from,
        to: query.to,
        includeVoided: query.includeVoided,
      });
      if (scope.kind === 'none' || scope.kind === 'platform')
        return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        throw new Error('listGymSets: the matrix asks for a row check the list does not do');
      }
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedSetPlayers(
            gymSet.playerId,
            gymSet.clubId,
            await clubToday(db),
            scope.categoryIds,
            scope.sports,
          );
          break;
        case 'players':
          inScope = inArray(gymSet.playerId, [...scope.playerIds]);
          break;
      }
      const rows = await db
        .select(gymSetColumns)
        .from(gymSet)
        .where(
          and(
            eq(gymSet.clubId, clubId),
            inScope,
            query.includeVoided ? undefined : isNull(gymSet.voidedAt),
            query.playerId === undefined ? undefined : eq(gymSet.playerId, query.playerId),
            query.exerciseCode === undefined
              ? undefined
              : eq(gymSet.exerciseCode, query.exerciseCode),
            query.from === undefined ? undefined : gte(gymSet.performedOn, query.from),
            query.to === undefined ? undefined : lte(gymSet.performedOn, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      return { items: await gymSetDtos(db, clubId, page.items), nextCursor: page.nextCursor };
    },
  });

  registerEndpoint(app, getGymSet, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readGymSet(db, clubId, params.gymSetId);
      const context = await playerContext(db, clubId, row.playerId);
      await permissions.authorize('gym_set', 'read', { player: context.facts });
      return gymSetDto(db, clubId, row);
    },
  });

  registerEndpoint(app, getPlayerGymSummary, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const context = await playerContext(db, clubId, params.playerId);
      await permissions.authorize('gym_set', 'read', { player: context.facts });
      // Without `from`, the year up to `to` (or today): the read stays bounded.
      const to = query.to ?? (await clubToday(db));
      const from = query.from ?? addDays(to, -(GYM_SUMMARY_DEFAULT_DAYS - 1));
      if (compareLocalDates(from, to) > 0) {
        throw new HttpError('validation_failed', 'The range ends before it starts', {
          details: [issue(['query', 'to'], 'A day on or after from')],
        });
      }
      const rows = await db
        .select(gymSetColumns)
        .from(gymSet)
        .where(
          and(
            eq(gymSet.clubId, clubId),
            eq(gymSet.playerId, context.id),
            isNull(gymSet.voidedAt),
            gte(gymSet.performedOn, from),
            lte(gymSet.performedOn, to),
          ),
        );
      const dtos = await gymSetDtos(db, clubId, rows);
      const exercises = summarizeGymSets(
        dtos.map((set) => ({
          exerciseCode: set.exerciseCode,
          performedOn: set.performedOn,
          e1rmKg: set.e1rmKg,
        })),
      );
      return {
        playerId: context.id,
        from,
        to,
        exercises: exercises.map((e) => ({ ...e, series: [...e.series] })),
      };
    },
  });
}
