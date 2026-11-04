/**
 * The CSV export job against Postgres 16 and MinIO (B-608, ADR 0072): the
 * worker's login reads one snapshot of the club, writes the ZIP, stores it in
 * the bucket as a `data_export` file and marks the export ready; only the
 * players of the export, never a medical cause, es-AR formats; a player
 * erased half way discards the ZIP; failures retry and then fail with a code.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, schema, type Database } from '@sport-performance/db';
import { bootstrapClub } from '@sport-performance/db/seeds';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  CLUB_DATA_EXPORT_DATASETS,
  parseLocalDate,
  parseTimeZone,
  type ClubId,
  type PlayerId,
} from '@sport-performance/domain';
import { createS3Storage, type ObjectStorage } from '@sport-performance/storage';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import { strFromU8, unzipSync } from 'fflate';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExportClubs, runClubExports } from './process.js';

const { club, membership, player, user } = schema;

const serverUrl = process.env.DATABASE_URL;
const hasServices =
  serverUrl !== undefined &&
  serverUrl.trim() !== '' &&
  storageTestUrl !== undefined &&
  storageTestUrl !== '';
if (!hasServices && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL and STORAGE_TEST_URL are required in CI for the export tests.');
}

const logger = pino({ level: process.env.TEST_LOG_LEVEL === 'error' ? 'error' : 'silent' });
/** 20:00 in Buenos Aires on 2026-03-20. */
const NOW = new Date('2026-03-20T23:00:00Z');
const d = parseLocalDate;

/** CSV text of a ZIP entry, without the BOM, split in lines and fields (no quoted `;` here). */
function table(files: Record<string, Uint8Array>, name: string): string[][] {
  const bytes = files[name];
  if (bytes === undefined) throw new Error(`no ${name} in the ZIP`);
  // UTF-8 BOM first: Excel reads the encoding from it.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return parseCsv(strFromU8(bytes.subarray(3)));
}

/** RFC 4180 with `;`: quoted fields may hold `;`, `""` and line breaks. */
function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') {
      fields.push(field);
      field = '';
    } else if (char === '\r' && text.charAt(i + 1) === '\n') {
      fields.push(field);
      lines.push(fields);
      fields = [];
      field = '';
      i += 1;
    } else field += char;
  }
  expect(field === '' && fields.length === 0).toBe(true);
  return lines;
}

/** Rows of a CSV as objects by header. */
function records(files: Record<string, Uint8Array>, name: string): Record<string, string>[] {
  const [header, ...rows] = table(files, name);
  if (header === undefined) return [];
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
}

