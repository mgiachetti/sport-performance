import type { ClubDataExportDataset } from '@sport-performance/domain';
import type { CsvColumn } from './csv.js';

/**
 * The datasets of a CSV export (B-608, ADR 0072): the columns of each CSV and
 * the query that reads its rows. Every query starts with the same `args`
 * (the parameters, typed once):
 *
 * - `$1` players of the export (`uuid[]`, fixed by the API at the request);
 * - `$2`, `$3` club days of the range (`date`, `NULL` = unbounded), applied
 *   to the dated datasets;
 * - `$4` the club day of the request (current category, position, stage);
 * - `$5` the availability snapshot (`jsonb`, `playerId → { training, match }`).
 *
 * The queries run as the worker in the club of the job (RLS) and also filter
 * by `app.current_club_id()`, so the indexes apply. Days come as text
 * (`aaaa-mm-dd`, never a JavaScript `Date` that a zone could shift).
 *
 * What never goes in: the `medical` schema (only the availability of the
 * request day, without the cause; `injured` reads `unavailable`), guardians
 * and parents' heights (other people's data), accounts and emails, consents,
 * files, the change history and the sync log.
 */

export interface DatasetDefinition {
  readonly columns: readonly CsvColumn[];
  /** The SELECT of its rows, after the `args` CTE (no trailing `;`). */
  readonly query: string;
}

export const DATASET_ARGS = `with args as (
  select $1::uuid[] as players, $2::date as from_day, $3::date as to_day,
         $4::date as today, $5::jsonb as availability
)`;

/** `(from, to)` of the range over a club-day column. */
const inRange = (column: string) =>
  `(a.from_day is null or ${column} >= a.from_day) and (a.to_day is null or ${column} <= a.to_day)`;

const PLAYER_COLUMNS: readonly CsvColumn[] = [
  { key: 'player_id', header: 'jugador_id', type: 'code', description: 'Id del jugador/a.' },
  { key: 'last_name', header: 'apellido', type: 'text', description: 'Apellido.' },
  { key: 'first_name', header: 'nombre', type: 'text', description: 'Nombre.' },
];

const PLAYER_JOIN = `join player p on p.club_id = x.club_id and p.id = x.player_id`;

