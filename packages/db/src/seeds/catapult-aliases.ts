import type { CanonicalMetricCode } from '@sport-performance/domain';

/**
 * Default `metric_definition.catapult_aliases` (CLAUDE.md, "Equivalencia con
 * Catapult"): column names of Catapult OpenField CSV exports that map to each
 * canonical field metric. The importer (B-601) matches a column against the
 * aliases case-insensitively and ignoring surrounding whitespace; a club adds
 * the names of its own first-team export (custom parameters, renamed columns)
 * by editing the metric (B-322).
 *
 * The unit of an OpenField column depends on the export settings (velocity in
 * m/s or km/h, duration as `hh:mm:ss`): the importer converts to the
 * metric's unit, the alias only says which metric the column is.
 *
 * Only data lives here; the codes themselves come from `CANONICAL_METRICS`.
 * The trademark appears as an alias ("Total Player Load", the name of the
 * column in the export) but never as a code: the canonical code is
 * `accel_load_au`.
 */
export const DEFAULT_CATAPULT_ALIASES = {
  dist_m: ['Total Distance', 'Distance'],
  dist_m_min: ['Meterage Per Minute', 'Distance Per Min', 'Metres Per Minute'],
  hsr_abs_m: ['HSR Distance', 'High Speed Running Distance', 'High Speed Distance'],
  vmax_ms: ['Maximum Velocity', 'Max Velocity', 'Max Vel'],
  vmax_pct: ['Max Vel (% Max)', 'Percentage Max Velocity', '% Max Velocity'],
  acc_n: ['Acceleration B3 Efforts (Gen 2)', 'Acceleration B3 Efforts', 'Accelerations'],
  dec_n: ['Deceleration B3 Efforts (Gen 2)', 'Deceleration B3 Efforts', 'Decelerations'],
  accel_load_au: ['Total Player Load', 'Player Load'],
  contacts_n: ['Contact Involvements', 'Total Contacts', 'Contacts'],
  scrums_n: ['Scrum Count', 'Scrums'],
  kicks_n: ['Kick Count', 'Kicks'],
  time_to_feet_s: ['Time to Feet', 'Back in Game'],
  hr_avg: ['Avg Heart Rate', 'Average Heart Rate', 'Mean Heart Rate'],
  hr_max: ['Max Heart Rate', 'Maximum Heart Rate'],
  trimp: ['TRIMP', 'Banister TRIMP'],
  session_duration_min: ['Total Duration', 'Duration'],
} as const satisfies Partial<Readonly<Record<CanonicalMetricCode, readonly string[]>>>;

/** Normal form used to compare aliases: trimmed, single spaces, lower case. */
export function normalizeCatapultAlias(alias: string): string {
  return alias.trim().replace(/\s+/g, ' ').toLowerCase();
}
