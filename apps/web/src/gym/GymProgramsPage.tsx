import type { GymProgram } from '@sport-performance/contracts';
import { formatLocalDate } from '@sport-performance/i18n';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { clubModulesQuery } from '../field-sessions/queries';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { Icon } from '../ui/icons';
import { canManageProgram, manageableGymCategories } from './model';
import { gymKey, gymProgramsQuery, type GymProgramFilters } from './queries';

/**
 * Gym programs of the categories the staff sees (B-607), by the layout's
 * category: who each one is for (a category, a stage of it, or a player),
 * its days and validity. The S&C staff and the administration create, edit,
 * archive and restore them; the coach reads.
 */
export function GymProgramsPage() {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const filters: GymProgramFilters = {
    ...(scope.category === null ? {} : { categoryId: scope.category.id }),
    status: archived ? 'archived' : 'active',
  };
  const programs = useInfiniteQuery(gymProgramsQuery(api, selection.get(), filters));
  const modules = useQuery(clubModulesQuery(api, active.selection));
  const archive = useMutation({
    mutationFn: (program: GymProgram) =>
      program.archivedAt === null
        ? api.archiveGymProgram({ params: { gymProgramId: program.id } })
        : api.restoreGymProgram({ params: { gymProgramId: program.id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gymKey(selection.get()) }),
  });
  const canCreate = manageableGymCategories(active).length > 0;
  const items = programs.data?.pages.flatMap((page) => page.items) ?? [];

  const target = (program: GymProgram) => {
    const category = active.categories.find((c) => c.id === program.categoryId);
    if (program.playerId !== null) return t('gym.web.target.player');
    const name = category?.name ?? t('gym.web.target.unknownCategory');
    return program.stage === null
      ? name
      : t('gym.web.target.categoryStage', {
          category: name,
          stage: t(`gym.web.stage.${program.stage}`),
        });
  };

  return (
    <Page
      title={t('gym.web.list.title')}
      subtitle={t('gym.web.list.subtitle')}
      actions={
        canCreate ? (
          <Link to="/gym/new" className="sp-button sp-button--primary">
            <Icon name="plus" />
            <span>{t('gym.web.list.new')}</span>
          </Link>
        ) : undefined
      }
    >
      {modules.data?.modules.gym === false ? (
        <Notice level="info">
          <p>{t('gym.web.moduleOff')}</p>
        </Notice>
      ) : null}
      <fieldset className="sp-filters">
        <legend className="sp-visually-hidden">{t('gym.web.filter.label')}</legend>
        <SelectField
          label={t('gym.web.filter.status')}
          value={archived ? 'archived' : 'active'}
          options={[
            { value: 'active', label: t('gym.web.filter.active') },
            { value: 'archived', label: t('gym.web.filter.archived') },
          ]}
          onChange={(event) => {
            setArchived(event.target.value === 'archived');
          }}
        />
      </fieldset>
      {archive.error === null ? null : <ErrorNotice error={archive.error} />}
      {programs.isPending ? (
        <Loading />
      ) : programs.error !== null ? (
        <ErrorNotice error={programs.error} />
      ) : items.length === 0 ? (
        <Notice level="info">
          <p>{t('gym.web.list.empty')}</p>
        </Notice>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('gym.web.list.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('gym.web.col.name')}</th>
                <th scope="col">{t('gym.web.col.target')}</th>
                <th scope="col">{t('gym.web.col.days')}</th>
                <th scope="col">{t('gym.web.col.validity')}</th>
                <th scope="col">{t('gym.web.col.status')}</th>
                <th scope="col">
                  <span className="sp-visually-hidden">{t('gym.web.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((program) => (
                <tr key={program.id}>
                  <td>
                    <Link to="/gym/$gymProgramId" params={{ gymProgramId: program.id }}>
                      {program.name}
                    </Link>
                  </td>
                  <td>{target(program)}</td>
                  <td>{program.plan.days.map((day) => day.name).join(' · ')}</td>
                  <td>
                    {program.validTo === null
                      ? t('gym.web.validity.from', { from: formatLocalDate(program.validFrom) })
                      : t('gym.web.validity.range', {
                          from: formatLocalDate(program.validFrom),
                          to: formatLocalDate(program.validTo),
                        })}
                  </td>
                  <td>
                    {program.archivedAt === null ? (
                      <StatusLabel level="ok">{t('gym.web.status.active')}</StatusLabel>
                    ) : (
                      <StatusLabel level="info">{t('gym.web.status.archived')}</StatusLabel>
                    )}
                  </td>
                  <td>
                    {canManageProgram(active, program) ? (
                      <Button
                        variant="ghost"
                        disabled={archive.isPending}
                        onClick={() => {
                          archive.mutate(program);
                        }}
                      >
                        {program.archivedAt === null
                          ? t('gym.web.archive', { name: program.name })
                          : t('gym.web.restore', { name: program.name })}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {programs.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={programs.isFetchingNextPage}
          onClick={() => void programs.fetchNextPage()}
        >
          {t('gym.web.loadMore')}
        </Button>
      ) : null}
    </Page>
  );
}