const players: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    {
      key: 'birth_date',
      header: 'fecha_nacimiento',
      type: 'date',
      description: 'Fecha de nacimiento.',
    },
    {
      key: 'sex',
      header: 'sexo',
      type: 'code',
      description: 'Sexo para las fórmulas de maduración y las referencias (`male`, `female`).',
    },
    { key: 'sport', header: 'deporte', type: 'code', description: 'Deporte (`rugby`, `hockey`).' },
    {
      key: 'categories',
      header: 'categorias',
      type: 'list',
      description: 'Categorías vigentes el día del pedido.',
    },
    {
      key: 'main_position',
      header: 'posicion_principal',
      type: 'code',
      description: 'Código de la posición principal (o el nombre propio del club).',
    },
    {
      key: 'dominant_side',
      header: 'lado_dominante',
      type: 'code',
      description: 'Lado dominante (`left`, `right`, `both`).',
    },
    { key: 'joined_on', header: 'alta', type: 'date', description: 'Día de alta en el club.' },
    { key: 'left_on', header: 'baja', type: 'date', description: 'Día de baja, si se fue.' },
    { key: 'left_reason', header: 'motivo_baja', type: 'code', description: 'Motivo de la baja.' },
    {
      key: 'stage',
      header: 'etapa',
      type: 'code',
      description: 'Etapa vigente el día del pedido (`foundation`, `development`, `performance`).',
    },
    {
      key: 'stage_basis',
      header: 'etapa_por',
      type: 'code',
      description: 'Cómo se asignó la etapa (por categoría, por maduración o fijada por el staff).',
    },
    {
      key: 'availability_training',
      header: 'disponibilidad_entrenamiento',
      type: 'code',
      description:
        'Disponibilidad para entrenar el día del pedido (`available`, `limited`, `unavailable`). Nunca el motivo.',
    },
    {
      key: 'availability_match',
      header: 'disponibilidad_partido',
      type: 'code',
      description: 'Disponibilidad para jugar el día del pedido. Nunca el motivo.',
    },
  ],
  query: `select p.id as player_id, p.last_name, p.first_name, p.birth_date::text as birth_date,
       p.sex::text as sex, p.sport::text as sport,
       array(select c.name from player_category pc
               join category c on c.club_id = pc.club_id and c.id = pc.category_id
              where pc.club_id = p.club_id and pc.player_id = p.id
                and pc.valid_from <= a.today and (pc.valid_to is null or pc.valid_to > a.today)
              order by c.sort_order, c.name) as categories,
       (select coalesce(po.label, po.code) from player_position pp
          join position po on po.club_id = pp.club_id and po.id = pp.position_id
         where pp.club_id = p.club_id and pp.player_id = p.id
         order by pp.sort_order limit 1) as main_position,
       p.dominant_side::text as dominant_side, p.joined_on::text as joined_on,
       p.left_on::text as left_on, p.left_reason::text as left_reason,
       st.stage::text as stage, st.basis::text as stage_basis,
       a.availability -> p.id::text ->> 'training' as availability_training,
       a.availability -> p.id::text ->> 'match' as availability_match
  from player p
  cross join args a
  left join lateral (
    select ps.stage, ps.basis from player_stage ps
     where ps.club_id = p.club_id and ps.player_id = p.id
       and ps.valid_from <= a.today and (ps.valid_to is null or ps.valid_to > a.today)
     order by ps.valid_from desc, ps.created_at desc limit 1
  ) st on true
 where p.club_id = app.current_club_id() and p.id = any (a.players)
 order by p.last_name, p.first_name, p.id`,
};

const playerCategories: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    { key: 'category', header: 'categoria', type: 'text', description: 'Categoría.' },
    {
      key: 'age_band',
      header: 'franja_edad',
      type: 'code',
      description: 'Franja de edad canónica de la categoría (`m15`), comparable entre clubes.',
    },
    { key: 'season', header: 'temporada', type: 'text', description: 'Temporada, si la hay.' },
    {
      key: 'valid_from',
      header: 'desde',
      type: 'date',
      description: 'Primer día en la categoría.',
    },
    {
      key: 'valid_until',
      header: 'hasta',
      type: 'date',
      description: 'Último día en la categoría (inclusive); vacío si sigue.',
    },
  ],
  query: `select x.player_id, p.last_name, p.first_name, c.name as category,
       c.age_band_code as age_band, s.name as season, x.valid_from::text as valid_from,
       (x.valid_to - 1)::text as valid_until
  from player_category x
  cross join args a
  ${PLAYER_JOIN}
  join category c on c.club_id = x.club_id and c.id = x.category_id
  left join season s on s.club_id = x.club_id and s.id = x.season_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   -- An assignment cancelled before it started (empty range) never held.
   and (x.valid_to is null or x.valid_to > x.valid_from)
 order by p.last_name, p.first_name, x.player_id, x.valid_from, x.id`,
};

