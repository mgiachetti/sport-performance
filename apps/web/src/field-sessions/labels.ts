import type {
  FieldMetricColumn,
  FieldSessionPlayer,
  TrainingSessionSummary,
} from '@sport-performance/contracts';
import type { FieldMetricSource } from '@sport-performance/domain';
import {
  formatLocalDate,
  isMessageKey,
  unitLabelEsAr,
  type Translator,
} from '@sport-performance/i18n';
import { translate } from '../i18n/i18n';

/** Texts of the field session view (`fieldSession.*`, B-408). */

type T = Translator['t'];

/** A metric's name; a club's own metric without a label shows its code. */
export function metricLabel(t: T, metricCode: string): string {
  const key = `fieldSession.metric.${metricCode}`;
  return isMessageKey(key) ? translate(t, key) : metricCode;
}

export function sourceLabel(t: T, source: FieldMetricSource): string {
  return t(`fieldSession.source.${source}`);
}

export function sourcesLabel(t: T, sources: readonly FieldMetricSource[]): string {
  return sources.map((s) => sourceLabel(t, s)).join(', ');
}

/** Header of a metric column: name, unit and, when the metric has several sources, the source. */
export function columnLabel(
  t: T,
  column: Pick<FieldMetricColumn, 'metricCode' | 'source' | 'unit'> & { sharedMetric: boolean },
): string {
  const metric = metricLabel(t, column.metricCode);
  const unit = unitLabelEsAr(column.unit);
  const source = sourceLabel(t, column.source);
  if (unit === '') {
    return column.sharedMetric
      ? t('fieldSession.table.columnNoUnitWithSource', { metric, source })
      : t('fieldSession.table.columnNoUnit', { metric });
  }
  return column.sharedMetric
    ? t('fieldSession.table.columnWithSource', { metric, unit, source })
    : t('fieldSession.table.column', { metric, unit });
}

export function positionLabel(t: T, position: FieldSessionPlayer['position']): string {
  if (position === null) return '—';
  if (position.label !== null) return position.label;
  const key = `fieldSession.position.${position.code}`;
  return isMessageKey(key) ? translate(t, key) : position.code;
}

export function playerName(player: Pick<FieldSessionPlayer, 'firstName' | 'lastName'>): string {
  return `${player.firstName} ${player.lastName}`;
}

/** The session's own title, or "Partido del 24/10/2026". */
export function sessionTitle(
  t: T,
  session: Pick<TrainingSessionSummary, 'title' | 'kind' | 'localDate'>,
): string {
  return (
    session.title ??
    t('fieldSession.untitled', {
      kind: t(`fieldSession.kind.${session.kind}`),
      date: formatLocalDate(session.localDate),
    })
  );
}
