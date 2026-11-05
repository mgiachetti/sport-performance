import { formatLocalDate } from '@sport-performance/i18n';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { Button, Card, EmptyState, ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { SelectField } from '../ui/fields';
import './field-sessions.css';
import { metricLabel, sessionTitle, sourcesLabel } from './labels';
import { clubModulesQuery, fieldSessionsQuery } from './queries';

const route = getRouteApi('/_authed/_club/field-sessions/');

/**
 * Sessions and matches with field data (B-408): newest first, in the scope
 * of the layout (sport, category) and by kind. Each row opens the session
 * view. The data arrives with the Catapult import (B-601) and later with the
 * bands and pods; the screen never computes it.
 */
export function FieldSessionsPage() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const filters = {
    sport: scope.sport,
    categoryId: scope.category?.id ?? null,
    kind: search.kind ?? null,
  };
  const sessions = useInfiniteQuery(fieldSessionsQuery(api, active.selection, filters));
  const modules = useQuery(clubModulesQuery(api, active.selection));
  const categoryName = new Map(active.categories.map((c) => [c.id, c.name]));
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  // A sport fixed by the layout (the only one the user sees) is not a filter the user chose.
  const filtered =
    filters.categoryId !== null || filters.kind !== null || search.sport !== undefined;

  return (
    <Page title={t('fieldSession.list.title')} subtitle={t('fieldSession.list.subtitle')}>
      {modules.data?.modules.gps === false ? (
        <Notice level="info">
          <p>{t('fieldSession.module.off')}</p>
        </Notice>
      ) : null}
      <div className="sp-toolbar">
        <SelectField
          label={t('fieldSession.list.kindFilter')}
          value={search.kind ?? ''}
          options={[
            { value: '', label: t('fieldSession.list.kindAll') },
            { value: 'training', label: t('fieldSession.kind.training') },
            { value: 'match', label: t('fieldSession.kind.match') },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            void navigate({
              search: (prev) => ({
                ...prev,
                kind: value === 'training' || value === 'match' ? value : undefined,
              }),
            });
          }}
        />
      </div>
      {sessions.isPending ? <Loading /> : null}
      {sessions.isError ? <ErrorNotice error={sessions.error} /> : null}
      {sessions.isSuccess && items.length === 0 ? (
        <Card>
          <EmptyState
            role="status"
            icon="field"
            title={filtered ? t('fieldSession.list.emptyFiltered') : t('fieldSession.list.empty')}
          />
        </Card>
      ) : null}
      {items.length > 0 ? (
        <Card variant="flush">
          <div className="sp-table-wrap">
            <table className="sp-table">
              <caption className="sp-visually-hidden">{t('fieldSession.list.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('fieldSession.list.date')}</th>
                  <th scope="col">{t('fieldSession.list.session')}</th>
                  <th scope="col">{t('fieldSession.list.category')}</th>
                  <th scope="col" className="sp-table__number">
                    {t('fieldSession.list.players')}
                  </th>
                  <th scope="col">{t('fieldSession.list.sources')}</th>
                  <th scope="col">{t('fieldSession.list.metrics')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const title = sessionTitle(t, item.session);
                  return (
                    <tr key={item.session.id}>
                      <td className="is-date">{formatLocalDate(item.session.localDate)}</td>
                      <th scope="row">
                        <Link
                          to="/field-sessions/$trainingSessionId"
                          params={{ trainingSessionId: item.session.id }}
                          aria-label={t('fieldSession.list.open', { session: title })}
                        >
                          {title}
                        </Link>
                        <span className="sp-table__meta">
                          {t(`fieldSession.kind.${item.session.kind}`)}
                        </span>
                      </th>
                      <td>
                        {item.session.categoryId === null
                          ? '—'
                          : (categoryName.get(item.session.categoryId) ?? '—')}
                      </td>
                      <td className="sp-table__number">{item.playersN}</td>
                      <td>{sourcesLabel(t, item.sources)}</td>
                      <td title={item.metricCodes.map((code) => metricLabel(t, code)).join(', ')}>
                        {t('fieldSession.list.metricsCount', { count: item.metricCodes.length })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sessions.hasNextPage ? (
            <div className="sp-card__footer">
              <Button
                variant="secondary"
                disabled={sessions.isFetchingNextPage}
                onClick={() => {
                  void sessions.fetchNextPage();
                }}
              >
                {t('fieldSession.list.loadMore')}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </Page>
  );
}
