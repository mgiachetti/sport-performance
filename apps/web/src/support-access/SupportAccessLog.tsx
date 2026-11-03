import type { Page as ApiPage, SupportAccessEntry } from '@sport-performance/contracts';
import {
  dayBoundsInTimeZone,
  isLocalDate,
  parseLocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { formatDateTime } from '@sport-performance/i18n';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { Icon } from '../ui/icons';

/**
 * The support access log as a table (B-414, ADR 0066): who, when, where and
 * why, newest first, with "Cargar más" over the cursor. Shared by the
 * console (every club) and the club's administration (its own club).
 */

export interface PeriodFilter {
  /** First instant (inclusive), ISO. */
  readonly from?: string | undefined;
  /** Last instant (exclusive), ISO. */
  readonly to?: string | undefined;
}

/**
 * The days `from` and `to` (both inclusive, `YYYY-MM-DD`) of the club's time
 * zone as the API's half-open period; `null` when `from` is after `to`.
 */
export function periodOf(
  days: { from: string; to: string },
  timeZone: TimeZone,
): PeriodFilter | null {
  const from = isLocalDate(days.from) ? parseLocalDate(days.from) : null;
  const to = isLocalDate(days.to) ? parseLocalDate(days.to) : null;
  if (from !== null && to !== null && from > to) return null;
  return {
    ...(from === null ? {} : { from: dayBoundsInTimeZone(from, timeZone).start.toISOString() }),
    ...(to === null ? {} : { to: dayBoundsInTimeZone(to, timeZone).end.toISOString() }),
  };
}

export function PeriodFilterForm(props: {
  timeZone: TimeZone;
  onApply: (period: PeriodFilter) => void;
}) {
  const t = useT();
  const [days, setDays] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const apply = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const period = periodOf(days, props.timeZone);
    if (period === null) {
      setError(t('supportAccess.filter.invalid'));
      return;
    }
    setError(null);
    props.onApply(period);
  };
  return (
    <form className="sp-filters" onSubmit={apply} noValidate>
      <TextField
        label={t('supportAccess.filter.from')}
        type="date"
        name="from"
        value={days.from}
        onChange={(event) => {
          setDays({ ...days, from: event.target.value });
        }}
      />
      <TextField
        label={t('supportAccess.filter.to')}
        type="date"
        name="to"
        value={days.to}
        error={error}
        onChange={(event) => {
          setDays({ ...days, to: event.target.value });
        }}
      />
      <Button type="submit" variant="secondary">
        {t('supportAccess.filter.apply')}
      </Button>
      <p className="sp-field__help sp-filters__note">
        {t('supportAccess.filter.timeZone', { timeZone: props.timeZone })}
      </p>
    </form>
  );
}

/** The operator's name, or their email when the account has none. */
function displayName(name: string | null, email: string): string {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' ? email : trimmed;
}

export function SupportAccessLog(props: {
  query: UseInfiniteQueryResult<InfiniteData<ApiPage<SupportAccessEntry>>>;
  /** Show where each access happened (the console: every club and the registry). */
  showClub: boolean;
  /** Zone of the entries without a club (the registry). */
  timeZone: TimeZone;
}) {
  const t = useT();
  const { query } = props;
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isPending) return <Loading />;
  if (query.isError && entries.length === 0) {
    return (
      <ErrorNotice
        error={query.error}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }
  if (entries.length === 0) {
    return (
      <Notice level="info" role="status">
        <p>{t('supportAccess.empty')}</p>
      </Notice>
    );
  }
  return (
    <>
      <div className="sp-table-wrap">
        <table className="sp-table">
          <caption className="sp-visually-hidden">{t('supportAccess.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('supportAccess.column.when')}</th>
              <th scope="col">{t('supportAccess.column.operator')}</th>
              {props.showClub ? <th scope="col">{t('supportAccess.column.club')}</th> : null}
              <th scope="col">{t('supportAccess.column.reason')}</th>
              <th scope="col">{t('supportAccess.column.request')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="sp-table__number">
                  <time dateTime={entry.startedAt}>
                    {formatDateTime(new Date(entry.startedAt), {
                      timeZone: entry.club?.timeZone ?? props.timeZone,
                    })}
                  </time>
                </td>
                <td>
                  {entry.operator.email === null ? (
                    t('supportAccess.deletedAccount')
                  ) : (
                    <>
                      <span>{displayName(entry.operator.name, entry.operator.email)}</span>
                      <span className="sp-table__meta">{entry.operator.email}</span>
                    </>
                  )}
                </td>
                {props.showClub ? <td>{entry.club?.name ?? t('supportAccess.registry')}</td> : null}
                <td>{entry.reason}</td>
                <td>
                  <code className="sp-table__code">{entry.requestId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.isError ? <ErrorNotice error={query.error} /> : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          <Icon name="sync" />
          <span>{t('console.loadMore')}</span>
        </Button>
      ) : null}
    </>
  );
}
