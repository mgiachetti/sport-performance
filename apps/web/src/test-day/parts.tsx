import type { Season, TestSession } from '@sport-performance/contracts';
import { isMessageKey } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Icon, type IconName } from '../ui/icons';
import { seasonsQuery } from './queries';

/** Small pieces shared by the test day screens (B-405). */

const STATUS_ICONS: Record<TestSession['status'], IconName> = {
  scheduled: 'info',
  in_progress: 'sync',
  completed: 'ok',
  cancelled: 'warning',
};

/** Status of a day: always icon + text. */
export function TestDayStatus(props: { status: TestSession['status'] }) {
  const t = useT();
  return (
    <span className={`sp-td-status sp-td-status--${props.status}`}>
      <Icon name={STATUS_ICONS[props.status]} />
      <span>{t(`testDay.status.${props.status}`)}</span>
    </span>
  );
}

/** `V1`…`V4` of every window of the club's seasons, by window id. */
export function useWindowLabels(): ReadonlyMap<string, string> {
  const { api } = useServices();
  const { selection } = useActiveClub();
  const seasons = useQuery(seasonsQuery(api, selection));
  return useMemo(() => windowLabels(seasons.data ?? []), [seasons.data]);
}

export function windowLabels(seasons: readonly Season[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const season of seasons) {
    for (const window of season.testWindows) labels.set(window.id, window.label);
  }
  return labels;
}

/** Label of a metric or a raw field of a station; unknown club codes show as they are. */
export function fieldLabel(t: ReturnType<typeof useT>, key: string): string {
  const field = `testDay.field.${key}`;
  if (isMessageKey(field)) return translate(t, field);
  const metric = `testDay.metric.${key}`;
  if (isMessageKey(metric)) return translate(t, metric);
  return key;
}

/** Name of a test: the catalog's for canonical tests, the code for the club's own. */
export function testLabel(t: ReturnType<typeof useT>, testCode: string): string {
  const key = `test.${testCode}`;
  return isMessageKey(key) ? translate(t, key) : testCode;
}
