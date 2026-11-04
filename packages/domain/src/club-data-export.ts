import { memberGuard, memberParser } from './enum.js';
import { compareLocalDates, type LocalDate } from './time.js';

/**
 * CSV export of the club's data (B-608, ADR 0072): a ZIP with one CSV per
 * dataset, a dictionary of the columns and a manifest. The API records the
 * request with its scope fixed (the players the requester may export), the
 * worker generates the file and stores it in the bucket (ADR 0044).
 *
 * `packages/db` builds the `club_data_export_status` enum from these
 * constants, so a value is never renamed.
 */

/**
 * Datasets of an export, each one CSV of the ZIP. Health data is never one
 * (ADR 0029): the players' availability on the day of the request is a
 * column of `players`, without the cause.
 */
export const CLUB_DATA_EXPORT_DATASETS = [
  'players',
  'player_categories',
  'anthropometry',
  'test_results',
  'wellness',
  'participations',
  'external_loads',
  'load_daily',
  'field_metrics',
  'gym_sets',
  'metrics',
] as const;
export type ClubDataExportDataset = (typeof CLUB_DATA_EXPORT_DATASETS)[number];
export const isClubDataExportDataset = memberGuard(CLUB_DATA_EXPORT_DATASETS);
export const parseClubDataExportDataset = memberParser(
  CLUB_DATA_EXPORT_DATASETS,
  'invalid_argument',
  'club data export dataset',
);

/** Name of each dataset's CSV inside the ZIP (Spanish: the staff opens them). */
export const CLUB_DATA_EXPORT_FILE_NAMES: Readonly<Record<ClubDataExportDataset, string>> = {
  players: 'jugadores.csv',
  player_categories: 'categorias_jugadores.csv',
  anthropometry: 'antropometria.csv',
  test_results: 'tests.csv',
  wellness: 'bienestar.csv',
  participations: 'participaciones.csv',
  external_loads: 'carga_externa.csv',
  load_daily: 'carga_diaria.csv',
  field_metrics: 'metricas_cancha.csv',
  gym_sets: 'gimnasio.csv',
  metrics: 'metricas.csv',
};

/** Files every export carries besides the datasets. */
export const CLUB_DATA_EXPORT_MANIFEST_FILE = 'manifiesto.csv';
export const CLUB_DATA_EXPORT_DICTIONARY_FILE = 'diccionario.csv';

/**
 * Datasets whose rows have a club day, the ones a date range filters
 * (`from`/`to`, both inclusive). The roster, the category history and the
 * metric dictionary are always whole.
 */
export const CLUB_DATA_EXPORT_DATED_DATASETS = [
  'anthropometry',
  'test_results',
  'wellness',
  'participations',
  'external_loads',
  'load_daily',
  'field_metrics',
  'gym_sets',
] as const satisfies readonly ClubDataExportDataset[];

export function isDatedClubDataExportDataset(dataset: ClubDataExportDataset): boolean {
  return (CLUB_DATA_EXPORT_DATED_DATASETS as readonly ClubDataExportDataset[]).includes(dataset);
}

/**
 * Life of an export: `queued` (recorded, waiting for the worker), `running`
 * (being generated), `ready` (the ZIP is in the bucket; it expires with its
 * file) or `failed` (with an error code, never a message with data).
 */
export const CLUB_DATA_EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type ClubDataExportStatus = (typeof CLUB_DATA_EXPORT_STATUSES)[number];
export const isClubDataExportStatus = memberGuard(CLUB_DATA_EXPORT_STATUSES);

/**
 * Why an export failed, safe to show and log:
 * - `generation_failed`: reading the data or writing the ZIP failed on every attempt.
 * - `too_large`: the ZIP exceeds the largest `data_export` file.
 * - `storage_unavailable`: the bucket is not configured or refused the upload every time.
 */
export const CLUB_DATA_EXPORT_ERROR_CODES = [
  'generation_failed',
  'too_large',
  'storage_unavailable',
] as const;
export type ClubDataExportErrorCode = (typeof CLUB_DATA_EXPORT_ERROR_CODES)[number];
export const isClubDataExportErrorCode = memberGuard(CLUB_DATA_EXPORT_ERROR_CODES);

/** Format of the ZIP, in its manifest: a reader checks the version before parsing. */
export const CLUB_DATA_EXPORT_FORMAT = 'sport-performance.club-data-csv';
export const CLUB_DATA_EXPORT_FORMAT_VERSION = 1;

/** Attempts of the worker before an export is `failed`. */
export const CLUB_DATA_EXPORT_MAX_ATTEMPTS = 3;

/**
 * A `running` export not finished after this long belongs to a worker that
 * died: the next run takes it again (counting the attempt).
 */
export const CLUB_DATA_EXPORT_STALE_RUNNING_MINUTES = 30;

/** Rows read from the database per round trip while writing a CSV. */
export const CLUB_DATA_EXPORT_BATCH_ROWS = 2000;

/** Problems of a requested date range; empty when it is valid. */
export function clubDataExportRangeProblems(range: {
  readonly from?: LocalDate | null | undefined;
  readonly to?: LocalDate | null | undefined;
}): 'from_after_to'[] {
  const from = range.from ?? null;
  const to = range.to ?? null;
  if (from !== null && to !== null && compareLocalDates(from, to) > 0) return ['from_after_to'];
  return [];
}

/**
 * The datasets of a request in their canonical order, without duplicates;
 * every dataset when none is given.
 */
export function normalizeClubDataExportDatasets(
  requested: readonly ClubDataExportDataset[] | null | undefined,
): ClubDataExportDataset[] {
  if (requested === null || requested === undefined || requested.length === 0) {
    return [...CLUB_DATA_EXPORT_DATASETS];
  }
  const wanted = new Set(requested);
  return CLUB_DATA_EXPORT_DATASETS.filter((dataset) => wanted.has(dataset));
}

/**
 * Name of the ZIP on download: `datos-<club>-<aaaa-mm-dd>.zip`, with the
 * club's slug and the club day it was generated (ISO in a file name: it
 * sorts, and `/` cannot be in one).
 */
export function clubDataExportFileName(clubSlug: string, generatedOn: LocalDate): string {
  // Split instead of trimming with `^-+|-+$`: linear on any input.
  const slug = clubSlug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== '')
    .join('-');
  return `datos-${slug === '' ? 'club' : slug}-${generatedOn}.zip`;
}
