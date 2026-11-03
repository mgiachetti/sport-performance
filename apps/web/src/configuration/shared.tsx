import {
  formatLocalDate,
  isMessageKey,
  parseNumber,
  type Translator,
} from '@sport-performance/i18n';
import {
  isLocalDate,
  localDateInTimeZone,
  type LocalDate,
  type Stage,
} from '@sport-performance/domain';
import { useMemo } from 'react';
import { useActiveClub } from '../club/active-club';
import { translate } from '../i18n/i18n';
import { StatusLabel } from '../ui/fields';

/** Pieces shared by the sections of the configuration screen (B-409). */

type T = Translator['t'];

/** A label from the catalog when there is one, else the code as it is. */
export function labelOrCode(t: T, key: string, code: string): string {
  return isMessageKey(key) ? translate(t, key) : code;
}

export const testLabel = (t: T, code: string) => labelOrCode(t, `test.${code}`, code);
export const metricLabel = (t: T, code: string) =>
  labelOrCode(t, `configuration.metric.${code}`, code);
export const zoneLabel = (t: T, code: string) => labelOrCode(t, `configuration.zone.${code}`, code);
export const stageLabel = (t: T, stage: Stage) => translate(t, `configuration.stage.${stage}`);

/** "Today" in the club's time zone (CLAUDE.md: the day is the club's). */
export function useClubToday(): LocalDate {
  const { club } = useActiveClub();
  return useMemo(() => localDateInTimeZone(new Date(), club.timeZone), [club.timeZone]);
}

/** Where a dated row stands on the club's day (ADR 0041). */
export type ValidityPhase = 'planned' | 'current' | 'ended';

export function validityPhase(
  row: { readonly validFrom: string; readonly validTo: string | null },
  today: LocalDate,
): ValidityPhase {
  // ISO calendar dates order as text.
  if (row.validFrom > today) return 'planned';
  if (row.validTo !== null && row.validTo <= today) return 'ended';
  return 'current';
}

export function validityText(
  t: T,
  row: { readonly validFrom: string; readonly validTo: string | null },
): string {
  const from = formatLocalDate(row.validFrom as LocalDate);
  return row.validTo === null
    ? t('configuration.validity.from', { from })
    : t('configuration.validity.range', { from, to: formatLocalDate(row.validTo as LocalDate) });
}

export function PhaseLabel(props: { phase: ValidityPhase | 'archived'; t: T }) {
  const level = props.phase === 'current' ? 'ok' : props.phase === 'planned' ? 'info' : 'warning';
  return (
    <StatusLabel level={level}>
      {translate(props.t, `configuration.phase.${props.phase}`)}
    </StatusLabel>
  );
}

/** A decimal typed in es-AR (`5,5`): `null` when it is not a number. */
export function parseDecimal(text: string): number | null {
  return parseNumber(text, { allowGrouping: false });
}

/** A whole number typed by the user, or `null`. */
export function parseInteger(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && Number.isInteger(value) ? value : null;
}

/** The date of an `<input type="date">`, or `null`. */
export function parseDateInput(text: string): LocalDate | null {
  return isLocalDate(text) ? text : null;
}

/** A fresh `clientUuid` for one create (ADR 0032): reused by its retries. */
export function newClientUuid(): string {
  return crypto.randomUUID();
}