const anthropometry: DatasetDefinition = {
  columns: [
    { key: 'id', header: 'medida_id', type: 'code', description: 'Id de la medición.' },
    ...PLAYER_COLUMNS,
    { key: 'measured_on', header: 'fecha', type: 'date', description: 'Día de la medición.' },
    { key: 'height_cm', header: 'talla_cm', type: 'decimal', unit: 'cm', description: 'Talla.' },
    {
      key: 'sitting_height_cm',
      header: 'talla_sentado_cm',
      type: 'decimal',
      unit: 'cm',
      description: 'Talla sentado.',
    },
    { key: 'weight_kg', header: 'peso_kg', type: 'decimal', unit: 'kg', description: 'Peso.' },
    {
      key: 'skinfolds_sum_mm',
      header: 'suma_pliegues_mm',
      type: 'decimal',
      unit: 'mm',
      description: 'Suma de pliegues (ISAK).',
    },
    {
      key: 'method',
      header: 'metodo',
      type: 'code',
      description: 'Cómo se midió (`manual`, `historical`…).',
    },
    { key: 'evaluator', header: 'evaluador', type: 'text', description: 'Quién midió.' },
    {
      key: 'phv_offset_years',
      header: 'offset_phv_anios',
      type: 'decimal',
      decimals: 3,
      unit: 'years',
      description: 'Años desde el pico de velocidad de crecimiento (negativo: antes del PHV).',
    },
    {
      key: 'maturity_offset_equation',
      header: 'ecuacion_offset',
      type: 'code',
      description: 'Ecuación del offset (`mirwald_2002`, `moore_2015`…).',
    },
    {
      key: 'adult_height_pct',
      header: 'pct_talla_adulta',
      type: 'decimal',
      decimals: 2,
      unit: 'pct',
      description: '% de la talla adulta predicha (Khamis-Roche).',
    },
    {
      key: 'predicted_adult_height_cm',
      header: 'talla_adulta_predicha_cm',
      type: 'decimal',
      decimals: 2,
      unit: 'cm',
      description: 'Talla adulta predicha (Khamis-Roche).',
    },
    {
      key: 'growth_velocity_cm_year',
      header: 'velocidad_crecimiento_cm_anio',
      type: 'decimal',
      decimals: 2,
      unit: 'cm_year',
      description: 'Velocidad de crecimiento desde la medición anterior.',
    },
    { key: 'conditions', header: 'condiciones', type: 'json', description: 'Condiciones.' },
    { key: 'notes', header: 'notas', type: 'text', description: 'Notas.' },
  ],
  query: `select x.id, x.player_id, p.last_name, p.first_name, x.measured_on::text as measured_on,
       x.height_cm, x.sitting_height_cm, x.weight_kg, x.skinfolds_sum_mm, x.method::text as method,
       u.name as evaluator, x.phv_offset_years,
       x.maturity_offset_equation::text as maturity_offset_equation, x.adult_height_pct,
       x.predicted_adult_height_cm, x.growth_velocity_cm_year, x.conditions, x.notes
  from anthro_measurement x
  cross join args a
  ${PLAYER_JOIN}
  left join "user" u on u.id = x.evaluator_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.measured_on')}
 order by x.measured_on, p.last_name, p.first_name, x.id`,
};

