import {
  CANONICAL_METRICS,
  DEFAULT_AGE_BANDS,
  DEFAULT_CLUB_TIME_ZONE,
  DEFAULT_POSITION_LINES,
  SPORT_FIELD_RULES,
  STAGE_PROFILES,
  addDays,
  ageBandForBirthYear,
  compareLocalDates,
  dayBoundsInTimeZone,
  daysBetween,
  decimalAgeYears,
  defaultTestWindows,
  deriveResultMetrics,
  isCanonicalMetricCode,
  isLocalDate,
  isoWeekday,
  localDate,
  localDateParts,
  localDateRange,
  periodMinutesTotal,
  recordsPeriodMinutes,
  scoreResultMetrics,
  sportRecordsContacts,
  scoreTestEntry,
  testScoringSettings,
  wellnessItemSetForStage,
  type AvailabilityStatus,
  type CanonicalTestCode,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type Sex,
  type Sport,
  type Stage,
  type TestEntryInput,
  type TimeZone,
} from '@sport-performance/domain';
import { batterySeeds } from '../battery.js';
import { testDefinitionSeeds, type TestDefinitionSeed } from '../test-definitions.js';
import {
  COMPETITION_BY_SPORT,
  FEMALE_FIRST_NAMES,
  HOME_VENUE,
  MALE_FIRST_NAMES,
  OPPONENTS,
  SURNAMES,
  TRAINING_VENUE,
} from './names.js';
import { clamp, randomFor, round, shortTag, stableUuid, type Random } from './random.js';
import type {
  DemoAnthro,
  DemoCategoryKey,
  DemoConsent,
  DemoDataset,
  DemoDeparture,
  DemoEntry,
  DemoExternalMetric,
  DemoFixture,
  DemoGuardian,
  DemoHold,
  DemoInjury,
  DemoMembership,
  DemoParentHeight,
  DemoParticipation,
  DemoPlayer,
  DemoPlayerCategory,
  DemoPlayerPosition,
  DemoReferenceValue,
  DemoScenario,
  DemoSeason,
  DemoStaffAssignment,
  DemoTestResult,
  DemoTestSession,
  DemoTestValue,
  DemoTestWindow,
  DemoTrainingSession,
  DemoUser,
  DemoWellness,
} from './types.js';

/**
 * Demo data generator (B-307, ADR 0055): a pure function of its options.
 *
 * Every row is a function of the seed and its natural key only (see
 * `random.ts`); `asOf` only decides which rows exist yet (nothing after it)
 * and the state of the few that move forward (a season that ended closes its
 * categories, an M19 who finished leaves, an injury heals, a scheduled test
 * day is done). So the dataset of a later day is the dataset of an earlier
 * day plus rows, and re-running the seed never rewrites what it wrote.
 */

/** First day the demo can describe; the scenario cycles are anchored to it. */
export const DEMO_EPOCH = localDate(2024, 1, 1);
/** Daily data (sessions, RPE, wellness, weekly CMJ) reach this many days back by default. */
export const DEFAULT_DEMO_HISTORY_DAYS = 84;
/** Seasons with test days and anthropometry by default: the current one and the previous one. */
export const DEFAULT_DEMO_SEASONS = 2;
export const DEFAULT_DEMO_SLUG = 'demo';
export const DEFAULT_DEMO_SEED = 'demo';
/** Reserved for documentation (RFC 2606): nothing is ever delivered to it. */
export const DEFAULT_DEMO_EMAIL_DOMAIN = 'example.com';
/** Players per birth year and branch; the M19 band spans two birth years. */
export const DEFAULT_DEMO_PLAYERS_PER_COHORT: Readonly<Record<Sport, number>> = {
  rugby: 12,
  hockey: 10,
};
/** The scenario slots (1–5) and a featured player (0) need six per cohort. */
export const MIN_DEMO_PLAYERS_PER_COHORT = 6;

/** A demo slug starts with `demo`, so demo clubs, users and emails are recognisable. */
export const DEMO_SLUG_PATTERN = /^demo(-[a-z0-9]+)*$/;

/**
 * Featured accounts with memorable emails (`demo.familia@…`, `demo.jugador@…`,
 * `demo.jugadora@…`), by birth year: a family with a son in rugby and a
 * daughter in hockey, an M17 rugby player and an adult M19 hockey player in
 * the 2026 season. They age like everyone else; bump the years to feature
 * younger players once they graduate.
 */
export const DEMO_FEATURED = {
  familyRugbyChildBirthYear: 2012,
  familyHockeyChildBirthYear: 2010,
  rugbyPlayerBirthYear: 2009,
  hockeyPlayerBirthYear: 2008,
} as const;

export interface DemoOptions {
  /** Last club day the data reaches (usually today in the club's zone). */
  readonly asOf: LocalDate;
  /** Club slug, `demo` by default; must match {@link DEMO_SLUG_PATTERN}. */
  readonly slug?: string;
  /** Seed of the randomness; ids depend on it too, so one seed per club. */
  readonly seed?: string;
  readonly historyDays?: number;
  readonly seasons?: number;
  /** Domain of every demo email; `example.com` unless staging has a catch-all inbox. */
  readonly emailDomain?: string;
  readonly playersPerCohort?: Partial<Readonly<Record<Sport, number>>>;
}

export class DemoOptionsError extends Error {
  override readonly name = 'DemoOptionsError';
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface ResolvedOptions {
  readonly asOf: LocalDate;
  readonly slug: string;
  readonly seed: string;
  readonly historyDays: number;
  readonly seasons: number;
  readonly emailDomain: string;
  readonly playersPerCohort: Readonly<Record<Sport, number>>;
}

export function resolveDemoOptions(options: DemoOptions): ResolvedOptions {
  const slug = options.slug ?? DEFAULT_DEMO_SLUG;
  if (!DEMO_SLUG_PATTERN.test(slug)) {
    throw new DemoOptionsError(`A demo club slug starts with "demo" (got "${slug}").`);
  }
  const seed = options.seed ?? DEFAULT_DEMO_SEED;
  if (seed.trim() === '' || seed.length > 100) {
    throw new DemoOptionsError('The demo seed must be 1 to 100 characters.');
  }
  if (!isLocalDate(options.asOf)) {
    throw new DemoOptionsError(`Invalid asOf: ${String(options.asOf)}.`);
  }
  if (compareLocalDates(options.asOf, addDays(DEMO_EPOCH, 366)) < 0) {
    throw new DemoOptionsError(`asOf must be on or after ${addDays(DEMO_EPOCH, 366)}.`);
  }
  const historyDays = options.historyDays ?? DEFAULT_DEMO_HISTORY_DAYS;
  if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 366) {
    throw new DemoOptionsError('historyDays must be an integer from 1 to 366.');
  }
  const seasons = options.seasons ?? DEFAULT_DEMO_SEASONS;
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 6) {
    throw new DemoOptionsError('seasons must be an integer from 1 to 6.');
  }
  const emailDomain = (options.emailDomain ?? DEFAULT_DEMO_EMAIL_DOMAIN).toLowerCase();
  if (!DOMAIN_PATTERN.test(emailDomain)) {
    throw new DemoOptionsError(`Invalid email domain: ${emailDomain}.`);
  }
  const playersPerCohort = { ...DEFAULT_DEMO_PLAYERS_PER_COHORT, ...options.playersPerCohort };
  for (const [sport, n] of Object.entries(playersPerCohort)) {
    if (!Number.isInteger(n) || n < MIN_DEMO_PLAYERS_PER_COHORT || n > 30) {
      throw new DemoOptionsError(
        `playersPerCohort.${sport} must be an integer from ${String(MIN_DEMO_PLAYERS_PER_COHORT)} to 30.`,
      );
    }
  }
  return { asOf: options.asOf, slug, seed, historyDays, seasons, emailDomain, playersPerCohort };
}

// ─── Calendar ────────────────────────────────────────────────────────────────────────

/** Planning year of a day: the season runs February–November; December and January belong to the one that ended. */
export function demoSeasonYear(date: LocalDate): number {
  const { year, month } = localDateParts(date);
  return month >= 2 ? year : year - 1;
}

function seasonStart(year: number): LocalDate {
  return localDate(year, 2, 1);
}

function seasonEnd(year: number): LocalDate {
  return localDate(year, 11, 30);
}

function inSeason(date: LocalDate): boolean {
  const year = localDateParts(date).year;
  return (
    compareLocalDates(date, seasonStart(year)) >= 0 && compareLocalDates(date, seasonEnd(year)) <= 0
  );
}

function before(a: LocalDate, b: LocalDate): boolean {
  return compareLocalDates(a, b) < 0;
}

function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareLocalDates(a, b) >= 0 ? a : b;
}

function epochDay(date: LocalDate): number {
  return daysBetween(DEMO_EPOCH, date);
}

const dayStarts = new Map<string, number>();

/** An instant at a wall-clock time of a club day (minutes after midnight). */
function at(date: LocalDate, minutes: number, timeZone: TimeZone): Date {
  const key = `${timeZone} ${date}`;
  let start = dayStarts.get(key);
  if (start === undefined) {
    start = dayBoundsInTimeZone(date, timeZone).start.getTime();
    dayStarts.set(key, start);
  }
  return new Date(start + minutes * 60_000);
}

// ─── Branches, bands and the people of the club ─────────────────────────────────────

const BRANCHES = [
  { sport: 'rugby', sex: 'male' },
  { sport: 'hockey', sex: 'female' },
] as const satisfies readonly { sport: Sport; sex: Sex }[];

type Band = (typeof DEFAULT_AGE_BANDS)[number];

const BAND_INDEX = new Map<string, number>(DEFAULT_AGE_BANDS.map((b, i) => [b.code, i]));
const OLDEST_AGE = Math.max(...DEFAULT_AGE_BANDS.map((b) => b.maxAgeInSeasonYear));
const YOUNGEST_AGE = Math.min(...DEFAULT_AGE_BANDS.map((b) => b.minAgeInSeasonYear));

function bandIndex(band: Band): number {
  return BAND_INDEX.get(band.code) ?? 0;
}

function categoryKey(sport: Sport, sex: Sex, band: Band): DemoCategoryKey {
  return { sport, sex, ageBandCode: band.code };
}

