import { formatDateTime } from '@sport-performance/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, Page, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { Icon } from '../ui/icons';
import { categoryName, sessionName } from './labels';
import { manageableCategories } from './permissions';
import { trainingSessionsQuery, type SessionListFilters } from './queries';
import type { SessionsSearch } from './search';

const route = getRouteApi('/_authed/_club/sessions/');

/**
 * Sessions and matches of the categories the staff sees (B-407), newest
 * first, filtered by the layout's sport and category and by kind, club days
 * and archive status (kept in the URL). Cursor pages with "Ver más".
 */
export function SessionsPage() {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const invalidRange =
    search.from !== undefined && search.to !== undefined && search.from > search.to;

  const filters: SessionListFilters = {
    ...(scope.category === null ? {} : { categoryId: scope.category.id }),
    ...(scope.category === null && scope.sport !== null ? { sport: scope.sport } : {}),
    ...(search.kind === undefined ? {} : { kind: search.kind }),
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
    status: search.archived === true ? 'archived' : 'active',
  };
  const sessions = useInfiniteQuery({
    ...trainingSessionsQuery(api, selection.get(), filters),
    enabled: !invalidRange,
  });
  const canCreate = manageableCategories(active).length > 0;

  const setFilter = (next: Partial<SessionsSearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...next }) });
  };

  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const timeZone = active.club.timeZone;

  return (
    <Page
      title={t('training.list.title')}
      subtitle={t('training.list.subtitle')}
      actions={
        canCreate ? (
          <Link to="/sessions/new" className="sp-button sp-button--primary">
            <Icon name="plus" />
            <span>{t('training.list.new')}</span>
          </Link>
        ) : undefined
      }
    >
      <fieldset className="sp-filters">
        <legend className="sp-visually-hidden">{t('training.filter.label')}</legend>
        <SelectField
          label={t('training.filter.kind')}
          value={search.kind ?? ''}
          options={[
            { value: '', label: t('training.filter.kindAll') },
            { value: 'training', label: t('training.filter.kindTraining') },
            { value: 'match', label: t('training.filter.kindMatch') },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setFilter({ kind: value === 'training' || value === 'match' ? value : undefined });
          }}
        />
        <TextField
          label={t('training.filter.from')}
          type="date"
          value={search.from ?? ''}
          onChange={(event) => {
            setFilter({ from: (event.target.value || undefined) as SessionsSearch['from'] });
          }}
        />
        <TextField
          label={t('training.filter.to')}
          type="date"
          value={search.to ?? ''}
          error={invalidRange ? t('training.filter.invalidRange') : null}
          onChange={(event) => {
            setFilter({ to: (event.target.value || undefined) as SessionsSearch['to'] });
          }}
        />
        <SelectField
          label={t('training.filter.status')}
          value={search.archived === true ? 'archived' : 'active'}
          options={[
            { value: 'active', label: t('training.filter.statusActive') },
            { value: 'archived', label: t('training.filter.statusArchived') },
          ]}
          onChange={(event) => {
            setFilter({ archived: event.target.value === 'archived' ? true : undefined });
          }}
        />
      </fieldset>

      {sessions.isPending && !invalidRange ? <Loading /> : null}
      {sessions.isError ? <ErrorNotice error={sessions.error} /> : null}
      {sessions.isSuccess && items.length === 0 ? (
        <Notice level="info" role="status">
          <p>{t('training.list.empty')}</p>
        </Notice>
      ) : null}
      {items.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('training.list.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('training.list.when')}</th>
                <th scope="col">{t('training.list.session')}</th>
                <th scope="col">{t('training.list.kind')}</th>
                <th scope="col">{t('training.list.category')}</th>
                <th scope="col" className="sp-table__number">
                  {t('training.list.duration')}
                </th>
                <th scope="col">{t('training.list.state')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((session) => (
                <tr key={session.id}>
                  <td className="sp-table__number">
                    {formatDateTime(new Date(session.startsAt), { timeZone })}
                  </td>
                  <th scope="row">
                    <Link
                      to="/sessions/$trainingSessionId"
                      params={{ trainingSessionId: session.id }}
                    >
                      {sessionName(session, active.categories, t)}
                    </Link>
                  </th>
                  <td>{t(`training.kind.${session.kind}`)}</td>
                  <td>{categoryName(active.categories, session.categoryId, t)}</td>
                  <td className="sp-table__number">
                    {session.plannedDurationMin === null
                      ? t('common.noData')
                      : t('training.session.minutes', { minutes: session.plannedDurationMin })}
                  </td>
                  <td>
                    {session.archivedAt === null ? (
                      <StatusLabel level="ok">{t('training.list.active')}</StatusLabel>
                    ) : (
                      <StatusLabel level="info">{t('training.session.archived')}</StatusLabel>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sessions.hasNextPage ? (
        <div className="sp-form__secondary">
          <Button
            variant="secondary"
            disabled={sessions.isFetchingNextPage}
            onClick={() => void sessions.fetchNextPage()}
          >
            {sessions.isFetchingNextPage ? t('common.loading') : t('training.list.more')}
          </Button>
        </div>
      ) : null}
    </Page>
  );
}