const testResults: DatasetDefinition = {
  columns: [
    { key: 'result_id', header: 'resultado_id', type: 'code', description: 'Id del resultado.' },
    ...PLAYER_COLUMNS,
    { key: 'measured_on', header: 'fecha', type: 'date', description: 'Día del test.' },
    { key: 'test_code', header: 'test', type: 'code', description: 'Código del test (`cmj`).' },
    {
      key: 'protocol_version',
      header: 'version_protocolo',
      type: 'integer',
      description: 'Versión del protocolo con la que se midió.',
    },
    {
      key: 'window',
      header: 'ventana',
      type: 'code',
      description: 'Ventana de tests (`V1`…`V4`), si el día de test tenía una.',
    },
    { key: 'season', header: 'temporada', type: 'text', description: 'Temporada de la ventana.' },
    {
      key: 'status',
      header: 'estado',
      type: 'code',
      description: '`done` (realizado) o `not_done` (no realizado).',
    },
    {
      key: 'not_done_reason',
      header: 'motivo_no_realizado',
      type: 'code',
      description:
        'Por qué no se hizo (`absent`, `unavailable`, `not_applicable_to_stage`, `other`). Una lesión sale como `unavailable`: nunca el motivo médico.',
    },
    {
      key: 'not_done_note',
      header: 'nota_no_realizado',
      type: 'text',
      description: 'Nota del motivo `other`.',
    },
    {
      key: 'method',
      header: 'metodo',
      type: 'code',
      description:
        'Cómo se midió (`manual`, `video`, `photocell`, `pod`, `app`, `historical`): nunca se comparan métodos distintos sin avisar.',
    },
    {
      key: 'exercise',
      header: 'ejercicio',
      type: 'code',
      description: 'Ejercicio de un resultado de fuerza.',
    },
    {
      key: 'metric_code',
      header: 'metrica',
      type: 'code',
      description: 'Código canónico de la métrica (`t10_s`, `cmj_height_cm`); ver `metricas.csv`.',
    },
    {
      key: 'attempt_number',
      header: 'intento',
      type: 'integer',
      description: 'Número de intento; vacío para un valor del resultado (mejor, derivado).',
    },
    { key: 'value', header: 'valor', type: 'decimal', description: 'Valor medido.' },
    { key: 'unit', header: 'unidad', type: 'code', description: 'Unidad del valor.' },
    {
      key: 'recorded_at',
      header: 'registrado',
      type: 'datetime',
      description: 'Cuándo se registró el valor (hora del club).',
    },
    { key: 'evaluator', header: 'evaluador', type: 'text', description: 'Quién evaluó.' },
    { key: 'device', header: 'equipo', type: 'text', description: 'Equipo usado, si hubo.' },
    {
      key: 'imported',
      header: 'importado',
      type: 'boolean',
      description: 'Si vino de una importación de históricos.',
    },
    { key: 'conditions', header: 'condiciones', type: 'json', description: 'Condiciones.' },
    { key: 'notes', header: 'notas', type: 'text', description: 'Notas del resultado.' },
  ],
  // One row per valid value (voided values are corrections, not data); a result not done is
  // one row with the metric empty. A done result whose values were all voided has no data
  // left and is left out: an empty metric would read as not done.
  query: `select x.id as result_id, x.player_id, p.last_name, p.first_name,
       x.measured_on::text as measured_on, td.code as test_code, td.version as protocol_version,
       case when w.number is null then null else 'V' || w.number end as window, s.name as season,
       x.status::text as status,
       app.not_done_reason_for_viewer(x.not_done_reason) as not_done_reason,
       case when x.not_done_reason = 'injured' then null else x.not_done_note end as not_done_note,
       x.method::text as method, x.exercise, md.code as metric_code, v.attempt_number, v.value,
       v.unit::text as unit, v.recorded_at, u.name as evaluator, d.label as device,
       x.import_id is not null as imported, x.conditions, x.notes
  from test_result x
  cross join args a
  ${PLAYER_JOIN}
  join test_definition td on td.club_id = x.club_id and td.id = x.test_definition_id
  left join test_result_value v
    on v.club_id = x.club_id and v.test_result_id = x.id and v.voided_at is null
  left join metric_definition md on md.club_id = v.club_id and md.id = v.metric_definition_id
  left join test_session ts on ts.club_id = x.club_id and ts.id = x.test_session_id
  left join test_window w on w.club_id = ts.club_id and w.id = ts.test_window_id
  left join season s on s.club_id = w.club_id and s.id = w.season_id
  left join device d on d.club_id = x.club_id and d.id = x.device_id
  left join "user" u on u.id = x.evaluator_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.measured_on')}
   and (x.status <> 'done' or v.id is not null)
 order by x.measured_on, p.last_name, p.first_name, x.id, md.code, v.attempt_number nulls first,
          v.recorded_at, v.id`,
};