/** Scenario of a cohort slot: 0 is the featured player, 1–5 show one scenario each. */
const SCENARIO_BY_SLOT: Readonly<Record<number, DemoScenario>> = {
  1: 'load_spike',
  2: 'wellness_slump',
  3: 'detraining',
  4: 'cmj_fatigue',
  5: 'injury_prone',
};

/** Positions by slot, a squad's worth (rugby 15, hockey 10). */
const POSITION_ROTATION: Readonly<Record<Sport, readonly string[]>> = {
  rugby: [
    'prop',
    'hooker',
    'prop',
    'lock',
    'lock',
    'flanker',
    'flanker',
    'number_eight',
    'scrum_half',
    'fly_half',
    'centre',
    'centre',
    'wing',
    'wing',
    'fullback',
  ],
  hockey: [
    'goalkeeper',
    'defender',
    'defender',
    'defender',
    'midfielder',
    'midfielder',
    'midfielder',
    'forward',
    'forward',
    'forward',
  ],
};

const LINE_OF_POSITION = new Map<string, string | null>(
  DEFAULT_POSITION_LINES.map((p) => [`${p.sport}:${p.positionCode}`, p.lineCode]),
);

/** Load of a player in a session relative to the plan (the load-spike scenario). */
type LoadPhase = 'normal' | 'light' | 'heavy';

/** Latent traits of a player, standard normal unless noted. */
interface Traits {
  readonly speed: number;
  readonly power: number;
  readonly aerobic: number;
  readonly strength: number;
  readonly mobility: number;
  readonly reaction: number;
  readonly asymmetryPct: number;
  /** Personal wellness level (1–5 scale) and day-to-day noise. */
  readonly wellnessBase: number;
  readonly wellnessNoise: number;
  readonly rpeBias: number;
  /** Growth curve: adult height (cm), age at peak height velocity, peak velocity (cm/year). */
  readonly adultHeightCm: number;
  readonly phvAge: number;
  readonly peakVelocityCmYear: number;
  readonly sittingRatio: number;
  readonly bmiOffset: number;
  readonly fatherHeightCm: number;
  readonly motherHeightCm: number;
}

interface PlayerPlan {
  readonly key: string;
  readonly id: string;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly birthYear: number;
  readonly birthDate: LocalDate;
  readonly slot: number | null;
  readonly joinedOn: LocalDate;
  /** Last day as a player of the club when the oldest band ends; `null` while still in it. */
  readonly graduationOn: LocalDate;
  readonly firstName: string;
  readonly lastName: string;
  readonly positions: readonly string[];
  readonly line: string | null;
  readonly scenario: DemoScenario;
  /** Phase of the player's scenario cycle, in days. */
  readonly phase: number;
  readonly traits: Traits;
  readonly featured: 'family_child' | 'rugby_player' | 'hockey_player' | null;
}