describe.skipIf(!hasServices)('CSV export job (Postgres 16 + MinIO)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let worker: pg.Pool;
  let bucket: TestBucket;
  let storage: ObjectStorage;
  let clubId: ClubId;
  let otherClubId: ClubId;
  let scId: string;
  let included: PlayerId;
  let excluded: PlayerId;
  /** A player with a data consent, so far: revoked after the request. */
  let revoked: PlayerId;
  let cmjTestId: string;
  let cmjMetricId: string;

  async function newPlayer(club: ClubId, firstName: string, lastName: string): Promise<PlayerId> {
    const [row] = await ownerDb
      .insert(player)
      .values({
        clubId: club,
        firstName,
        lastName,
        birthDate: d('2011-04-15'),
        sex: 'male',
        sport: 'rugby',
        joinedOn: d('2025-01-01'),
      })
      .returning({ id: player.id });
    if (row === undefined) throw new Error('no player');
    return row.id;
  }

  async function one<T>(sql: string, params: unknown[]): Promise<T> {
    const { rows } = await owner.query(sql, params);
    if (rows[0] === undefined) throw new Error(`nothing for ${sql}`);
    return rows[0] as T;
  }

  /** A queued export of the S&C member, as the API leaves it. */
  async function queueExport(values: { players?: PlayerId[]; datasets?: string[] } = {}) {
    const row = await one<{ id: string }>(
      `insert into club_data_export (club_id, requested_by, requester_role, datasets, requested_on,
                                     player_ids, excluded_players_n, availability)
       values ($1, $2, 'sc', $3, '2026-03-20', $4, 1, $5) returning id`,
      [
        clubId,
        scId,
        values.datasets ?? [...CLUB_DATA_EXPORT_DATASETS],
        values.players ?? [included],
        { [included]: { training: 'limited', match: 'unavailable' } },
      ],
    );
    return row.id;
  }

  async function exportRow(id: string) {
    return one<{
      status: string;
      attempts: number;
      file_id: string | null;
      row_counts: Record<string, number> | null;
      availability: unknown;
      error_code: string | null;
    }>(
      `select status::text as status, attempts, file_id, row_counts, availability, error_code
         from club_data_export where id = $1`,
      [id],
    );
  }

  async function download(fileId: string): Promise<Record<string, Uint8Array>> {
    const signed = await storage.presignDownload({
      key: `clubs/${clubId}/data_export/${fileId}`,
      expiresInS: 60,
      contentDisposition: 'attachment',
    });
    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    return unzipSync(new Uint8Array(await response.arrayBuffer()));
  }

  const deps = (overrides: Partial<Parameters<typeof runClubExports>[0]> = {}) => ({
    pool: worker,
    storage,
    logger,
    now: () => NOW,
    ...overrides,
  });

  /** Ends any pending export, so each test starts from its own. */
  async function settle() {
    await owner.query(
      `update club_data_export set status = 'failed', started_at = coalesce(started_at, now()),
              completed_at = now(), error_code = 'generation_failed', availability = null
        where status in ('queued', 'running')`,
    );
  }

  beforeAll(async () => {
    if (serverUrl === undefined || storageTestUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_export_test' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    const workerLogin = await temporary.login('worker');
    worker = temporary.pool({ connectionString: workerLogin.connectionString, max: 3 });
    bucket = await createTestBucket(storageTestUrl);
    storage = createS3Storage(bucket.config);

    const clubs = await ownerDb
      .insert(club)
      .values([
        {
          slug: 'club-export',
          name: 'Club Export',
          shortName: 'CE',
          timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
        },
        { slug: 'club-ajeno', name: 'Club Ajeno', shortName: 'CA' },
      ])
      .returning({ id: club.id });
    clubId = clubs[0]?.id as ClubId;
    otherClubId = clubs[1]?.id as ClubId;
    for (const id of [clubId, otherClubId]) {
      await bootstrapClub(ownerDb, { clubId: id, branches: [{ sport: 'rugby', sex: 'male' }] });
    }
    scId = `sc-${randomUUID()}`;
    await ownerDb
      .insert(user)
      .values({ id: scId, name: 'Pepa Preparadora', email: `${scId}@x.com` });
    await ownerDb.insert(membership).values({ clubId, userId: scId, role: 'sc' });

    // A name a spreadsheet would run as a formula, and a surname with the separator.
    included = await newPlayer(clubId, '=HYPERLINK("x")', 'Pérez; "Toto"');
    excluded = await newPlayer(clubId, 'Fuera', 'Dealcance');
    revoked = await newPlayer(clubId, 'Revocó', 'Consentimiento');
    const foreign = await newPlayer(otherClubId, 'Ajeno', 'Otroclub');
    const m15 = await one<{ id: string }>(
      `select id from category where club_id = $1 and age_band_code = 'm15'`,
      [clubId],
    );
    await owner.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2026-01-01'), ($1, $4, $3, '2026-01-01')`,
      [clubId, included, m15.id, excluded],
    );
    // The API only puts players with a current data consent in an export (`excluded` is there
    // only as a player that leaves the scope).
    await owner.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by, signed_at)
       values ($1, $2, 'data', '2026-01', 'guardian', $4, '2026-01-01'),
              ($1, $3, 'data', '2026-01', 'guardian', $4, '2026-01-01')`,
      [clubId, included, revoked, scId],
    );

    const cmj = await one<{ test_id: string; metric_id: string }>(
      `select t.id as test_id, m.id as metric_id from test_definition t, metric_definition m
        where t.club_id = $1 and t.code = 'cmj' and m.club_id = $1 and m.code = 'cmj_height_cm'
        order by t.version desc limit 1`,
      [clubId],
    );
    cmjTestId = cmj.test_id;
    cmjMetricId = cmj.metric_id;
    const done = await one<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method, notes)
       values ($1, $2, $3, '2026-03-10', 'done', 'manual', '+cargado a mano') returning id`,
      [clubId, included, cmj.test_id],
    );
    await owner.query(
      `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit, recorded_at)
       values ($1, $2, $3, 1, 35.2, 'cm', '2026-03-10T21:05:00Z'), ($1, $2, $3, 2, 36.4, 'cm', '2026-03-10T21:08:00Z'),
              ($1, $2, $3, 3, 99.9, 'cm', '2026-03-10T21:10:00Z')`,
      [clubId, done.id, cmj.metric_id],
    );
    await owner.query(
      `update test_result_value set voided_at = now(), voided_by = $2, void_reason = 'mal cargado'
        where test_result_id = $1 and value = 99.9`,
      [done.id, scId],
    );
    await owner.query(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, not_done_reason, not_done_note)
       values ($1, $2, $3, '2026-03-11', 'not_done', 'injured', 'Esguince de tobillo')`,
      [clubId, included, cmj.test_id],
    );
    await owner.query(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, '2026-03-12', 5, 4, 3, 2, 4, 5), ($1, $3, '2026-03-12', 5, 1, 1, 1, 1, 1),
              ($1, $2, '2025-12-01', 5, 3, 3, 3, 3, 3)`,
      [clubId, included, excluded],
    );
    await owner.query(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, '2026-03-12', 5, 2, 2, 2, 2, 2)`,
      [otherClubId, foreign],
    );
    await owner.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, weight_kg, phv_offset_years, maturity_offset_equation)
       values ($1, $2, '2026-03-01', 165.5, 55.25, -0.512, 'moore_2015')`,
      [clubId, included],
    );
    const session = await one<{ id: string }>(
      `insert into training_session (club_id, sport, kind, category_id, title, starts_at, local_date)
       values ($1, 'rugby', 'training', $2, 'Velocidad', '2026-03-13T21:30:00Z', '2026-03-13') returning id`,
      [clubId, m15.id],
    );
    await owner.query(
      `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
       values ($1, $2, $3, 'full', 60, 7, '2026-03-13T23:00:00Z')`,
      [clubId, session.id, included],
    );
    const dist = await one<{ id: string }>(
      `select id from metric_definition where club_id = $1 and code = 'dist_m'`,
      [clubId],
    );
    await owner.query(
      `insert into external_metric (club_id, player_id, training_session_id, metric_definition_id, local_date, value, unit, source)
       values ($1, $2, $3, $4, '2026-03-13', 5234.5, 'm', 'catapult')`,
      [clubId, included, session.id, dist.id],
    );
    await owner.query(
      `insert into gym_set (club_id, player_id, performed_on, exercise_code, load_kind, set_number, reps, load_kg, rir)
       values ($1, $2, '2026-03-14', 'goblet_squat', 'external', 1, 5, 20.5, 2)`,
      [clubId, included],
    );
  });

  afterAll(async () => {
    await bucket.drop();
    await temporary.drop();
  });

  it('lists the club with a queued export for the sweep', async () => {
    const id = await queueExport();
    expect(await listExportClubs(worker)).toEqual([clubId]);
    await settle();
    expect((await exportRow(id)).status).toBe('failed');
    expect(await listExportClubs(worker)).toEqual([]);
  });

  it('writes the ZIP of the players of the export, in es-AR, and marks it ready', async () => {
    const id = await queueExport();
    const report = await runClubExports(deps(), clubId, { jobId: 'job-1' });
    expect(report).toEqual({ ready: 1, failed: 0, more: false });

    const row = await exportRow(id);
    expect(row).toMatchObject({
      status: 'ready',
      attempts: 1,
      availability: null,
      error_code: null,
    });
    expect(row.row_counts).toMatchObject({
      players: 1,
      player_categories: 1,
      anthropometry: 1,
      test_results: 3,
      wellness: 2,
      participations: 1,
      load_daily: 0,
      field_metrics: 1,
      gym_sets: 1,
    });
    const fileId = row.file_id ?? '';
    const file = await one<{
      kind: string;
      status: string;
      content_type: string;
      file_name: string;
      size_bytes: string;
      expires_at: Date;
      created_by: string;
    }>(
      `select kind::text as kind, status::text as status, content_type, file_name, size_bytes,
              expires_at, created_by from file where id = $1`,
      [fileId],
    );
    expect(file).toMatchObject({
      kind: 'data_export',
      status: 'ready',
      content_type: 'application/zip',
      file_name: 'datos-club-export-2026-03-20.zip',
      created_by: scId,
    });
    expect(file.expires_at.getTime() - NOW.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(await storage.stat(`clubs/${clubId}/data_export/${fileId}`)).toMatchObject({
      sizeBytes: Number(file.size_bytes),
    });

    const files = await download(fileId);
    expect(Object.keys(files).sort()).toEqual(
      [
        'jugadores.csv',
        'categorias_jugadores.csv',
        'antropometria.csv',
        'tests.csv',
        'bienestar.csv',
        'participaciones.csv',
        'carga_diaria.csv',
        'metricas_cancha.csv',
        'gimnasio.csv',
        'metricas.csv',
        'diccionario.csv',
        'manifiesto.csv',
      ].sort(),
    );

    // The roster: the formula is inert, the separator quoted, availability without a cause.
    const roster = strFromU8(files['jugadores.csv'] ?? new Uint8Array());
    expect(roster).toContain(
      `${included};"Pérez; ""Toto""";"'=HYPERLINK(""x"")";15/04/2011;male;rugby;M15`,
    );
    expect(roster).toContain('limited;unavailable\r\n');
    expect(roster).not.toContain('Dealcance');
    expect(roster).not.toContain('Otroclub');

    const tests = records(files, 'tests.csv');
    expect(
      tests.map((t) => [t.fecha, t.estado, t.intento, t.valor, t.motivo_no_realizado]),
    ).toEqual([
      ['10/03/2026', 'done', '1', '35,2', ''],
      ['10/03/2026', 'done', '2', '36,4', ''],
      ['11/03/2026', 'not_done', '', '', 'unavailable'],
    ]);
    expect(tests[0]).toMatchObject({ registrado: '10/03/2026 18:05', metrica: 'cmj_height_cm' });
    expect(tests[0]?.notas).toBe("'+cargado a mano");
    const allText = Object.values(files)
      .map((bytes) => strFromU8(bytes))
      .join('\n');
    // Never the medical cause, never a voided value, never another club's data.
    expect(allText).not.toContain('Esguince');
    expect(allText).not.toContain('injured');
    expect(allText).not.toContain('99,9');
    expect(allText).not.toContain('Ajeno');

    expect(records(files, 'antropometria.csv')[0]).toMatchObject({
      fecha: '01/03/2026',
      talla_cm: '165,5',
      peso_kg: '55,25',
      offset_phv_anios: '-0,512',
      ecuacion_offset: 'moore_2015',
    });
    expect(records(files, 'participaciones.csv')[0]).toMatchObject({
      fecha: '13/03/2026',
      inicio: '13/03/2026 18:30',
      minutos: '60',
      rpe: '7',
      srpe_ua: '420',
    });
    expect(records(files, 'metricas_cancha.csv')[0]).toMatchObject({
      metrica: 'dist_m',
      valor: '5234,5',
    });
    expect(records(files, 'gimnasio.csv')[0]).toMatchObject({
      tipo_de_carga: 'external',
      carga_kg: '20,5',
      rir: '2',
    });
    expect(records(files, 'metricas.csv').some((m) => m.codigo === 'dist_m')).toBe(true);
    expect(allText).not.toContain('PlayerLoad;');

    const manifest: Record<string, string> = Object.fromEntries(
      table(files, 'manifiesto.csv')
        .slice(1)
        .map(([key, value]) => [key ?? '', value ?? '']),
    );
    expect(manifest).toMatchObject({
      formato: 'sport-performance.club-data-csv',
      version_formato: '1',
      exportacion_id: id,
      club: 'Club Export',
      generado: '20/03/2026 20:00',
      dia_del_pedido: '20/03/2026',
      pedido_por: 'Pepa Preparadora',
      rol: 'sc',
      jugadores_incluidos: '1',
      jugadores_sin_consentimiento_de_datos: '1',
      'filas tests.csv': '3',
    });
    const dictionary = records(files, 'diccionario.csv');
    expect(dictionary.find((c) => c.columna === 'talla_cm')).toMatchObject({
      archivo: 'antropometria.csv',
      tipo: 'decimal (coma)',
      unidad: 'cm',
    });
  });

  it('applies the date range to the dated datasets only', async () => {
    const id = await queueExport({ datasets: ['players', 'wellness'] });
    await owner.query(
      `update club_data_export set from_date = '2026-01-01', to_date = '2026-03-31' where id = $1`,
      [id],
    );
    await runClubExports(deps(), clubId);
    const row = await exportRow(id);
    expect(row.row_counts).toEqual({ players: 1, wellness: 1 });
    const files = await download(row.file_id ?? '');
    expect(Object.keys(files).sort()).toEqual(
      ['bienestar.csv', 'diccionario.csv', 'jugadores.csv', 'manifiesto.csv'].sort(),
    );
    expect(records(files, 'bienestar.csv')).toMatchObject([{ fecha: '12/03/2026', promedio: '' }]);
  });

  it('discards the ZIP and queues the export again when a player leaves its scope half way', async () => {
    const id = await queueExport({ players: [included, excluded] });
    const erasing: ObjectStorage = {
      ...storage,
      putObject: async (request) => {
        // What erasing `excluded` does to the export while its ZIP is being uploaded.
        await owner.query(
          `update club_data_export set player_ids = array_remove(player_ids, $2) where id = $1`,
          [id, excluded],
        );
        await storage.putObject(request);
      },
    };
    const report = await runClubExports(deps({ storage: erasing }), clubId);
    expect(report).toEqual({ ready: 0, failed: 0, more: true });
    const row = await exportRow(id);
    // Not a failure: the attempt is given back.
    expect(row).toMatchObject({ status: 'queued', attempts: 0, file_id: null });
    const discarded = await one<{ status: string; expired: boolean }>(
      `select status::text as status, expires_at <= now() as expired from file
        where club_id = $1 and kind = 'data_export' order by created_at desc limit 1`,
      [clubId],
    );
    expect(discarded).toEqual({ status: 'deleted', expired: true });
    // The next run writes it without them.
    await runClubExports(deps(), clubId);
    expect(await exportRow(id)).toMatchObject({ status: 'ready', attempts: 1 });
  });

  it('leaves out a player whose data consent was revoked after the request', async () => {
    const id = await queueExport({ players: [included, revoked], datasets: ['players'] });
    await owner.query(
      `update consent set revoked_at = now(), revoked_by = $3
        where club_id = $1 and player_id = $2 and type = 'data'`,
      [clubId, revoked, scId],
    );
    await runClubExports(deps(), clubId);
    const row = await exportRow(id);
    expect(row).toMatchObject({ status: 'ready', row_counts: { players: 1 } });
    const files = await download(row.file_id ?? '');
    expect(strFromU8(files['jugadores.csv'] ?? new Uint8Array())).not.toContain('Revocó');
    const manifest: Record<string, string> = Object.fromEntries(
      table(files, 'manifiesto.csv')
        .slice(1)
        .map(([key, value]) => [key ?? '', value ?? '']),
    );
    expect(manifest).toMatchObject({
      jugadores_incluidos: '1',
      jugadores_sin_consentimiento_de_datos: '2',
    });
  });

  it('leaves out a done result whose values were all voided', async () => {
    const voided = await one<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method)
       values ($1, $2, $3, '2026-03-15', 'done', 'manual') returning id`,
      [clubId, included, cmjTestId],
    );
    await owner.query(
      `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit,
                                      recorded_at, voided_at, voided_by, void_reason)
       values ($1, $2, $3, 1, 41.0, 'cm', '2026-03-15T21:00:00Z', now(), $4, 'otro jugador')`,
      [clubId, voided.id, cmjMetricId, scId],
    );
    const id = await queueExport({ datasets: ['test_results'] });
    await runClubExports(deps(), clubId);
    const row = await exportRow(id);
    expect(row.row_counts).toEqual({ test_results: 3 });
    const files = await download(row.file_id ?? '');
    expect(records(files, 'tests.csv').some((r) => r.fecha === '15/03/2026')).toBe(false);
  });

  it('retries a failed upload and fails with a code after the last attempt', async () => {
    const id = await queueExport({ datasets: ['players'] });
    const broken: ObjectStorage = {
      ...storage,
      putObject: () => Promise.reject(new Error('bucket down')),
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(runClubExports(deps({ storage: broken }), clubId)).rejects.toThrow(
        'The bucket refused the export',
      );
      expect((await exportRow(id)).status).toBe(attempt < 3 ? 'queued' : 'failed');
    }
    expect(await exportRow(id)).toMatchObject({
      attempts: 3,
      error_code: 'storage_unavailable',
      availability: null,
    });
    // Every ZIP row it left is deleted (the retention job purges the objects).
    const { rows } = await owner.query<{ status: string }>(
      `select status::text as status from file where club_id = $1 and kind = 'data_export'
        and status <> 'ready' and created_at > now() - interval '1 minute'`,
      [clubId],
    );
    expect(rows.every((r) => r.status === 'deleted')).toBe(true);
  });

  it('never queues again nor fails an export another run took over while it failed', async () => {
    // Before the last attempt (the failure would queue it) and on it (it would fail it).
    for (const priorAttempts of [0, 2]) {
      const id = await queueExport({ datasets: ['players'] });
      await owner.query(`update club_data_export set attempts = $2 where id = $1`, [
        id,
        priorAttempts,
      ]);
      const takenOver: ObjectStorage = {
        ...storage,
        putObject: async () => {
          // Past the stale window, another run claimed the export while this one uploaded.
          await owner.query(
            `update club_data_export set started_at = now() + interval '1 second' where id = $1`,
            [id],
          );
          throw new Error('bucket down');
        },
      };
      await expect(runClubExports(deps({ storage: takenOver }), clubId)).rejects.toThrow(
        'The bucket refused the export',
      );
      expect(await exportRow(id)).toMatchObject({
        status: 'running',
        attempts: priorAttempts + 1,
        error_code: null,
      });
    }
  });

  it('fails a ZIP larger than the limit without retrying', async () => {
    const id = await queueExport();
    expect(await runClubExports(deps({ maxSizeBytes: 64 }), clubId)).toEqual({
      ready: 0,
      failed: 1,
      more: false,
    });
    expect(await exportRow(id)).toMatchObject({ status: 'failed', error_code: 'too_large' });
  });

  it('takes over an export whose worker died, and fails it once out of attempts', async () => {
    const id = await queueExport({ datasets: ['players'] });
    await owner.query(
      `update club_data_export set status = 'running', attempts = 1,
              started_at = now() - interval '31 minutes' where id = $1`,
      [id],
    );
    await runClubExports(deps(), clubId);
    expect(await exportRow(id)).toMatchObject({ status: 'ready', attempts: 2 });

    const stuck = await queueExport({ datasets: ['players'] });
    await owner.query(
      `update club_data_export set status = 'running', attempts = 3,
              started_at = now() - interval '31 minutes' where id = $1`,
      [stuck],
    );
    expect(await runClubExports(deps(), clubId)).toEqual({ ready: 0, failed: 1, more: false });
    expect(await exportRow(stuck)).toMatchObject({
      status: 'failed',
      error_code: 'generation_failed',
    });
  });
});