const wellness: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    { key: 'local_date', header: 'fecha', type: 'date', description: 'Día del club.' },
    {
      key: 'item_count',
      header: 'items',
      type: 'integer',
      description: 'Ítems del cuestionario (3 con caritas en M13/M14, 5 desde M15).',
    },
    { key: 'sleep', header: 'sueno', type: 'integer', unit: 'score', description: 'Sueño (1–5).' },
    {
      key: 'fatigue',
      header: 'fatiga',
      type: 'integer',
      unit: 'score',
      description: 'Fatiga (1–5).',
    },
    {
      key: 'soreness',
      header: 'dolor_muscular',
      type: 'integer',
      unit: 'score',
      description: 'Dolor muscular (1–5).',
    },
    {
      key: 'stress',
      header: 'estres',
      type: 'integer',
      unit: 'score',
      description: 'Estrés (1–5).',
    },
    { key: 'mood', header: 'animo', type: 'integer', unit: 'score', description: 'Ánimo (1–5).' },
    {
      key: 'mean_score',
      header: 'promedio',
      type: 'decimal',
      decimals: 2,
      unit: 'score',
      description: 'Promedio de los ítems (más alto, mejor).',
    },
    {
      key: 'baseline_mean_score',
      header: 'media_propia',
      type: 'decimal',
      decimals: 2,
      unit: 'score',
      description: 'Media móvil propia del jugador/a.',
    },
    {
      key: 'z_score',
      header: 'z_score',
      type: 'decimal',
      decimals: 2,
      description: 'Desvío contra la media propia (z-score).',
    },
    {
      key: 'submitted_at',
      header: 'cargado',
      type: 'datetime',
      description: 'Cuándo lo cargó (hora del club).',
    },
  ],
  query: `select x.player_id, p.last_name, p.first_name, x.local_date::text as local_date,
       x.item_count, x.sleep, x.fatigue, x.soreness, x.stress, x.mood, d.mean_score,
       d.baseline_mean_score, d.z_score, x.submitted_at
  from wellness x
  cross join args a
  ${PLAYER_JOIN}
  left join player_wellness_daily d
    on d.club_id = x.club_id and d.player_id = x.player_id and d.local_date = x.local_date
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.local_date')}
 order by x.local_date, p.last_name, p.first_name, x.player_id`,
};

const participations: DatasetDefinition = {
  columns: [
    { key: 'session_id', header: 'sesion_id', type: 'code', description: 'Id de la sesión.' },
    { key: 'local_date', header: 'fecha', type: 'date', description: 'Día del club de la sesión.' },
    { key: 'starts_at', header: 'inicio', type: 'datetime', description: 'Hora de inicio.' },
    {
      key: 'session_kind',
      header: 'tipo',
      type: 'code',
      description: '`training` o `match`.',
    },
    { key: 'category', header: 'categoria', type: 'text', description: 'Categoría.' },
    { key: 'title', header: 'titulo', type: 'text', description: 'Título de la sesión.' },
    { key: 'opponent', header: 'rival', type: 'text', description: 'Rival (partidos).' },
    {
      key: 'session_archived',
      header: 'sesion_archivada',
      type: 'boolean',
      description: 'Si la sesión se canceló o se archivó.',
    },
    ...PLAYER_COLUMNS,
    {
      key: 'status',
      header: 'estado',
      type: 'code',
      description: 'Participación (`full`, `partial`, `absent`, `unavailable`…). Nunca el motivo.',
    },
    { key: 'minutes', header: 'minutos', type: 'integer', unit: 'min', description: 'Minutos.' },
    { key: 'rpe', header: 'rpe', type: 'integer', unit: 'score', description: 'RPE CR-10.' },
    {
      key: 'srpe_au',
      header: 'srpe_ua',
      type: 'integer',
      unit: 'au',
      description: 'Carga de la sesión: RPE × minutos.',
    },
    {
      key: 'contacts_n',
      header: 'contactos',
      type: 'integer',
      unit: 'n',
      description: 'Contactos.',
    },
    {
      key: 'rpe_reported_at',
      header: 'rpe_cargado',
      type: 'datetime',
      description: 'Cuándo se cargó el RPE.',
    },
  ],
  query: `select s.id as session_id, s.local_date::text as local_date, s.starts_at,
       s.kind::text as session_kind, c.name as category, s.title, s.opponent,
       s.archived_at is not null as session_archived, x.player_id, p.last_name, p.first_name,
       x.status::text as status, x.minutes, x.rpe, x.srpe_au, x.contacts_n, x.rpe_reported_at
  from participation x
  cross join args a
  ${PLAYER_JOIN}
  join training_session s on s.club_id = x.club_id and s.id = x.training_session_id
  left join category c on c.club_id = s.club_id and c.id = s.category_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('s.local_date')}
 order by s.local_date, s.starts_at, s.id, p.last_name, p.first_name, x.player_id`,
};

