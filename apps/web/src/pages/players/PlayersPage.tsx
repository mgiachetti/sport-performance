import { formatLocalDate } from '@sport-performance/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useScope } from '../../club/use-scope';
import { useT } from '../../i18n/i18n';
import { Button, ErrorNotice, Loading, Page, TextField } from '../../ui/components';
import { playersQuery } from './queries';

/**
 * Roster of what the user sees (sport and category of the scope selector),
 * with a search by name: the way into each player's profile. A roster, never
 * a ranking (alphabetical order).
 */
export function PlayersPage() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const query = useInfiniteQuery(
    playersQuery(api, active.selection, {
      sport: scope.sport,
      categoryId: scope.category?.id ?? null,
      q,
    }),
  );
  const players = query.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryName = new Map(active.categories.map((c) => [c.id, c.name]));

  return (
    <Page title={t('players.title')} subtitle={t('players.subtitle')}>
      <TextField
        label={t('players.search')}
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        autoComplete="off"
      />
      {query.isPending ? (
        <Loading />
      ) : query.error !== null ? (
        <ErrorNotice error={query.error} />
      ) : players.length === 0 ? (
        <p>{t('players.empty')}</p>
      ) : (
        <>
          <p className="sp-profile__muted" role="status">
            {t('players.count', { count: players.length })}
          </p>
          <table className="sp-profile__table">
            <thead>
              <tr>
                <th scope="col">{t('players.table.name')}</th>
                <th scope="col">{t('players.table.category')}</th>
                <th scope="col">{t('players.table.birthDate')}</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <th scope="row">
                    <Link to="/players/$playerId" params={{ playerId: player.id }}>
                      {player.lastName}, {player.firstName}
                    </Link>
                  </th>
                  <td>
                    {player.currentCategoryIds
                      .map((id) => categoryName.get(id))
                      .filter((name): name is string => name !== undefined)
                      .join(', ') || '—'}
                  </td>
                  <td>{formatLocalDate(player.birthDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {t('players.more')}
            </Button>
          ) : null}
        </>
      )}
    </Page>
  );
}