function playerPlan(
  ns: string,
  branch: (typeof BRANCHES)[number],
  birthYear: number,
  slot: number | null,
  arrivalOn: LocalDate | null,
): PlayerPlan {
  const { sport, sex } = branch;
  const key =
    arrivalOn === null
      ? `${sport}:${String(birthYear)}:${String(slot)}`
      : `${sport}:${String(birthYear)}:arrival:${arrivalOn}`;
  const r = randomFor(ns, 'player', key);
  const dayOfYear = r.int(0, 364);
  const birthDate = addDays(localDate(birthYear, 1, 1), dayOfYear);
  const joinedOn = arrivalOn ?? seasonStart(birthYear + YOUNGEST_AGE);
  const firstName = r.pick(sex === 'male' ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
  let lastName: string = r.pick(SURNAMES);
  const featuredChild =
    slot === 0 &&
    ((sport === 'rugby' && birthYear === DEMO_FEATURED.familyRugbyChildBirthYear) ||
      (sport === 'hockey' && birthYear === DEMO_FEATURED.familyHockeyChildBirthYear));
  // The featured siblings share the family name.
  if (featuredChild) lastName = randomFor(ns, 'family').pick(SURNAMES);
  const rotation = POSITION_ROTATION[sport];
  const main =
    slot === null ? r.pick(rotation) : (rotation[slot % rotation.length] ?? r.pick(rotation));
  const positions = [main];
  if (main === 'centre' && r.chance(0.5)) positions.push('wing');
  if (main === 'flanker' && r.chance(0.4)) positions.push('number_eight');
  if (main === 'midfielder' && r.chance(0.4)) positions.push('forward');
  const scenario = slot === null ? 'none' : (SCENARIO_BY_SLOT[slot] ?? 'none');
  // Twelve phases per scenario, one per cohort (birth year × sport), so on any day some
  // cohort is at each point of its cycle.
  const phase = (birthYear * 2 + (sport === 'rugby' ? 0 : 1)) % 12;
  const male = sex === 'male';
  const fatherHeightCm = round(r.normal(176, 6), 0);
  const motherHeightCm = round(r.normal(163, 5.5), 0);
  const midParent = (fatherHeightCm + motherHeightCm + (male ? 13 : -13)) / 2;
  const speed = r.normal(0, 1);
  const traits: Traits = {
    speed,
    power: 0.6 * speed + 0.8 * r.normal(0, 1),
    aerobic: r.normal(0, 1),
    strength: r.normal(0, 1),
    mobility: r.normal(0, 1),
    reaction: r.normal(0, 1),
    asymmetryPct: r.float(0, 4),
    wellnessBase:
      scenario === 'wellness_slump' ? r.float(4.2, 4.5) : clamp(r.normal(4.0, 0.25), 3.5, 4.6),
    wellnessNoise: scenario === 'wellness_slump' ? 0.18 : 0.32,
    rpeBias: r.normal(0, 0.6),
    adultHeightCm: midParent + r.normal(0, 3.5),
    phvAge: male ? r.normal(13.8, 0.8) : r.normal(11.9, 0.7),
    peakVelocityCmYear: male ? r.normal(9.3, 0.6) : r.normal(8.0, 0.5),
    sittingRatio: r.normal(0.52, 0.006),
    bmiOffset: r.normal(0, 1.2),
    fatherHeightCm,
    motherHeightCm,
  };
  const graduationOn = seasonEnd(birthYear + OLDEST_AGE);
  let featured: PlayerPlan['featured'] = null;
  if (featuredChild) featured = 'family_child';
  else if (slot === 0 && sport === 'rugby' && birthYear === DEMO_FEATURED.rugbyPlayerBirthYear)
    featured = 'rugby_player';
  else if (slot === 0 && sport === 'hockey' && birthYear === DEMO_FEATURED.hockeyPlayerBirthYear)
    featured = 'hockey_player';
  return {
    key,
    id: stableUuid(ns, 'player', key),
    sport,
    sex,
    birthYear,
    birthDate,
    slot,
    joinedOn,
    graduationOn,
    firstName,
    lastName,
    positions,
    line: LINE_OF_POSITION.get(`${sport}:${main}`) ?? null,
    scenario,
    phase,
    traits,
    featured,
  };
}

/**
 * Players who join during a season: one every three weeks for the whole club,
 * each to the next category in turn, so on any day of the season someone joined
 * less than 28 days ago (ACWR with insufficient history) and every category gets
 * one or two newcomers a year.
 */
function arrivalsOf(
  year: number,
): { branch: (typeof BRANCHES)[number]; band: Band; arrivalOn: LocalDate }[] {
  const out: { branch: (typeof BRANCHES)[number]; band: Band; arrivalOn: LocalDate }[] = [];
  const slots = BRANCHES.length * DEFAULT_AGE_BANDS.length;
  for (let k = 0; ; k++) {
    const arrivalOn = addDays(seasonStart(year), 10 + 21 * k);
    if (!before(arrivalOn, addDays(seasonEnd(year), -30))) break;
    const index = (k + year * 5) % slots;
    const branch = BRANCHES[index % BRANCHES.length];
    const band = DEFAULT_AGE_BANDS[Math.floor(index / BRANCHES.length)];
    if (branch !== undefined && band !== undefined) out.push({ branch, band, arrivalOn });
  }
  return out;
}

// ─── Physical models (plausible youth values, not norms) ─────────────────────────────

/** Linear in age between 12 and 19, flat outside. */
function byAge(age: number, at12: number, at19: number): number {
  const t = clamp((age - 12) / 7, 0, 1);
  return at12 + (at19 - at12) * t;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Logistic growth curve around the PHV: velocity peaks at `phvAge`. */
function heightCmAt(traits: Traits, age: number): number {
  const s = 1;
  const range = 4 * s * traits.peakVelocityCmYear;
  return traits.adultHeightCm - range + range * sigmoid((age - traits.phvAge) / s);
}

function weightKgAt(plan: PlayerPlan, age: number, heightCm: number): number {
  const male = plan.sex === 'male';
  const bmi =
    (male ? Math.min(17.5 + 1.0 * (age - 12), 23.8) : Math.min(17.6 + 0.75 * (age - 11), 21.8)) +
    (plan.line === 'forwards' && plan.sport === 'rugby' ? 2.6 : 0) +
    plan.traits.bmiOffset;
  return bmi * (heightCm / 100) ** 2;
}

// ─── The generator ──────────────────────────────────────────────────────────────────

interface Staff {
  readonly admin: string;
  readonly coach: Readonly<Record<Sport, { readonly senior: string; readonly junior: string }>>;
  readonly sc: Readonly<Record<Sport, string>>;
  readonly medical: Readonly<Record<Sport, string>>;
}

interface StaffSpec {
  readonly key: string;
  readonly local: string;
  readonly name: string;
  readonly role: 'admin' | 'coach' | 'sc' | 'medical';
  readonly sport: Sport | null;
  readonly bands: readonly string[] | null;
}

const SENIOR_BANDS = ['m17', 'm19'];
const JUNIOR_BANDS = ['m13', 'm14', 'm15', 'm16'];

const STAFF: readonly StaffSpec[] = [
  {
    key: 'admin',
    local: 'admin',
    name: 'Carolina Ibarra',
    role: 'admin',
    sport: null,
    bands: null,
  },
  {
    key: 'coach:rugby:senior',
    local: 'entrenador.rugby',
    name: 'Diego Ferrando',
    role: 'coach',
    sport: 'rugby',
    bands: SENIOR_BANDS,
  },
  {
    key: 'coach:rugby:junior',
    local: 'entrenador.rugby.infantiles',
    name: 'Pablo Quintana',
    role: 'coach',
    sport: 'rugby',
    bands: JUNIOR_BANDS,
  },
  {
    key: 'coach:hockey:senior',
    local: 'entrenadora.hockey',
    name: 'Mariana Echagüe',
    role: 'coach',
    sport: 'hockey',
    bands: SENIOR_BANDS,
  },
  {
    key: 'coach:hockey:junior',
    local: 'entrenadora.hockey.infantiles',
    name: 'Lucía Arrieta',
    role: 'coach',
    sport: 'hockey',
    bands: JUNIOR_BANDS,
  },
  {
    key: 'sc:rugby',
    local: 'pf.rugby',
    name: 'Federico Alcorta',
    role: 'sc',
    sport: 'rugby',
    bands: [...JUNIOR_BANDS, ...SENIOR_BANDS],
  },
  {
    key: 'sc:hockey',
    local: 'pf.hockey',
    name: 'Julieta Ponce',
    role: 'sc',
    sport: 'hockey',
    bands: [...JUNIOR_BANDS, ...SENIOR_BANDS],
  },
  {
    key: 'medical:rugby',
    local: 'medico.rugby',
    name: 'Andrés Lorenzo',
    role: 'medical',
    sport: 'rugby',
    bands: null,
  },
  {
    key: 'medical:hockey',
    local: 'medica.hockey',
    name: 'Valeria Molina',
    role: 'medical',
    sport: 'hockey',
    bands: null,
  },
];

/** Default weekly plan by stage: ISO weekday → start (minutes after midnight) and duration. */
const WEEKLY_PLAN: Readonly<
  Record<
    Stage,
    readonly { readonly weekday: number; readonly start: number; readonly minutes: number }[]
  >
> = {
  foundation: [
    { weekday: 2, start: 18 * 60, minutes: 75 },
    { weekday: 4, start: 18 * 60, minutes: 75 },
  ],
  development: [
    { weekday: 1, start: 18 * 60 + 30, minutes: 90 },
    { weekday: 3, start: 18 * 60 + 30, minutes: 90 },
    { weekday: 4, start: 18 * 60 + 30, minutes: 75 },
  ],
  performance: [
    { weekday: 1, start: 19 * 60 + 30, minutes: 90 },
    { weekday: 2, start: 19 * 60 + 30, minutes: 90 },
    { weekday: 4, start: 19 * 60 + 30, minutes: 100 },
  ],
};

const MATCH_MINUTES: Readonly<Record<Sport, Readonly<Record<string, number>>>> = {
  rugby: { m13: 50, m14: 50, m15: 60, m16: 60, m17: 70, m19: 80 },
  hockey: { m13: 50, m14: 50, m15: 60, m16: 60, m17: 60, m19: 60 },
};
const MATCH_SQUAD: Readonly<Record<Sport, { readonly squad: number; readonly starters: number }>> =
  {
    rugby: { squad: 23, starters: 15 },
    hockey: { squad: 16, starters: 11 },
  };

const TEST_METHOD: Readonly<Partial<Record<CanonicalTestCode, MeasurementMethod>>> = {
  sprint_40: 'app',
  cmj: 'video',
  cod_505: 'app',
  ift_3015: 'app',
  bronco: 'manual',
  strength: 'manual',
  mobility: 'manual',
  reaction: 'app',
};

/** Tests the demo records: the battery but the anthropometry (its own table) and the neck (Phase 2 hardware). */
const RECORDED_TESTS = new Set<CanonicalTestCode>(Object.keys(TEST_METHOD) as CanonicalTestCode[]);

const MARK = 'Dato ficticio de demostración.';

interface Context {
  readonly o: ResolvedOptions;
  readonly ns: string;
  readonly tz: TimeZone;
  readonly firstSeason: number;
  readonly lastSeason: number;
  readonly dailyFrom: LocalDate;
  readonly staff: Staff;
  readonly devices: { readonly phone: string; readonly tablet: string };
  readonly definitions: ReadonlyMap<string, TestDefinitionSeed>;
}

function id(ctx: Context, ...key: readonly (string | number)[]): string {
  return stableUuid(ctx.ns, ...key);
}

function clientUuid(ctx: Context, ...key: readonly (string | number)[]): string {
  return stableUuid(ctx.ns, 'client', ...key);
}

function ids(ctx: Context, ...key: readonly (string | number)[]) {
  return { id: id(ctx, ...key), clientUuid: clientUuid(ctx, ...key) };
}

/**
 * Generates the demo dataset of a club up to `asOf`. Deterministic: same
 * options, same dataset. Throws {@link DemoOptionsError} on invalid options.
 */
export function generateDemoDataset(options: DemoOptions): DemoDataset {
  const o = resolveDemoOptions(options);
  const ns = `demo:${o.slug}:${o.seed}`;
  const tz = DEFAULT_CLUB_TIME_ZONE;
  const lastSeason = demoSeasonYear(o.asOf);
  const firstSeason = lastSeason - o.seasons + 1;
  const dailyFrom = maxDate(addDays(o.asOf, 1 - o.historyDays), seasonStart(firstSeason));
  const userId = (key: string) => stableUuid(ns, 'user', key);
  const staff: Staff = {
    admin: userId('admin'),
    coach: {
      rugby: { senior: userId('coach:rugby:senior'), junior: userId('coach:rugby:junior') },
      hockey: { senior: userId('coach:hockey:senior'), junior: userId('coach:hockey:junior') },
    },
    sc: { rugby: userId('sc:rugby'), hockey: userId('sc:hockey') },
    medical: { rugby: userId('medical:rugby'), hockey: userId('medical:hockey') },
  };
  const ctx: Context = {
    o,
    ns,
    tz,
    firstSeason,
    lastSeason,
    dailyFrom,
    staff,
    devices: {
      phone: stableUuid(ns, 'device', 'phone'),
      tablet: stableUuid(ns, 'device', 'tablet'),
    },
    definitions: new Map(testDefinitionSeeds().map((t) => [t.code, t])),
  };

  const users: DemoUser[] = [];
  const memberships: DemoMembership[] = [];
  const email = (local: string) => `${o.slug}.${local}@${o.emailDomain}`;
  const startedAt = at(DEMO_EPOCH, 9 * 60, tz);
  const addMember = (key: string, local: string, name: string, role: DemoMembership['role']) => {
    const uid = userId(key);
    if (!users.some((u) => u.id === uid)) users.push({ id: uid, email: email(local), name });
    const m = { ...ids(ctx, 'membership', key, role), userId: uid, role, startedAt };
    memberships.push(m);
    return m;
  };

  // Staff and what each one sees (B-314).
  const staffAssignments: DemoStaffAssignment[] = [];
  for (const s of STAFF) {
    const m = addMember(s.key, s.local, s.name, s.role);
    if (s.role === 'medical' && s.sport !== null) {
      staffAssignments.push({
        ...ids(ctx, 'staff_assignment', s.key, s.sport),
        membershipId: m.id,
        category: null,
        sport: s.sport,
        validFrom: DEMO_EPOCH,
      });
    }
    if (s.bands !== null && s.sport !== null) {
      const branch = BRANCHES.find((b) => b.sport === s.sport);
      if (branch === undefined) continue;
      for (const band of s.bands) {
        staffAssignments.push({
          ...ids(ctx, 'staff_assignment', s.key, band),
          membershipId: m.id,
          category: { sport: branch.sport, sex: branch.sex, ageBandCode: band },
          sport: null,
          validFrom: DEMO_EPOCH,
        });
      }
    }
  }

  // Seasons and windows (B-317).
  const seasons: DemoSeason[] = [];
  const testWindows: DemoTestWindow[] = [];
  for (const branch of BRANCHES) {
    for (let year = firstSeason; year <= lastSeason; year++) {
      const season: DemoSeason = {
        ...ids(ctx, 'season', branch.sport, year),
        sport: branch.sport,
        year,
        name: String(year),
        startsOn: seasonStart(year),
        endsOn: seasonEnd(year),
      };
      seasons.push(season);
      for (const w of defaultTestWindows(year)) {
        testWindows.push({
          ...ids(ctx, 'test_window', branch.sport, year, w.number),
          seasonId: season.id,
          sport: branch.sport,
          number: w.number,
          startsOn: w.startsOn,
          endsOn: w.endsOn,
        });
      }
    }
  }
  const seasonOf = (sport: Sport, year: number) =>
    seasons.find((s) => s.sport === sport && s.year === year);

  // The roster: cohorts by birth year, plus players who join during a season (also
  // in seasons before the window: they are still in a band when it starts).
  const plans = new Map<string, PlayerPlan>();
  for (const branch of BRANCHES) {
    for (let year = firstSeason - OLDEST_AGE + YOUNGEST_AGE; year <= lastSeason; year++) {
      for (const band of DEFAULT_AGE_BANDS) {
        for (let age = band.minAgeInSeasonYear; age <= band.maxAgeInSeasonYear; age++) {
          if (year < firstSeason) break;
          const birthYear = year - age;
          for (let slot = 0; slot < o.playersPerCohort[branch.sport]; slot++) {
            const plan = playerPlan(ns, branch, birthYear, slot, null);
            plans.set(plan.key, plan);
          }
        }
      }
      for (const arrival of arrivalsOf(year)) {
        if (arrival.branch !== branch || before(o.asOf, arrival.arrivalOn)) continue;
        const plan = playerPlan(
          ns,
          branch,
          year - arrival.band.minAgeInSeasonYear,
          null,
          arrival.arrivalOn,
        );
        plans.set(plan.key, plan);
      }
    }
  }

  const bandIn = (plan: PlayerPlan, year: number): Band | undefined =>
    ageBandForBirthYear(plan.birthYear, year, DEFAULT_AGE_BANDS);
  const leftOn = (plan: PlayerPlan): LocalDate | null =>
    before(plan.graduationOn, o.asOf) ? plan.graduationOn : null;

  const players: DemoPlayer[] = [];
  const playerPositions: DemoPlayerPosition[] = [];
  const parentHeights: DemoParentHeight[] = [];
  const playerCategories: DemoPlayerCategory[] = [];
  const guardians: DemoGuardian[] = [];
  const consents: DemoConsent[] = [];
  /** Category spans of each player, for the daily data. */
  const spans = new Map<string, { band: Band; from: LocalDate; to: LocalDate | null }[]>();
  const familyUser = userId('family');
  let familyAdded = false;

  for (const plan of [...plans.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const seasonRows: { year: number; band: Band }[] = [];
    for (let year = firstSeason; year <= lastSeason; year++) {
      const band = bandIn(plan, year);
      if (band === undefined) continue;
      if (before(seasonEnd(year), plan.joinedOn)) continue;
      seasonRows.push({ year, band });
    }
    if (seasonRows.length === 0) continue;
    const left = leftOn(plan);
    const r = randomFor(ns, 'profile', plan.key);
    const currentBand = bandIn(plan, lastSeason);
    const ownAccount =
      plan.featured === 'rugby_player' ||
      plan.featured === 'hockey_player' ||
      (currentBand !== undefined && STAGE_PROFILES[currentBand.defaultStage].weeklyCmj);
    let accountId: string | null = null;
    if (ownAccount) {
      accountId = userId(`player:${plan.key}`);
      const local =
        plan.featured === 'rugby_player'
          ? 'jugador'
          : plan.featured === 'hockey_player'
            ? 'jugadora'
            : `${plan.sex === 'male' ? 'jugador' : 'jugadora'}.${shortTag(ns, plan.key)}`;
      addMember(`player:${plan.key}`, local, `${plan.firstName} ${plan.lastName}`, 'player');
    }
    players.push({
      id: plan.id,
      clientUuid: clientUuid(ctx, 'player', plan.key),
      key: plan.key,
      firstName: plan.firstName,
      lastName: plan.lastName,
      birthDate: plan.birthDate,
      sex: plan.sex,
      sport: plan.sport,
      dominantSide: r.chance(0.8) ? 'right' : r.chance(0.75) ? 'left' : 'both',
      joinedOn: plan.joinedOn,
      userId: accountId,
      leftOn: left,
      leftReason: left === null ? null : 'graduated',
      archivedAt: left === null ? null : at(addDays(left, 1), 9 * 60, tz),
      scenario: plan.scenario,
    });
    plan.positions.forEach((code, sortOrder) => {
      playerPositions.push({
        ...ids(ctx, 'player_position', plan.key, code),
        playerId: plan.id,
        sport: plan.sport,
        positionCode: code,
        sortOrder,
      });
    });
    for (const parent of ['father', 'mother'] as const) {
      parentHeights.push({
        ...ids(ctx, 'parent_height', plan.key, parent),
        playerId: plan.id,
        parent,
        heightCm: parent === 'father' ? plan.traits.fatherHeightCm : plan.traits.motherHeightCm,
        source: r.chance(0.3) ? 'measured' : 'reported',
      });
    }
    const playerSpans: { band: Band; from: LocalDate; to: LocalDate | null }[] = [];
    for (const { year, band } of seasonRows) {
      const season = seasonOf(plan.sport, year);
      if (season === undefined) continue;
      const nextBand = year < lastSeason ? bandIn(plan, year + 1) : undefined;
      const validFrom = maxDate(seasonStart(year), plan.joinedOn);
      const validTo =
        nextBand !== undefined
          ? seasonStart(year + 1)
          : left !== null && year === demoSeasonYear(left)
            ? addDays(left, 1)
            : null;
      playerCategories.push({
        ...ids(ctx, 'player_category', plan.key, year),
        playerId: plan.id,
        category: categoryKey(plan.sport, plan.sex, band),
        seasonId: season.id,
        validFrom,
        validTo,
      });
      playerSpans.push({ band, from: validFrom, to: validTo });
    }
    spans.set(plan.id, playerSpans);

    // A guardian signs the minor's consents (B-310, B-312); the featured siblings share one.
    const relationship = r.chance(0.55) ? 'mother' : 'father';
    let guardianUser: string;
    if (plan.featured === 'family_child') {
      guardianUser = familyUser;
      if (!familyAdded) {
        familyAdded = true;
        addMember('family', 'familia', `Silvina ${plan.lastName}`, 'parent');
      }
    } else {
      guardianUser = userId(`guardian:${plan.key}`);
      const first = randomFor(ns, 'guardian', plan.key).pick(
        relationship === 'mother' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES,
      );
      addMember(
        `guardian:${plan.key}`,
        `tutor.${shortTag(ns, 'guardian', plan.key)}`,
        `${first} ${plan.lastName}`,
        'parent',
      );
    }
    guardians.push({
      ...ids(ctx, 'guardian', plan.key, guardianUser),
      playerId: plan.id,
      userId: guardianUser,
      relationship: plan.featured === 'family_child' ? 'mother' : relationship,
      validFrom: plan.joinedOn,
    });
    const signedAt = at(plan.joinedOn, 20 * 60 + r.int(0, 120), tz);
    const types = r.chance(0.85)
      ? (['data', 'health', 'image'] as const)
      : (['data', 'health'] as const);
    for (const type of types) {
      consents.push({
        ...ids(ctx, 'consent', plan.key, type, 'guardian'),
        playerId: plan.id,
        type,
        signerKind: 'guardian',
        signedBy: guardianUser,
        signedAt,
      });
    }
    // Of age (B-311): the player signs their own a week after turning 18.
    const { year, month, day } = localDateParts(plan.birthDate);
    const eighteen =
      month === 2 && day === 29 ? localDate(year + 18, 3, 1) : localDate(year + 18, month, day);
    const ownSignature = addDays(eighteen, 7);
    if (
      accountId !== null &&
      !before(o.asOf, ownSignature) &&
      (left === null || before(ownSignature, left))
    ) {
      for (const type of types) {
        consents.push({
          ...ids(ctx, 'consent', plan.key, type, 'player'),
          playerId: plan.id,
          type,
          signerKind: 'player',
          signedBy: accountId,
          signedAt: at(ownSignature, 21 * 60, tz),
        });
      }
    }
  }

  // Players of earlier seasons the demo may have written on earlier runs: when they
  // finish their last band, the leave is recorded even if they are out of the window.
  const departures: DemoDeparture[] = [];
  const emitted = new Set(players.map((p) => p.id));
  for (const branch of BRANCHES) {
    // Back far enough to reach whoever joined at the youngest band and finished the
    // oldest one up to six seasons before the window (a demo left without runs that long).
    for (let year = firstSeason - 2 * (OLDEST_AGE - YOUNGEST_AGE) - 1; year < firstSeason; year++) {
      for (const band of DEFAULT_AGE_BANDS) {
        const keys: PlayerPlan[] = [];
        for (let age = band.minAgeInSeasonYear; age <= band.maxAgeInSeasonYear; age++) {
          for (let slot = 0; slot < o.playersPerCohort[branch.sport]; slot++) {
            keys.push(playerPlan(ns, branch, year - age, slot, null));
          }
        }
        for (const arrival of arrivalsOf(year)) {
          if (arrival.branch !== branch || arrival.band.code !== band.code) continue;
          keys.push(
            playerPlan(ns, branch, year - band.minAgeInSeasonYear, null, arrival.arrivalOn),
          );
        }
        for (const plan of keys) {
          if (emitted.has(plan.id) || !before(plan.graduationOn, o.asOf)) continue;
          if (departures.some((d) => d.playerId === plan.id)) continue;
          departures.push({
            playerId: plan.id,
            leftOn: plan.graduationOn,
            archivedAt: at(addDays(plan.graduationOn, 1), 9 * 60, tz),
          });
        }
      }
    }
  }

  const planOf = new Map([...plans.values()].map((p) => [p.id, p]));
  const rosterOn = (sport: Sport, band: Band, date: LocalDate): PlayerPlan[] => {
    const out: PlayerPlan[] = [];
    for (const player of players) {
      if (player.sport !== sport) continue;
      if (player.leftOn !== null && before(player.leftOn, date)) continue;
      if (before(date, player.joinedOn)) continue;
      const covering = spans
        .get(player.id)
        ?.some(
          (s) =>
            s.band.code === band.code &&
            !before(date, s.from) &&
            (s.to === null || before(date, s.to)),
        );
      const plan = planOf.get(player.id);
      if (covering === true && plan !== undefined) out.push(plan);
    }
    return out;
  };

  // Injuries of the injury-prone players (medical schema, ADR 0008): a cycle of 112
  // days with a phase per cohort, so someone is always out or limited.
  const injuries: DemoInjury[] = [];
  const holds: DemoHold[] = [];
  const holdsOf = new Map<string, DemoHold[]>();
  for (const player of players) {
    const plan = planOf.get(player.id);
    if (plan?.scenario !== 'injury_prone') continue;
    const firstEpisode = Math.floor(epochDay(seasonStart(firstSeason)) / 112) - 1;
    for (let e = Math.max(0, firstEpisode); ; e++) {
      const onsetOn = addDays(DEMO_EPOCH, e * 112 + plan.phase * 9);
      if (before(o.asOf, onsetOn)) break;
      if (before(onsetOn, maxDate(player.joinedOn, seasonStart(firstSeason)))) continue;
      if (!inSeason(onsetOn) || (player.leftOn !== null && before(player.leftOn, onsetOn)))
        continue;
      const r = randomFor(ns, 'injury', plan.key, e);
      const durationDays = r.int(14, 35);
      const expectedReturnOn = addDays(onsetOn, durationDays);
      const limited = e % 2 === 1;
      const region = r.pick(['ankle', 'knee', 'thigh_posterior', 'shoulder', 'lower_leg'] as const);
      const injury: DemoInjury = {
        ...ids(ctx, 'injury', plan.key, e),
        playerId: player.id,
        onsetOn,
        context: r.chance(0.5) ? 'match' : 'training',
        bodyRegion: region,
        side:
          region === 'shoulder' || region === 'knee' || region === 'ankle'
            ? r.pick(['left', 'right'] as const)
            : 'right',
        onset: r.chance(0.8) ? 'acute' : 'gradual',
        mechanism: r.pick(['contact', 'non_contact'] as const),
        diagnosis: `Lesión ficticia (${region}). ${MARK}`,
        expectedReturnOn,
        returnedOn: before(o.asOf, expectedReturnOn) ? null : expectedReturnOn,
      };
      injuries.push(injury);
      const hold: DemoHold = {
        ...ids(ctx, 'hold', plan.key, e),
        playerId: player.id,
        injuryId: injury.id,
        training: limited ? 'limited' : 'unavailable',
        match: 'unavailable',
        validFrom: onsetOn,
        validTo: expectedReturnOn,
        staffNote: limited ? 'Sin contacto' : 'Sin entrenamiento ni partido',
      };
      holds.push(hold);
      holdsOf.set(player.id, [...(holdsOf.get(player.id) ?? []), hold]);
    }
  }
  const availability = (playerId: string, date: LocalDate): AvailabilityStatus => {
    const hold = holdsOf
      .get(playerId)
      ?.find((h) => !before(date, h.validFrom) && before(date, h.validTo));
    return hold?.training ?? 'available';
  };

  // Scenario windows, anchored to the calendar (see `random.ts`).
  const cycleDay = (plan: PlayerPlan, date: LocalDate, cycle: number) =>
    (((epochDay(date) - Math.round((plan.phase * cycle) / 12)) % cycle) + cycle) % cycle;
  /**
   * Load spike, every six weeks: two light weeks (back from a break) and then a
   * heavy one (double sessions), the classic way to an ACWR above 1.4.
   */
  const loadPhase = (plan: PlayerPlan, date: LocalDate): LoadPhase => {
    if (plan.scenario !== 'load_spike') return 'normal';
    const d = cycleDay(plan, date, 42);
    if (d >= 21 && d < 35) return 'light';
    if (d >= 35) return 'heavy';
    return 'normal';
  };
  const absentBlock = (plan: PlayerPlan, date: LocalDate) =>
    plan.scenario === 'detraining' && cycleDay(plan, date, 42) >= 30;
  const wellnessDip = (plan: PlayerPlan, date: LocalDate): number => {
    if (plan.scenario !== 'wellness_slump') return 0;
    const d = cycleDay(plan, date, 28);
    if (d < 22) return 0;
    // Half of the cohorts dip below the absolute threshold, the others only against their own mean.
    return plan.phase % 2 === 0 ? 1.6 : 0.75;
  };
  /**
   * CMJ fatigue: two weeks of jumps well below the player's own baseline every
   * six weeks. Only the performance stage jumps weekly: its six cohorts (three
   * birth years, two sports) start one week apart, aligned to ISO weeks.
   */
  const cmjFactor = (plan: PlayerPlan, date: LocalDate) => {
    if (plan.scenario !== 'cmj_fatigue') return 1;
    const offset = ((plan.birthYear * 2 + (plan.sport === 'rugby' ? 0 : 1)) % 6) * 7;
    const d = (((epochDay(date) - offset) % 42) + 42) % 42;
    return d >= 28 ? 0.86 : 1;
  };

  // Fixture (B-317) for every generated season.
  const fixtures: DemoFixture[] = [];
  const fixtureOn = new Map<string, DemoFixture>();
  for (const branch of BRANCHES) {
    for (let year = firstSeason; year <= lastSeason; year++) {
      for (const band of DEFAULT_AGE_BANDS) {
        let week = 0;
        for (const date of localDateRange(localDate(year, 3, 1), localDate(year, 10, 31))) {
          if (isoWeekday(date) !== 6) continue;
          week += 1;
          if ((week + bandIndex(band)) % 6 === 0) continue; // bye
          const r = randomFor(ns, 'fixture', branch.sport, band.code, date);
          const home = week % 2 === 0;
          const kickoff = (branch.sport === 'rugby' ? 10 * 60 : 9 * 60) + bandIndex(band) * 75;
          const fixture: DemoFixture = {
            ...ids(ctx, 'fixture', branch.sport, band.code, date),
            category: categoryKey(branch.sport, branch.sex, band),
            opponent:
              OPPONENTS[(week + bandIndex(band) * 3) % OPPONENTS.length] ?? r.pick(OPPONENTS),
            venue: home ? 'home' : 'away',
            competition: COMPETITION_BY_SPORT[branch.sport],
            matchDate: date,
            kickoffTime: `${String(Math.floor(kickoff / 60)).padStart(2, '0')}:${String(kickoff % 60).padStart(2, '0')}:00`,
            location: home ? HOME_VENUE : 'Cancha del rival',
          };
          fixtures.push(fixture);
          fixtureOn.set(`${branch.sport}:${band.code}:${date}`, fixture);
        }
      }
    }
  }

  // Sessions, participation and RPE (B-318), wellness (B-319).
  const trainingSessions: DemoTrainingSession[] = [];
  const participations: DemoParticipation[] = [];
  const externalMetrics: DemoExternalMetric[] = [];
  const wellness: DemoWellness[] = [];
  const matchDays = new Set<string>();
  for (const date of localDateRange(dailyFrom, o.asOf)) {
    if (!inSeason(date)) continue;
    const weekday = isoWeekday(date);
    for (const branch of BRANCHES) {
      for (const band of DEFAULT_AGE_BANDS) {
        const stage = band.defaultStage;
        const category = categoryKey(branch.sport, branch.sex, band);
        const roster = rosterOn(branch.sport, band, date);
        if (roster.length === 0) continue;
        const fixture = fixtureOn.get(`${branch.sport}:${band.code}:${date}`);
        const plan = WEEKLY_PLAN[stage].find((p) => p.weekday === weekday);
        // Saturdays without a match (pre-season, bye weeks, November) are training days.
        const saturdayTraining = weekday === 6 && fixture === undefined;
        const slots: { kind: 'training' | 'match'; start: number; minutes: number }[] = [];
        if (plan !== undefined)
          slots.push({ kind: 'training', start: plan.start, minutes: plan.minutes });
        if (fixture !== undefined) {
          const [h, m] = fixture.kickoffTime.split(':').map(Number);
          slots.push({
            kind: 'match',
            start: (h ?? 10) * 60 + (m ?? 0),
            minutes: MATCH_MINUTES[branch.sport][band.code] ?? 60,
          });
        } else if (saturdayTraining) {
          slots.push({
            kind: 'training',
            start: 9 * 60 + 30,
            minutes: stage === 'foundation' ? 75 : 90,
          });
        }
        for (const slot of slots) {
          const session: DemoTrainingSession = {
            ...ids(ctx, 'training_session', branch.sport, band.code, date, slot.kind),
            sport: branch.sport,
            kind: slot.kind,
            category,
            title:
              slot.kind === 'match'
                ? `${band.label} vs. ${fixture?.opponent ?? ''}`.trim()
                : saturdayTraining && localDateParts(date).month === 2
                  ? 'Pretemporada'
                  : 'Entrenamiento',
            startsAt: at(date, slot.start, tz),
            localDate: date,
            plannedDurationMin: slot.minutes,
            location: slot.kind === 'match' ? (fixture?.location ?? HOME_VENUE) : TRAINING_VENUE,
            opponent: slot.kind === 'match' ? (fixture?.opponent ?? null) : null,
          };
          trainingSessions.push(session);
          if (slot.kind === 'match') matchDays.add(`${branch.sport}:${band.code}:${date}`);
          // RPE is reported after the session: today's sessions have none yet.
          if (!before(date, o.asOf)) continue;
          const rows = sessionParticipation(ctx, session, slot, roster, stage, {
            availability,
            loadPhase,
            absentBlock,
          });
          participations.push(...rows);
          if (SENIOR_BANDS.includes(band.code)) {
            externalMetrics.push(...sessionFieldMetrics(ctx, session, rows, roster));
          }
        }
        // Wellness before training (and on rest days, less often).
        const { itemCount, items } = wellnessItemSetForStage(stage);
        const isSessionDay = slots.length > 0;
        const dayAfterMatch = matchDays.has(`${branch.sport}:${band.code}:${addDays(date, -1)}`);
        for (const p of roster) {
          const r = randomFor(ns, 'wellness', p.key, date);
          // The slump players answer every day: their dip must be on the panel.
          const answers = p.scenario === 'wellness_slump' || r.chance(isSessionDay ? 0.9 : 0.55);
          if (!answers) continue;
          const shock = r.normal(0, p.traits.wellnessNoise * 0.6);
          const dip = wellnessDip(p, date);
          const injured = availability(p.id, date) !== 'available';
          const score = (item: string) => {
            let v = p.traits.wellnessBase + shock + r.normal(0, p.traits.wellnessNoise) - dip;
            if (dayAfterMatch && (item === 'fatigue' || item === 'soreness')) v -= 0.8;
            if (injured && (item === 'soreness' || item === 'mood')) v -= 0.8;
            return clamp(Math.round(v), 1, 5);
          };
          const values = Object.fromEntries(items.map((item) => [item, score(item)]));
          wellness.push({
            ...ids(ctx, 'wellness', p.key, date),
            playerId: p.id,
            localDate: date,
            itemCount,
            sleep: values.sleep ?? 3,
            fatigue: values.fatigue ?? 3,
            soreness: values.soreness ?? 3,
            stress: values.stress ?? null,
            mood: values.mood ?? null,
            submittedAt: at(date, 7 * 60 + r.int(0, 100), tz),
          });
        }
      }
    }
  }

  // Anthropometry at the cadence of each stage (B-203), measured by the S&C coach.
  const anthropometry: DemoAnthro[] = [];
  for (const player of players) {
    const plan = planOf.get(player.id);
    if (plan === undefined) continue;
    const dates = new Set<LocalDate>();
    for (const span of spans.get(player.id) ?? []) {
      const year = demoSeasonYear(span.from);
      const weeks = STAGE_PROFILES[span.band.defaultStage].anthropometryEveryWeeks.max;
      for (let k = 0; ; k++) {
        const date = addDays(seasonStart(year), 9 + k * weeks * 7);
        if (before(seasonEnd(year), date) || before(o.asOf, date)) break;
        if (before(date, span.from) || (span.to !== null && !before(date, span.to))) continue;
        dates.add(date);
      }
      // Intake measurement of a player who joins during the season.
      const intake = addDays(player.joinedOn, 3);
      if (span.from === player.joinedOn && !before(o.asOf, intake) && inSeason(intake))
        dates.add(intake);
    }
    for (const date of [...dates].sort()) {
      const r = randomFor(ns, 'anthro', plan.key, date);
      const age = decimalAgeYears(plan.birthDate, date);
      const height = heightCmAt(plan.traits, age) + r.normal(0, 0.15);
      const stage = bandIn(plan, demoSeasonYear(date))?.defaultStage ?? 'performance';
      anthropometry.push({
        ...ids(ctx, 'anthro', plan.key, date),
        playerId: player.id,
        measuredOn: date,
        heightCm: round(height, 1),
        sittingHeightCm: round(height * plan.traits.sittingRatio + r.normal(0, 0.2), 1),
        weightKg: round(weightKgAt(plan, age, height) + r.normal(0, 0.4), 1),
        skinfoldsSumMm:
          stage === 'performance'
            ? round(clamp(r.normal(plan.sex === 'male' ? 62 : 88, 12), 35, 140), 1)
            : null,
        evaluatorId: staff.sc[plan.sport],
      });
    }
  }
  const anthroOf = new Map<string, DemoAnthro[]>();
  for (const a of anthropometry) anthroOf.set(a.playerId, [...(anthroOf.get(a.playerId) ?? []), a]);
  /** Body mass measured last on or before the day (relative strength, as the API does). */
  const bodyMassOn = (playerId: string, date: LocalDate): number | null => {
    let mass: number | null = null;
    for (const a of anthroOf.get(playerId) ?? []) {
      if (!before(date, a.measuredOn)) mass = a.weightKg;
    }
    return mass;
  };

  // Test days (B-320): the battery of each stage in its windows, and the weekly CMJ.
  const testSessions: DemoTestSession[] = [];
  const testResults: DemoTestResult[] = [];
  const testValues: DemoTestValue[] = [];
  for (const branch of BRANCHES) {
    const battery = batterySeeds(branch.sport, branch.sex);
    for (const window of testWindows.filter((w) => w.sport === branch.sport)) {
      for (const band of DEFAULT_AGE_BANDS) {
        const stage = band.defaultStage;
        const tests = battery
          .filter((b) => b.stage === stage && b.windows.includes(window.number))
          .map((b) => b.testCode)
          .filter((code) => RECORDED_TESTS.has(code));
        if (tests.length === 0) continue;
        const scheduledOn = addDays(window.startsOn, 8 + bandIndex(band));
        const done = before(scheduledOn, o.asOf);
        if (!done && demoSeasonYear(scheduledOn) !== lastSeason) continue;
        const session = testDay(ctx, {
          key: ['test_session', branch.sport, band.code, window.startsOn],
          sport: branch.sport,
          testWindowId: window.id,
          category: categoryKey(branch.sport, branch.sex, band),
          scheduledOn,
          done,
          notes: `Ventana V${String(window.number)}. ${MARK}`,
        });
        testSessions.push(session);
        if (!done) continue;
        for (const plan of rosterOn(branch.sport, band, scheduledOn)) {
          for (const testCode of tests) {
            recordResults(ctx, session, plan, testCode, stage, {
              testResults,
              testValues,
              availability: availability(plan.id, scheduledOn),
              bodyMassKg: bodyMassOn(plan.id, scheduledOn),
              cmjFactor: cmjFactor(plan, scheduledOn),
            });
          }
        }
      }
    }
    // Weekly CMJ of the performance stage, on Mondays before training.
    for (const date of localDateRange(dailyFrom, o.asOf)) {
      if (isoWeekday(date) !== 1 || !inSeason(date) || !before(date, o.asOf)) continue;
      for (const band of DEFAULT_AGE_BANDS) {
        if (!STAGE_PROFILES[band.defaultStage].weeklyCmj) continue;
        const roster = rosterOn(branch.sport, band, date);
        if (roster.length === 0) continue;
        const session = testDay(ctx, {
          key: ['test_session', branch.sport, band.code, 'weekly_cmj', date],
          sport: branch.sport,
          testWindowId: null,
          category: categoryKey(branch.sport, branch.sex, band),
          scheduledOn: date,
          done: true,
          notes: `CMJ semanal. ${MARK}`,
          startMinutes: 18 * 60 + 45,
        });
        testSessions.push(session);
        for (const plan of roster) {
          recordResults(ctx, session, plan, 'cmj', band.defaultStage, {
            testResults,
            testValues,
            availability: availability(plan.id, date),
            bodyMassKg: null,
            cmjFactor: cmjFactor(plan, date),
          });
        }
      }
    }
  }

  // First-team references (B-321): invented values, labelled as such.
  const referenceValues: DemoReferenceValue[] = [];
  const reference = (
    sport: Sport,
    sex: Sex,
    lineCode: string | null,
    metricCode: string,
    value: number,
  ) =>
    referenceValues.push({
      ...ids(ctx, 'reference_value', sport, lineCode ?? 'squad', metricCode),
      metricCode,
      sport,
      sex,
      lineCode,
      value,
      method: 'photocell',
      validFrom: localDate(2024, 2, 1),
      source: 'Primera del club demo (valores ficticios)',
    });
  for (const [line, values] of [
    [
      'forwards',
      {
        sprint_10_s: 1.84,
        sprint_40_s: 5.42,
        sprint_vmax_ms: 8.6,
        cmj_height_cm: 44,
        vift_kmh: 20,
        cod505_left_s: 2.45,
        cod505_right_s: 2.44,
        bronco_time_s: 302,
      },
    ],
    [
      'backs',
      {
        sprint_10_s: 1.74,
        sprint_40_s: 5.08,
        sprint_vmax_ms: 9.3,
        cmj_height_cm: 48,
        vift_kmh: 21,
        cod505_left_s: 2.32,
        cod505_right_s: 2.31,
        bronco_time_s: 287,
      },
    ],
  ] as const) {
    for (const [metric, value] of Object.entries(values))
      reference('rugby', 'male', line, metric, value);
  }
  for (const [metric, value] of Object.entries({
    sprint_10_s: 1.98,
    sprint_40_s: 6.02,
    sprint_vmax_ms: 7.6,
    cmj_height_cm: 34,
    vift_kmh: 18.5,
    cod505_left_s: 2.52,
    cod505_right_s: 2.5,
  })) {
    reference('hockey', 'female', null, metric, value);
  }

  return {
    club: {
      slug: o.slug,
      name:
        o.slug === DEFAULT_DEMO_SLUG
          ? 'Club Atlético Demo'
          : `Club Atlético Demo (${o.slug.slice(5)})`,
      shortName: 'DEMO',
      timeZone: tz,
      primaryColor: '#1f8a70',
      secondaryColor: '#0b1f33',
      seed: o.seed,
    },
    asOf: o.asOf,
    branches: BRANCHES,
    users,
    memberships,
    staffAssignments,
    devices: [
      {
        id: ctx.devices.phone,
        clientUuid: clientUuid(ctx, 'device', 'phone'),
        kind: 'phone',
        label: 'Celular de llegada (demo)',
        model: 'Celular genérico',
        serialNumber: `${o.slug.toUpperCase()}-PHONE-01`,
      },
      {
        id: ctx.devices.tablet,
        clientUuid: clientUuid(ctx, 'device', 'tablet'),
        kind: 'tablet',
        label: 'Tablet de reacción (demo)',
        model: 'Tablet genérica 10"',
        serialNumber: `${o.slug.toUpperCase()}-TABLET-01`,
      },
    ],
    seasons,
    testWindows,
    players,
    departures,
    playerPositions,
    parentHeights,
    playerCategories,
    guardians,
    consents,
    fixtures,
    trainingSessions,
    participations,
    externalMetrics,
    wellness,
    testSessions,
    testResults,
    testValues,
    anthropometry,
    referenceValues,
    injuries,
    holds,
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────────────

function sessionParticipation(
  ctx: Context,
  session: DemoTrainingSession,
  slot: { kind: 'training' | 'match'; minutes: number },
  roster: readonly PlayerPlan[],
  stage: Stage,
  rules: {
    availability: (playerId: string, date: LocalDate) => AvailabilityStatus;
    loadPhase: (plan: PlayerPlan, date: LocalDate) => LoadPhase;
    absentBlock: (plan: PlayerPlan, date: LocalDate) => boolean;
  },
): DemoParticipation[] {
  const date = session.localDate;
  const out: DemoParticipation[] = [];
  // Contacts only in the sports that record them (B-803): never in hockey.
  const contactSport = sportRecordsContacts(session.sport);
  const baseRpe =
    slot.kind === 'match' ? 7.6 : { foundation: 4.6, development: 5.2, performance: 5.8 }[stage];
  const contactDay = contactSport && isoWeekday(date) === 2;
  const row = (
    plan: PlayerPlan,
    status: DemoParticipation['status'],
    minutes: number | null,
    r: Random,
    periodMinutes: readonly number[] | null = null,
  ): DemoParticipation => {
    const loaded = status === 'full' || status === 'partial';
    const phase = rules.loadPhase(plan, date);
    const limited = rules.availability(plan.id, date) === 'limited';
    const reported = loaded && r.chance(0.97);
    const rpeDelta = phase === 'heavy' ? 3.5 : phase === 'light' ? -3 : 0;
    const rpe = reported
      ? clamp(
          Math.round((limited ? 3 : baseRpe) + plan.traits.rpeBias + r.normal(0, 0.6) + rpeDelta),
          1,
          10,
        )
      : null;
    const minutesFactor = phase === 'heavy' ? 1.6 : phase === 'light' ? 0.5 : 1;
    const mins =
      periodMinutes !== null
        ? periodMinutesTotal(periodMinutes)
        : minutes === null
          ? null
          : Math.max(1, Math.min(600, Math.round(minutes * minutesFactor)));
    const contacts =
      !contactSport || !loaded || limited
        ? null
        : slot.kind === 'match'
          ? r.int(plan.line === 'forwards' ? 10 : 5, plan.line === 'forwards' ? 24 : 14)
          : contactDay
            ? r.int(4, 14)
            : 0;
    return {
      ...ids(ctx, 'participation', session.id, plan.key),
      trainingSessionId: session.id,
      playerId: plan.id,
      status,
      minutes: loaded ? mins : null,
      periodMinutes: loaded ? periodMinutes : null,
      contactsN: contacts,
      rpe,
      rpeReportedAt:
        rpe === null
          ? null
          : new Date(session.startsAt.getTime() + (slot.minutes + r.int(15, 40)) * 60_000),
      localDate: date,
    };
  };
  if (slot.kind === 'training') {
    for (const plan of roster) {
      const r = randomFor(ctx.ns, 'participation', session.id, plan.key);
      const available = rules.availability(plan.id, date);
      if (available === 'unavailable') {
        out.push(row(plan, 'unavailable', null, r));
      } else if (rules.absentBlock(plan, date) || r.chance(0.03)) {
        out.push(row(plan, 'absent', null, r));
      } else if (available === 'limited' || r.chance(0.06)) {
        out.push(row(plan, 'partial', Math.round(slot.minutes * 0.5), r));
      } else {
        out.push(row(plan, 'full', slot.minutes - r.int(0, 5), r));
      }
    }
    return out;
  }
  // A match: the squad among the available players, starters play the whole match.
  const r = randomFor(ctx.ns, 'squad', session.id);
  const eligible = roster.filter(
    (p) =>
      rules.availability(p.id, date) === 'available' &&
      !rules.absentBlock(p, date) &&
      !randomFor(ctx.ns, 'match_absent', session.id, p.key).chance(0.05),
  );
  const { squad, starters } = MATCH_SQUAD[session.sport];
  const selected = r.shuffle(eligible).slice(0, squad);
  if (recordsPeriodMinutes(session)) {
    // Rolling substitutions (hockey, B-803): minutes by quarter. The first one picked is the
    // goalkeeper and plays every minute; the others rotate, the starters for longer.
    const lengths = splitEvenly(slot.minutes, SPORT_FIELD_RULES[session.sport].matchPeriodCount);
    selected.forEach((plan, index) => {
      const pr = randomFor(ctx.ns, 'participation', session.id, plan.key);
      const share = index === 0 ? 1 : index < starters ? pr.float(0.62, 0.85) : pr.float(0.3, 0.55);
      const periods = lengths.map((length) =>
        index === 0 ? length : clamp(Math.round(length * (share + pr.normal(0, 0.1))), 0, length),
      );
      const total = periodMinutesTotal(periods);
      out.push(row(plan, total === slot.minutes ? 'full' : 'partial', total, pr, periods));
    });
    return out;
  }
  selected.forEach((plan, index) => {
    const pr = randomFor(ctx.ns, 'participation', session.id, plan.key);
    if (index < starters) out.push(row(plan, 'full', slot.minutes, pr));
    else out.push(row(plan, 'partial', pr.int(10, Math.round(slot.minutes / 2)), pr));
  });
  return out;
}

/** Whole minutes split across the periods, the remainder to the first ones. */
function splitEvenly(minutes: number, periods: number): number[] {
  const base = Math.floor(minutes / periods);
  return Array.from(
    { length: periods },
    (_, index) => base + (index < minutes - base * periods ? 1 : 0),
  );
}

/**
 * Catapult totals of a session for the players who took part (B-408): the
 * metrics of the canonical dictionary an OpenField export brings, with the
 * shape of a junior rugby session (backs run more and faster, forwards have
 * more contacts; matches are more intense) or of a junior hockey one (B-803:
 * more metres per minute on the field, rolling substitutions, no contacts).
 * The relative ones use the player's own Vmax, as Catapult does with its
 * "% Max Velocity".
 */
function sessionFieldMetrics(
  ctx: Context,
  session: DemoTrainingSession,
  rows: readonly DemoParticipation[],
  roster: readonly PlayerPlan[],
): DemoExternalMetric[] {
  const plans = new Map(roster.map((plan) => [plan.id, plan]));
  const match = session.kind === 'match';
  const out: DemoExternalMetric[] = [];
  for (const row of rows) {
    const plan = plans.get(row.playerId);
    if (plan === undefined || row.minutes === null || row.minutes === 0) continue;
    const r = randomFor(ctx.ns, 'field_metric', session.id, plan.key);
    const hockey = session.sport === 'hockey';
    const forward = plan.line === 'forwards';
    const age = decimalAgeYears(plan.birthDate, session.localDate);
    const ownVmaxMs = hockey
      ? byAge(age, 6.2, 7.6) + 0.25 * plan.traits.speed
      : byAge(age, 6.6, 8.6) + (forward ? -0.4 : 0.2) + 0.25 * plan.traits.speed;
    const metresPerMin = hockey
      ? (match ? 112 : 72) + r.normal(0, 7)
      : (match ? 72 : 58) + (forward ? -6 : 4) + r.normal(0, 5);
    const distM = Math.max(200, metresPerMin * row.minutes);
    const vmaxMs = ownVmaxMs * r.float(0.82, 0.97);
    const hsrShare =
      (match ? 0.08 : 0.05) * (hockey ? 1 : forward ? 0.6 : 1.2) * (1 + r.normal(0, 0.2));
    const values: Record<string, number> = {
      dist_m: Math.round(distM),
      dist_m_min: round(distM / row.minutes, 1),
      hsr_abs_m: Math.max(0, Math.round(distM * hsrShare)),
      hsr_rel_m: Math.max(0, Math.round(distM * hsrShare * 1.7)),
      vmax_ms: round(vmaxMs, 2),
      vmax_pct: round((vmaxMs / ownVmaxMs) * 100, 1),
      acc_n: Math.max(0, Math.round((row.minutes / 60) * r.normal(match ? 32 : 24, 5))),
      dec_n: Math.max(0, Math.round((row.minutes / 60) * r.normal(match ? 36 : 26, 5))),
      accel_load_au: Math.round(distM * 0.11 * (1 + r.normal(0, 0.08))),
    };
    if (row.contactsN !== null) values.contacts_n = row.contactsN;
    for (const [metricCode, value] of Object.entries(values)) {
      out.push({
        ...ids(ctx, 'external_metric', session.id, plan.key, metricCode),
        trainingSessionId: session.id,
        playerId: plan.id,
        metricCode,
        localDate: session.localDate,
        value,
        source: 'catapult',
        externalRef: `demo:${session.id}:${plan.key}`,
      });
    }
  }
  return out;
}

// ─── Test days and results ──────────────────────────────────────────────────────────

function testDay(
  ctx: Context,
  input: {
    key: readonly (string | number)[];
    sport: Sport;
    testWindowId: string | null;
    category: DemoCategoryKey;
    scheduledOn: LocalDate;
    done: boolean;
    notes: string;
    startMinutes?: number;
  },
): DemoTestSession {
  const r = randomFor(ctx.ns, ...input.key);
  const start = input.startMinutes ?? 9 * 60;
  const { month } = localDateParts(input.scheduledOn);
  const winter = month >= 5 && month <= 9;
  return {
    ...ids(ctx, ...input.key),
    sport: input.sport,
    testWindowId: input.testWindowId,
    category: input.category,
    scheduledOn: input.scheduledOn,
    status: input.done ? 'completed' : 'scheduled',
    location: TRAINING_VENUE,
    conditions: {
      surface: input.sport === 'hockey' ? 'Césped sintético' : 'Césped natural',
      footwear: input.sport === 'hockey' ? 'Zapatillas de hockey' : 'Botines',
      weather: r.pick(['Despejado', 'Nublado', 'Ventoso']),
      temperatureC: round(r.normal(winter ? 11 : 22, 3), 0),
      standardizedWarmUp: true,
    },
    notes: input.notes,
    evaluatorId: ctx.staff.sc[input.sport],
    startedAt: input.done ? at(input.scheduledOn, start, ctx.tz) : null,
    completedAt: input.done
      ? at(input.scheduledOn, start + (input.startMinutes === undefined ? 180 : 45), ctx.tz)
      : null,
  };
}

interface ResultSink {
  readonly testResults: DemoTestResult[];
  readonly testValues: DemoTestValue[];
  readonly availability: AvailabilityStatus;
  readonly bodyMassKg: number | null;
  readonly cmjFactor: number;
}

/**
 * Records a player's results of one test on a test day, the way the API does
 * (B-320): raw entries scored with the domain, the values of one entry
 * sharing its id, and the result-level derived metrics recomputed from the
 * scores. Strength is one result per exercise.
 */
function recordResults(
  ctx: Context,
  session: DemoTestSession,
  plan: PlayerPlan,
  testCode: CanonicalTestCode,
  stage: Stage,
  sink: ResultSink,
): void {
  const definition = ctx.definitions.get(testCode);
  if (definition === undefined) return;
  const date = session.scheduledOn;
  const r = randomFor(ctx.ns, 'test', session.id, plan.key, testCode);
  const age = decimalAgeYears(plan.birthDate, date);
  const groups = testEntries(plan, testCode, stage, age, r, sink);
  const injured = sink.availability !== 'available';
  const absent = !injured && r.chance(0.04);
  const settings = testScoringSettings(definition.protocol.parameters ?? null);
  const kept = new Set<string>(definition.metrics);
  for (const group of groups) {
    const resultKey = [
      'test_result',
      session.id,
      plan.key,
      testCode,
      group.exercise ?? '',
    ] as const;
    const result: DemoTestResult = {
      ...ids(ctx, ...resultKey),
      playerId: plan.id,
      testCode,
      testSessionId: session.id,
      measuredOn: date,
      status: injured || absent ? 'not_done' : 'done',
      notDoneReason: injured ? 'injured' : absent ? 'absent' : null,
      method: injured || absent ? null : (TEST_METHOD[testCode] ?? 'manual'),
      evaluatorId: session.evaluatorId,
      deviceId:
        injured || absent
          ? null
          : testCode === 'reaction'
            ? ctx.devices.tablet
            : testCode === 'sprint_40' || testCode === 'cod_505'
              ? ctx.devices.phone
              : null,
      exercise: group.exercise,
      conditions: session.conditions,
    };
    sink.testResults.push(result);
    if (result.status !== 'done') continue;
    const values: DemoTestValue[] = [];
    group.entries.forEach((e, index) => {
      const entryId = id(ctx, 'test_entry', result.id, index);
      const scored = scoreTestEntry(testCode, e.entry, settings);
      const inputs =
        e.entry.kind === 'value'
          ? null
          : Object.fromEntries(Object.entries(e.entry).filter(([, v]) => v !== undefined));
      const recordedAt = new Date(
        (session.startedAt ?? at(date, 9 * 60, ctx.tz)).getTime() + (10 + index * 4) * 60_000,
      );
      for (const v of scored.values) {
        if (!kept.has(v.metricCode)) continue;
        values.push({
          ...ids(ctx, 'test_value', entryId, v.metricCode),
          testResultId: result.id,
          metricCode: v.metricCode,
          attemptNumber: e.attemptNumber,
          entryId,
          inputs,
          value: v.value,
          recordedAt,
        });
      }
    });
    const scores = new Map(
      scoreResultMetrics(values, (code) => ({
        aggregation: definition.attemptAggregation,
        direction: directionOf(code),
      })).map((s) => [s.metricCode, s.value]),
    );
    for (const d of deriveResultMetrics(testCode, scores, { bodyMassKg: sink.bodyMassKg })) {
      if (!kept.has(d.metricCode)) continue;
      const entryId = id(ctx, 'test_entry', result.id, 'derived', d.metricCode);
      values.push({
        ...ids(ctx, 'test_value', entryId, d.metricCode),
        testResultId: result.id,
        metricCode: d.metricCode,
        attemptNumber: null,
        entryId,
        inputs: { kind: 'derived', from: [...scores.keys()].filter((k) => k !== d.metricCode) },
        value: d.value,
        recordedAt: new Date((session.completedAt ?? at(date, 12 * 60, ctx.tz)).getTime()),
      });
    }
    sink.testValues.push(...values);
  }
}

function directionOf(code: string): MetricDirection {
  return isCanonicalMetricCode(code) ? CANONICAL_METRICS[code].direction : 'neutral';
}

function attempts(count: number, make: (attempt: number) => TestEntryInput): DemoEntry[] {
  return Array.from({ length: count }, (_, i) => ({ attemptNumber: i + 1, entry: make(i + 1) }));
}

/** Rounds a load to what is on the bar: 2.5 kg plates. */
function plates(kg: number): number {
  return Math.max(2.5, Math.round(kg / 2.5) * 2.5);
}

function testEntries(
  plan: PlayerPlan,
  testCode: CanonicalTestCode,
  stage: Stage,
  age: number,
  r: Random,
  sink: ResultSink,
): { exercise: string | null; entries: DemoEntry[] }[] {
  const male = plan.sex === 'male';
  const t = plan.traits;
  const forward = plan.sport === 'rugby' && plan.line === 'forwards';
  const single = (entries: DemoEntry[]) => [{ exercise: null, entries }];
  switch (testCode) {
    case 'sprint_40': {
      const t40 =
        byAge(age, male ? 6.55 : 6.95, male ? 5.45 : 6.3) + (forward ? 0.25 : 0) - 0.18 * t.speed;
      return single(
        attempts(3, () => {
          const best = t40 + Math.abs(r.normal(0, 0.06));
          const split10S = round(best * 0.33 + r.normal(0, 0.015), 2);
          const split20S = round(best * 0.555 + r.normal(0, 0.015), 2);
          return { kind: 'sprint_splits', split10S, split20S, split40S: round(best, 2) };
        }),
      );
    }
    case 'cmj': {
      const h =
        (byAge(age, male ? 27 : 24, male ? 43 : 32) + 3.5 * t.power - (forward ? 2 : 0)) *
        sink.cmjFactor;
      return single(
        attempts(3, () => {
          const heightCm = Math.max(10, h - Math.abs(r.normal(0, 1.2)));
          const flightS = Math.sqrt((8 * heightCm) / 100 / 9.81);
          const takeoffFrame = r.int(120, 480);
          return {
            kind: 'cmj_video_frames',
            takeoffFrame,
            landingFrame: takeoffFrame + Math.round(flightS * 240),
            frameRateFps: 240,
          };
        }),
      );
    }
    case 'cod_505': {
      const base = byAge(age, male ? 2.8 : 3.0, male ? 2.38 : 2.62) - 0.07 * t.speed;
      const slower = 1 + t.asymmetryPct / 100;
      const leftSlow = r.chance(0.5);
      const sides = [
        ['cod505_left_s', leftSlow ? base * slower : base],
        ['cod505_right_s', leftSlow ? base : base * slower],
      ] as const;
      const entries: DemoEntry[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        for (const [metricCode, value] of sides) {
          entries.push({
            attemptNumber: attempt,
            entry: {
              kind: 'value',
              metricCode,
              value: round(value + Math.abs(r.normal(0, 0.04)), 2),
            },
          });
        }
      }
      return single(entries);
    }
    case 'ift_3015': {
      const vift =
        byAge(age, male ? 16.5 : 15.5, male ? 20 : 18) + 0.8 * t.aerobic - (forward ? 0.6 : 0);
      const stage15 = Math.max(1, Math.round((vift - 8) / 0.5) + 1);
      return single([
        { attemptNumber: null, entry: { kind: 'ift_stage', lastCompletedStage: stage15 } },
      ]);
    }
    case 'bronco': {
      const s = byAge(age, 340, 300) - 12 * t.aerobic + (forward ? 12 : 0);
      return single([
        {
          attemptNumber: null,
          entry: { kind: 'value', metricCode: 'bronco_time_s', value: round(s, 0) },
        },
      ]);
    }
    case 'strength':
      return strengthEntries(plan, stage, age, r, sink.bodyMassKg);
    case 'mobility': {
      const base = 11 + 1.8 * t.mobility;
      const entries: DemoEntry[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        for (const metricCode of ['knee_to_wall_left_cm', 'knee_to_wall_right_cm'] as const) {
          const v = clamp(base + r.normal(0, 0.6), 2, 20);
          entries.push({
            attemptNumber: attempt,
            entry: { kind: 'value', metricCode, value: round(v * 2, 0) / 2 },
          });
        }
      }
      return single(entries);
    }
    case 'reaction': {
      const simple = byAge(age, 285, 245) - 15 * t.reaction;
      const goNoGo = byAge(age, 440, 380) - 25 * t.reaction;
      const entries: DemoEntry[] = [];
      for (let attempt = 1; attempt <= 5; attempt++) {
        entries.push(
          {
            attemptNumber: attempt,
            entry: {
              kind: 'value',
              metricCode: 'reaction_simple_msec',
              value: round(simple + r.normal(0, 14), 0),
            },
          },
          {
            attemptNumber: attempt,
            entry: {
              kind: 'value',
              metricCode: 'reaction_go_no_go_msec',
              value: round(goNoGo + r.normal(0, 22), 0),
            },
          },
        );
      }
      return single(entries);
    }
    default:
      return [];
  }
}

/** Strength by stage (CLAUDE.md, "Etapas"): technique, e1RM from submaximal sets, direct RM. */
function strengthEntries(
  plan: PlayerPlan,
  stage: Stage,
  age: number,
  r: Random,
  bodyMassKg: number | null,
): { exercise: string | null; entries: DemoEntry[] }[] {
  const male = plan.sex === 'male';
  const t = plan.traits;
  const mass = bodyMassKg ?? weightKgAt(plan, age, heightCmAt(t, age));
  const value = (metricCode: string, v: number): DemoEntry => ({
    attemptNumber: null,
    entry: { kind: 'value', metricCode, value: v },
  });
  const technique = () => value('technique_score', r.chance(0.2) ? 1 : r.chance(0.6) ? 2 : 3);
  const pullups = Math.max(
    0,
    Math.round(byAge(age, male ? 3 : 1, male ? 12 : 5) + 2.5 * t.strength),
  );
  if (STAGE_PROFILES[stage].strengthAssessment === 'technique_reps') {
    const pushups = Math.max(
      3,
      Math.round(byAge(age, male ? 15 : 10, male ? 30 : 18) + 5 * t.strength),
    );
    return [
      { exercise: 'push_up', entries: [value('pushups_n', pushups), technique()] },
      { exercise: 'pull_up', entries: [value('pullups_n', pullups), technique()] },
      {
        exercise: 'plank',
        entries: [value('plank_s', Math.round(clamp(110 + 30 * t.strength, 40, 240)))],
      },
    ];
  }
  const ratio = (deadlift: number, bench: number) => ({
    deadlift: mass * (deadlift + 0.15 * t.strength),
    bench: mass * (bench + 0.08 * t.strength),
  });
  if (STAGE_PROFILES[stage].strengthAssessment === 'estimated_rm') {
    const target = male ? ratio(age < 15.5 ? 1.3 : 1.5, age < 15.5 ? 0.65 : 0.8) : ratio(1.0, 0.45);
    const sets = (e1rm: number): DemoEntry[] =>
      [1, 2].map((attemptNumber) => {
        const reps = r.int(3, 5);
        const rir = r.int(2, 3);
        return {
          attemptNumber,
          entry: {
            kind: 'strength_set',
            loadKg: plates(e1rm / (1 + (reps + rir) / 30) - (2 - attemptNumber) * 5),
            reps,
            rir,
          },
        };
      });
    return [
      { exercise: 'trap_bar_deadlift', entries: sets(target.deadlift) },
      { exercise: 'bench_press', entries: sets(target.bench) },
      { exercise: 'pull_up', entries: [value('pullups_n', pullups)] },
    ];
  }
  const target = male ? ratio(age < 17.5 ? 1.5 : 1.75, age < 17.5 ? 0.95 : 1.1) : ratio(1.1, 0.55);
  return [
    { exercise: 'back_squat', entries: [value('rm1_kg', plates(target.deadlift))] },
    { exercise: 'bench_press', entries: [value('rm1_kg', plates(target.bench))] },
    { exercise: 'pull_up', entries: [value('pullups_n', pullups)] },
  ];
}