const externalLoads: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    {
      key: 'local_date',
      header: 'fecha',
      type: 'date',
      description: 'Día del club de la actividad.',
    },
    {
      key: 'activity',
      header: 'actividad',
      type: 'code',
      description:
        'Tipo (`physical_education`, `other_sport`, `own_training`, `other`). Informada por el jugador.',
    },
    { key: 'detail', header: 'detalle', type: 'text', description: 'Qué fue, según el jugador.' },
    { key: 'minutes', header: 'minutos', type: 'integer', unit: 'min', description: 'Minutos.' },
    { key: 'rpe', header: 'rpe', type: 'integer', unit: 'score', description: 'RPE CR-10.' },
    {
      key: 'srpe_au',
      header: 'srpe_ua',
      type: 'integer',
      unit: 'au',
      description: 'Carga de la actividad: RPE × minutos.',
    },
    {
      key: 'archived',
      header: 'archivada',
      type: 'boolean',
      description: 'Si el jugador la archivó (cargada por error): no suma a la carga.',
    },
    {
      key: 'created_at',
      header: 'informada',
      type: 'datetime',
      description: 'Cuándo la informó el jugador.',
    },
  ],
  query: `select x.player_id, p.last_name, p.first_name, x.local_date::text as local_date,
       x.activity::text as activity, x.detail, x.minutes, x.rpe, x.srpe_au,
       x.archived_at is not null as archived, x.created_at
  from external_load x
  cross join args a
  ${PLAYER_JOIN}
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.local_date')}
 order by x.local_date, p.last_name, p.first_name, x.player_id, x.created_at, x.id`,
};

const loadDaily: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    { key: 'local_date', header: 'fecha', type: 'date', description: 'Día del club.' },
    {
      key: 'load_au',
      header: 'carga_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description:
        'sRPE del día (suma de RPE × minutos): sesiones del club más la carga externa informada por el jugador.',
    },
    {
      key: 'external_load_au',
      header: 'carga_externa_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description: 'Parte de `carga_ua` informada por el jugador fuera del club.',
    },
    {
      key: 'external_n',
      header: 'actividades_externas',
      type: 'integer',
      unit: 'n',
      description: 'Actividades fuera del club informadas ese día.',
    },
    {
      key: 'has_data',
      header: 'con_datos',
      type: 'boolean',
      description: 'Si el día tuvo carga registrada (los días sin dato cuentan como 0).',
    },
    {
      key: 'sessions_n',
      header: 'sesiones_con_rpe',
      type: 'integer',
      unit: 'n',
      description: 'Sesiones del día con RPE.',
    },
    {
      key: 'pending_rpe_n',
      header: 'sesiones_sin_rpe',
      type: 'integer',
      unit: 'n',
      description: 'Sesiones del día con minutos y sin RPE todavía (no cuentan).',
    },
    {
      key: 'history_days',
      header: 'dias_historia',
      type: 'integer',
      description: 'Días de historia hasta ese día.',
    },
    {
      key: 'acute_ewma_au',
      header: 'ewma_aguda_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description: 'EWMA aguda (N = 7 por defecto).',
    },
    {
      key: 'chronic_ewma_au',
      header: 'ewma_cronica_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description: 'EWMA crónica (N = 28 por defecto).',
    },
    {
      key: 'acwr',
      header: 'acwr',
      type: 'decimal',
      decimals: 3,
      description: 'EWMA aguda / crónica; vacío si el estado no es `ok`.',
    },
    {
      key: 'acwr_status',
      header: 'acwr_estado',
      type: 'code',
      description: 'Estado del ACWR (`ok`, `insufficient_history`…).',
    },
    {
      key: 'window_load_au',
      header: 'carga_semana_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description: 'Carga de la ventana de monotonía (7 días por defecto).',
    },
    {
      key: 'monotony',
      header: 'monotonia',
      type: 'decimal',
      decimals: 3,
      description: 'Monotonía (Foster): media diaria / desvío.',
    },
    {
      key: 'strain_au',
      header: 'strain_ua',
      type: 'decimal',
      decimals: 2,
      unit: 'au',
      description: 'Strain: carga semanal × monotonía.',
    },
    {
      key: 'monotony_status',
      header: 'monotonia_estado',
      type: 'code',
      description: 'Estado de la monotonía.',
    },
  ],
  query: `select x.player_id, p.last_name, p.first_name, x.local_date::text as local_date,
       x.load_au, x.external_load_au, x.external_n, x.has_data, x.sessions_n, x.pending_rpe_n, x.history_days, x.acute_ewma_au,
       x.chronic_ewma_au, x.acwr, x.acwr_status::text as acwr_status, x.window_load_au,
       x.monotony, x.strain_au, x.monotony_status::text as monotony_status
  from player_load_daily x
  cross join args a
  ${PLAYER_JOIN}
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.local_date')}
 order by p.last_name, p.first_name, x.player_id, x.local_date`,
};

