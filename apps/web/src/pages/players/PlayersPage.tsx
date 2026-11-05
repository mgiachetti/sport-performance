import { decimalAgeYears, localDateInTimeZone } from '@sport-performance/domain';
import { formatLocalDate, formatNumber } from '@sport-performance/i18n';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useScope } from '../../club/use-scope';
import { useT } from '../../i18n/i18n';
import { initialsOf } from '../../lib/initials';
import { positionName } from '../../lib/positions';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  Page,
  TextField,
} from '../../ui/components';
import { playersQuery, positionsQuery } from './queries';
import './players.css';

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
  const positions = useQuery(positionsQuery(api, active.selection));
  const players = query.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryName = new Map(active.categories.map((c) => [c.id, c.name]));
  const positionById = new Map((positions.data ?? []).map((p) => [p.id, p]));
  const today = localDateInTimeZone(new Date(), active.club.timeZone);

  return (
    <Page title={t('players.title')} subtitle={t('players.subtitle')}>
      <Card
        className="sp-players"
        title={t('players.table.title')}
        subtitle={
          query.isPending || query.error !== null ? undefined : (
            <span role="status">
              {/* While more pages remain, the count is what is shown, not the roster size. */}
              {t(query.hasNextPage ? 'players.countShown' : 'players.count', {
                count: players.length,
              })}
            </span>
          )
        }
        actions={
          <div className="sp-players__search">
            <TextField
              label={t('players.search')}
              hideLabel
              placeholder={t('players.search')}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              autoComplete="off"
            />
          </div>
        }
      >
        {query.isPending ? (
          <Loading />
        ) : query.error !== null ? (
          <ErrorNotice error={query.error} />
        ) : players.length === 0 ? (
          <EmptyState icon="players" title={t('players.empty')} />
        ) : (
          <>
            <div className="sp-table-wrap">
              <table className="sp-table sp-players__table">
                <thead>
                  <tr>
                    <th scope="col">{t('players.table.name')}</th>
                    <th scope="col">{t('players.table.category')}</th>
                    <th scope="col" className="sp-players__optional">
                      {t('players.table.position')}
                    </th>
                    <th scope="col" className="sp-table__number">
                      {t('players.table.age')}
                    </th>
                    <th scope="col" className="sp-table__number sp-players__optional">
                      {t('players.table.birthDate')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => {
                    const firstPosition = player.positionIds[0];
                    const position =
                      firstPosition === undefined ? undefined : positionById.get(firstPosition);
                    return (
                      <tr key={player.id}>
                        <th scope="row">
                          <span className="sp-table__cell-player">
                            <Avatar label={initialsOf(`${player.firstName} ${player.lastName}`)} />
                            <Link
                              to="/players/$playerId"
                              params={{ playerId: player.id }}
                              className="sp-table__link"
                            >
                              {player.lastName}, {player.firstName}
                            </Link>
                          </span>
                        </th>
                        <td>
                          {player.currentCategoryIds
                            .map((id) => categoryName.get(id))
                            .filter((name): name is string => name !== undefined)
                            .join(', ') || formatNumber(null)}
                        </td>
                        <td className="sp-players__optional">
                          {position === undefined ? formatNumber(null) : positionName(t, position)}
                        </td>
                        <td className="sp-table__number">
                          {t('players.table.ageValue', {
                            age: formatNumber(decimalAgeYears(player.birthDate, today), {
                              decimals: 1,
                            }),
                          })}
                        </td>
                        <td className="sp-table__number sp-players__optional">
                          {formatLocalDate(player.birthDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {query.hasNextPage ? (
              <div className="sp-players__more">
                <Button
                  variant="secondary"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {t('players.more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </Page>
  );
}
