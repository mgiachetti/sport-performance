import { formatDate } from '@sport-performance/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, Page, TextField } from '../ui/components';
import { Icon } from '../ui/icons';
import { useConsole } from './ConsoleLayout';
import { consoleClubsQuery } from './queries';

/** Registry of clubs (B-414): search by name or slug, and the way to onboard a new one. */
export function ConsoleClubsPage() {
  const t = useT();
  const { api, reason } = useConsole();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const clubs = useInfiniteQuery(consoleClubsQuery(api, reason, search));
  const items = clubs.data?.pages.flatMap((page) => page.items) ?? [];

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(q.trim());
  };

  return (
    <Page
      title={t('console.clubs.title')}
      subtitle={t('console.clubs.subtitle')}
      actions={
        <Link to="/console/clubs/new" className="sp-button sp-button--primary">
          {t('console.clubs.new')}
        </Link>
      }
    >
      <form className="sp-filters" role="search" onSubmit={submit}>
        <TextField
          label={t('console.clubs.search.label')}
          name="q"
          type="search"
          maxLength={120}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary">
          {t('common.search')}
        </Button>
      </form>
      {clubs.isPending ? <Loading /> : null}
      {clubs.isError ? (
        <ErrorNotice
          error={clubs.error}
          action={
            <Button variant="secondary" onClick={() => void clubs.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}
      {clubs.isSuccess && items.length === 0 ? (
        <Notice level="info" role="status">
          <p>{t('console.clubs.empty')}</p>
        </Notice>
      ) : null}
      {items.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('console.clubs.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('console.clubs.column.name')}</th>
                <th scope="col">{t('console.clubs.column.shortName')}</th>
                <th scope="col">{t('console.clubs.column.slug')}</th>
                <th scope="col">{t('console.clubs.column.timeZone')}</th>
                <th scope="col">{t('console.clubs.column.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((club) => (
                <tr key={club.id}>
                  <th scope="row">
                    <Link to="/console/clubs/$clubId" params={{ clubId: club.id }}>
                      {club.name}
                    </Link>
                  </th>
                  <td>{club.shortName}</td>
                  <td>
                    <code className="sp-table__code">{club.slug}</code>
                  </td>
                  <td>{club.timeZone}</td>
                  <td className="sp-table__number">
                    {formatDate(new Date(club.createdAt), { timeZone: club.timeZone })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clubs.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={clubs.isFetchingNextPage}
          onClick={() => void clubs.fetchNextPage()}
        >
          <Icon name="sync" />
          <span>{t('console.loadMore')}</span>
        </Button>
      ) : null}
    </Page>
  );
}