const fieldMetrics: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    { key: 'local_date', header: 'fecha', type: 'date', description: 'Día del club.' },
    { key: 'session_id', header: 'sesion_id', type: 'code', description: 'Id de la sesión.' },
    { key: 'drill', header: 'bloque', type: 'text', description: 'Bloque de la sesión, si hay.' },
    {
      key: 'metric_code',
      header: 'metrica',
      type: 'code',
      description:
        'Código canónico (`dist_m`, `hsr_abs_m`, `accel_load_au`…); ver `metricas.csv` para los alias de Catapult.',
    },
    { key: 'value', header: 'valor', type: 'decimal', description: 'Valor.' },
    { key: 'unit', header: 'unidad', type: 'code', description: 'Unidad del valor.' },
    {
      key: 'source',
      header: 'fuente',
      type: 'code',
      description: 'De dónde viene (`catapult`, `pod`, `hr_band`, `manual`).',
    },
    { key: 'device', header: 'equipo', type: 'text', description: 'Equipo, si hubo.' },
    {
      key: 'external_ref',
      header: 'referencia_externa',
      type: 'text',
      description: 'Fila de origen (actividad y período de OpenField).',
    },
  ],
  query: `select x.player_id, p.last_name, p.first_name, x.local_date::text as local_date,
       x.training_session_id as session_id, dr.name as drill, md.code as metric_code, x.value,
       x.unit::text as unit, x.source::text as source, d.label as device, x.external_ref
  from external_metric x
  cross join args a
  ${PLAYER_JOIN}
  join metric_definition md on md.club_id = x.club_id and md.id = x.metric_definition_id
  left join drill dr on dr.club_id = x.club_id and dr.id = x.drill_id
  left join device d on d.club_id = x.club_id and d.id = x.device_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and ${inRange('x.local_date')}
 order by x.local_date, p.last_name, p.first_name, x.player_id, md.code, x.id`,
};

