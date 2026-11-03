import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { ErrorNotice, Loading, Notice } from '../ui/components';
import { AdminSection, useClubFormat } from './parts';
import { seasonsQuery } from './queries';

/**
 * Seasons in the administration (B-411): the season change of each active
 * season (B-316). Creating and editing seasons and their windows V1–V4 is
 * the season calendar's (B-406).
 */
export function SeasonsSection() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const scope = useScope();
  const format = useClubFormat();
  const seasons = useQuery(seasonsQuery(api, selection, scope.sport));

  return (
    <AdminSection
      id="admin-seasons"
      title={t('admin.seasons.title')}
      intro={t('admin.seasons.intro')}
    >
      {seasons.isPending ? <Loading /> : null}
      {seasons.isError ? <ErrorNotice error={seasons.error} /> : null}
      {seasons.isSuccess && seasons.data.length === 0 ? (
        <Notice level="info" role="status">
          <p>{t('admin.seasons.empty')}</p>
        </Notice>
      ) : null}
      {seasons.isSuccess && seasons.data.length > 0 ? (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('admin.seasons.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.seasons.name')}</th>
                <th scope="col">{t('scope.sport.label')}</th>
                <th scope="col">{t('admin.seasons.dates')}</th>
                <th scope="col">{t('admin.seasons.windows')}</th>
                <th scope="col">{t('admin.members.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {seasons.data.map((season) => {
                const windows = season.testWindows.filter((w) => w.archivedAt === null);
                return (
                  <tr key={season.id}>
                    <th scope="row">{season.name}</th>
                    <td>{t(`sport.${season.sport}`)}</td>
                    <td>
                      {t('admin.assignments.range', {
                        from: format.date(season.startsOn),
                        to: format.date(season.endsOn),
                      })}
                    </td>
                    <td>
                      {windows.length === 0
                        ? t('admin.seasons.noWindows')
                        : windows.map((w) => w.label).join(' · ')}
                    </td>
                    <td>
                      <Link
                        to="/admin/seasons/$seasonId"
                        params={{ seasonId: season.id }}
                        className="sp-button sp-button--secondary"
                      >
                        {t('admin.rollover.open', { season: season.name })}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminSection>
  );
}