const gymSets: DatasetDefinition = {
  columns: [
    ...PLAYER_COLUMNS,
    { key: 'performed_on', header: 'fecha', type: 'date', description: 'Día de la serie.' },
    { key: 'program', header: 'programa', type: 'text', description: 'Programa, si hay.' },
    {
      key: 'exercise_code',
      header: 'ejercicio',
      type: 'code',
      description: 'Código del ejercicio (`goblet_squat`).',
    },
    {
      key: 'load_kind',
      header: 'tipo_de_carga',
      type: 'code',
      description:
        'Cómo se cuenta la carga: `external` (kg de la carga), `bodyweight` (peso corporal o palo) o `bodyweight_plus` (kg de lastre).',
    },
    { key: 'set_number', header: 'serie', type: 'integer', description: 'Número de serie.' },
    {
      key: 'reps',
      header: 'repeticiones',
      type: 'integer',
      unit: 'n',
      description: 'Repeticiones.',
    },
    {
      key: 'load_kg',
      header: 'carga_kg',
      type: 'decimal',
      decimals: 2,
      unit: 'kg',
      description: 'Carga (los kg de lastre en `bodyweight_plus`).',
    },
    {
      key: 'rir',
      header: 'rir',
      type: 'integer',
      description: 'Repeticiones en reserva (nunca al fallo).',
    },
    {
      key: 'technique_score',
      header: 'nota_tecnica',
      type: 'integer',
      unit: 'score',
      description: 'Nota técnica 1–3 (M13/M14).',
    },
    {
      key: 'duration_s',
      header: 'duracion_s',
      type: 'integer',
      unit: 's',
      description: 'Duración.',
    },
    { key: 'notes', header: 'notas', type: 'text', description: 'Notas.' },
  ],
  query: `select x.player_id, p.last_name, p.first_name, x.performed_on::text as performed_on,
       g.name as program, x.exercise_code, x.load_kind::text as load_kind, x.set_number, x.reps,
       x.load_kg, x.rir,
       x.technique_score, x.duration_s, x.notes
  from gym_set x
  cross join args a
  ${PLAYER_JOIN}
  left join gym_program g on g.club_id = x.club_id and g.id = x.gym_program_id
 where x.club_id = app.current_club_id() and x.player_id = any (a.players)
   and x.voided_at is null
   and ${inRange('x.performed_on')}
 order by x.performed_on, p.last_name, p.first_name, x.player_id, x.exercise_code, x.set_number,
          x.id`,
};

const metrics: DatasetDefinition = {
  columns: [
    { key: 'code', header: 'codigo', type: 'code', description: 'Código canónico de la métrica.' },
    { key: 'unit', header: 'unidad', type: 'code', description: 'Unidad.' },
    {
      key: 'source',
      header: 'fuente',
      type: 'code',
      description: 'De dónde sale (test, cancha, bienestar…).',
    },
    {
      key: 'direction',
      header: 'sentido',
      type: 'code',
      description: 'Si más alto es mejor o peor.',
    },
    { key: 'test_code', header: 'test', type: 'code', description: 'Test que la produce.' },
    {
      key: 'sports',
      header: 'deportes',
      type: 'list',
      description: 'Deportes donde aplica; vacío = todos.',
    },
    { key: 'description', header: 'definicion', type: 'text', description: 'Definición.' },
    {
      key: 'catapult_aliases',
      header: 'alias_catapult',
      type: 'list',
      description: 'Columnas de OpenField que se importan como esta métrica.',
    },
    {
      key: 'is_canonical',
      header: 'canonica',
      type: 'boolean',
      description: 'Si es del diccionario común con la primera.',
    },
    {
      key: 'archived',
      header: 'archivada',
      type: 'boolean',
      description: 'Si el club la dejó de usar.',
    },
  ],
  query: `select x.code, x.unit::text as unit, x.source::text as source,
       x.direction::text as direction, x.test_code, x.sports::text[] as sports, x.description,
       x.catapult_aliases, x.is_canonical, x.archived_at is not null as archived
  from metric_definition x
  cross join args a
 where x.club_id = app.current_club_id()
 order by x.code`,
};

export const DATASETS: Readonly<Record<ClubDataExportDataset, DatasetDefinition>> = {
  players,
  player_categories: playerCategories,
  anthropometry,
  test_results: testResults,
  wellness,
  participations,
  external_loads: externalLoads,
  load_daily: loadDaily,
  field_metrics: fieldMetrics,
  gym_sets: gymSets,
  metrics,
};
