import type { Category, SeasonRollover, SeasonRolloverItem } from '@sport-performance/contracts';
import {
  DEFAULT_AGE_BANDS,
  SEASON_ROLLOVER_OUTCOMES,
  isLocalDate,
} from '@sport-performance/domain';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { ActionError, AdminSection, ConfirmAction, LoadMore, useClubFormat } from './parts';
import {
  adminKey,
  allCategoriesQuery,
  rolloverItemsQuery,
  rolloversQuery,
  type RolloverItemFilters,
} from './queries';

const route = getRouteApi('/_authed/_club/admin/seasons/$seasonId');

/** The rollover to work on: the one in review, else the newest. */
export function currentRollover(rollovers: readonly SeasonRollover[]): SeasonRollover | null {
  return rollovers.find((r) => r.status === 'draft') ?? rollovers[0] ?? null;
}

/**
 * Season change of one season (B-411 over B-316, ADR 0049): ask for the
 * proposal (every player of the sport to the category of their birth
 * year), review it player by player, and apply it once, or discard it.
 */
export function SeasonRolloverPage() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const { seasonId } = route.useParams();
  const season = useQuery({
    queryKey: adminKey(selection, 'season', seasonId),
    queryFn: ({ signal }) => api.getSeason({ params: { seasonId } }, { signal }),
  });
  const rollovers = useQuery(rolloversQuery(api, selection, seasonId));

  if (season.isPending || rollovers.isPending) return <Loading />;
  if (season.isError) return <ErrorNotice error={season.error} />;
  if (rollovers.isError) return <ErrorNotice error={rollovers.error} />;

  const current = currentRollover(rollovers.data);
  const others = rollovers.data.filter((r) => r.id !== current?.id);

  return (
    <>
      <p>
        <Link to="/admin/seasons" className="sp-button sp-button--ghost">
          {t('admin.rollover.back')}
        </Link>
      </p>
      <AdminSection
        id="admin-rollover"
        title={t('admin.rollover.title', { season: season.data.name })}
        intro={t('admin.rollover.intro', { sport: t(`sport.${season.data.sport}`) })}
      >
        {current?.status === 'draft' ? null : (
          <ProposeForm seasonId={seasonId} startsOn={season.data.startsOn} />
        )}
      </AdminSection>
      {current === null ? null : <RolloverDetail key={current.id} rollover={current} />}
      {others.length === 0 ? null : <RolloverHistory rollovers={others} />}
    </>
  );
}

function ProposeForm(props: { seasonId: string; startsOn: string }) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const [effectiveOn, setEffectiveOn] = useState(props.startsOn);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const valid = isLocalDate(effectiveOn);
  const create = useMutation({
    mutationFn: () =>
      api.createSeasonRollover({
        params: { seasonId: props.seasonId },
        body: { clientUuid, effectiveOn },
      }),
    onSuccess: () => {
      setClientUuid(crypto.randomUUID());
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKey(selection, 'rollovers') }),
  });
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid) create.mutate();
  };
  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <TextField
        label={t('admin.rollover.effectiveOn')}
        help={t('admin.rollover.effectiveOnHelp')}
        type="date"
        value={effectiveOn}
        error={valid ? null : t('admin.dateInvalid')}
        onChange={(event) => {
          setEffectiveOn(event.target.value);
          setClientUuid(crypto.randomUUID());
        }}
      />
      <ActionError error={create.error} conflictText={t('admin.rollover.conflictDraft')} />
      <div className="sp-form__actions">
        <Button type="submit" disabled={!valid || create.isPending}>
          {t('admin.rollover.propose')}
        </Button>
      </div>
    </form>
  );
}

function useCategoryNames() {
  const { api } = useServices();
  const { selection } = useActiveClub();
  const categories = useQuery(allCategoriesQuery(api, selection));
  const list = categories.data ?? [];
  return {
    categories: list,
    name: (id: string | null) => list.find((c) => c.id === id)?.name ?? null,
  };
}

function RolloverDetail(props: { rollover: SeasonRollover }) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const format = useClubFormat();
  const { rollover } = props;
  const draft = rollover.status === 'draft';
  const [filters, setFilters] = useState<RolloverItemFilters>({
    view: draft && rollover.counts.pendingReview > 0 ? 'pending' : 'all',
    decision: null,
  });
  const items = useInfiniteQuery(rolloverItemsQuery(api, selection, rollover.id, filters));
  const rows = items.data?.pages.flatMap((page) => page.items) ?? [];
  const { categories, name } = useCategoryNames();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: adminKey(selection, 'rollovers') });
  const apply = useMutation({
    mutationFn: () =>
      api.applySeasonRollover({
        params: { rolloverId: rollover.id },
        body: { version: rollover.version },
      }),
    // Applying moves players between categories: every screen of the club reads again.
    onSettled: () => queryClient.invalidateQueries({ queryKey: clubQueryKey(selection) }),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelSeasonRollover({ params: { rolloverId: rollover.id } }),
    onSettled: refresh,
  });

  const { counts } = rollover;
  return (
    <AdminSection
      id="admin-rollover-detail"
      title={t('admin.rollover.detail', {
        date: format.date(rollover.effectiveOn),
        year: rollover.seasonYear,
      })}
    >
      <p>
        <RolloverStatus rollover={rollover} />
      </p>
      <dl className="sp-summary">
        <div>
          <dt>{t('admin.rollover.players')}</dt>
          <dd>{counts.players}</dd>
        </div>
        <div>
          <dt>{t('admin.rollover.moving')}</dt>
          <dd>{counts.moving}</dd>
        </div>
        <div>
          <dt>{t('admin.rollover.staying')}</dt>
          <dd>{counts.staying}</dd>
        </div>
        <div>
          <dt>{t('admin.rollover.pendingReview')}</dt>
          <dd>{counts.pendingReview}</dd>
        </div>
      </dl>
      {counts.outcomes === null ? null : (
        <dl className="sp-details sp-admin__outcomes">
          {SEASON_ROLLOVER_OUTCOMES.map((outcome) => (
            <div key={outcome}>
              <dt>{t(`admin.rollover.outcome.${outcome}`)}</dt>
              <dd>{counts.outcomes?.[outcome] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}

      {draft ? (
        <>
          {counts.pendingReview > 0 ? (
            <Notice level="warning">
              <p>{t('admin.rollover.reviewFirst', { count: counts.pendingReview })}</p>
            </Notice>
          ) : null}
          <div className="sp-form__actions sp-admin__rollover-actions">
            <ConfirmAction
              label={t('admin.rollover.apply')}
              question={t('admin.rollover.applyQuestion', {
                count: counts.moving,
                date: format.date(rollover.effectiveOn),
              })}
              disabled={counts.pendingReview > 0}
              pending={apply.isPending}
              onConfirm={() => {
                apply.mutate();
              }}
            />
            <ConfirmAction
              label={t('admin.rollover.cancel')}
              question={t('admin.rollover.cancelQuestion')}
              pending={cancel.isPending}
              onConfirm={() => {
                cancel.mutate();
              }}
            />
          </div>
          <ActionError
            error={apply.error ?? cancel.error}
            conflictText={t('admin.rollover.conflictApply')}
          />
        </>
      ) : null}

      <div className="sp-filters">
        <SelectField
          label={t('admin.rollover.view')}
          value={filters.view}
          options={[
            { value: 'pending', label: t('admin.rollover.view.pending') },
            { value: 'all', label: t('admin.rollover.view.all') },
          ]}
          onChange={(event) => {
            const view = event.target.value as RolloverItemFilters['view'];
            setFilters((current) => ({ ...current, view }));
          }}
        />
        <SelectField
          label={t('admin.rollover.decision')}
          value={filters.decision ?? ''}
          options={[
            { value: '', label: t('admin.rollover.decision.any') },
            { value: 'move', label: t('admin.rollover.decision.move') },
            { value: 'stay', label: t('admin.rollover.decision.stay') },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((current) => ({
              ...current,
              decision: value === '' ? null : (value as 'move' | 'stay'),
            }));
          }}
        />
      </div>
      {items.isPending ? <Loading /> : null}
      {items.isError ? <ErrorNotice error={items.error} /> : null}
      {items.isSuccess && rows.length === 0 ? (
        <Notice level="info" role="status">
          <p>
            {filters.view === 'pending'
              ? t('admin.rollover.noPending')
              : t('admin.rollover.noPlayers')}
          </p>
        </Notice>
      ) : null}
      {rows.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('admin.rollover.players')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.rollover.player')}</th>
                <th scope="col">{t('admin.rollover.birthDate')}</th>
                <th scope="col">{t('admin.rollover.previous')}</th>
                <th scope="col">{t('admin.rollover.proposal')}</th>
                <th scope="col">
                  {draft ? t('admin.rollover.decision') : t('admin.rollover.result')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <RolloverItemRow
                  key={item.id}
                  item={item}
                  draft={draft}
                  categories={categories.filter(
                    (c) => c.sport === rollover.sport && c.archivedAt === null,
                  )}
                  categoryName={name}
                  onChanged={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore
        hasNextPage={items.hasNextPage}
        isFetchingNextPage={items.isFetchingNextPage}
        fetchNextPage={items.fetchNextPage}
      />
    </AdminSection>
  );
}

function RolloverStatus(props: { rollover: SeasonRollover }) {
  const t = useT();
  const { status } = props.rollover;
  return (
    <StatusLabel level={status === 'applied' ? 'ok' : status === 'draft' ? 'warning' : 'info'}>
      {t(`admin.rollover.status.${status}`)}
    </StatusLabel>
  );
}

/** Value of the decision select: `stay`, or `move:<categoryId>`. */
export function decisionValue(item: Pick<SeasonRolloverItem, 'decision' | 'targetCategoryId'>) {
  return item.decision === 'stay' || item.targetCategoryId === null
    ? 'stay'
    : `move:${item.targetCategoryId}`;
}

function RolloverItemRow(props: {
  item: SeasonRolloverItem;
  draft: boolean;
  /** Active categories of the season's sport. */
  categories: readonly Category[];
  categoryName: (id: string | null) => string | null;
  onChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const { api } = useServices();
  const format = useClubFormat();
  const { item } = props;
  const [value, setValue] = useState(decisionValue(item));
  const save = useMutation({
    mutationFn: () => {
      const [decision, categoryId] = value.split(':') as ['move' | 'stay', string | undefined];
      return api.updateSeasonRolloverItem({
        params: { rolloverId: item.rolloverId, itemId: item.id },
        body:
          decision === 'move' && categoryId !== undefined
            ? { version: item.version, decision: 'move', targetCategoryId: categoryId }
            : { version: item.version, decision: 'stay' },
      });
    },
    onSettled: props.onChanged,
  });
  const band = DEFAULT_AGE_BANDS.find((b) => b.code === item.ageBandCode)?.label;
  const previous = item.previousCategoryIds
    .map((id) => props.categoryName(id) ?? t('common.notAvailable'))
    .join(', ');
  // Active categories of the player's branch (the season's sport, their sex).
  const options = props.categories.filter((c) => c.sex === item.player.sex);
  const pending = item.needsReview && item.reviewedAt === null;
  const proposed = props.categoryName(item.proposedCategoryId);

  return (
    <tr>
      <th scope="row">
        {item.player.lastName}, {item.player.firstName}
      </th>
      <td>
        {format.date(item.player.birthDate)}
        <span className="sp-admin__meta">
          {band === undefined
            ? t('admin.rollover.noBand')
            : t('admin.rollover.band', { band, age: item.ageInSeasonYear })}
        </span>
      </td>
      <td>{previous === '' ? t('admin.rollover.noCategory') : previous}</td>
      <td>
        <span>{t(`admin.rollover.proposal.${item.proposal}`)}</span>
        {proposed === null ? null : (
          <span className="sp-admin__meta">
            {t('admin.rollover.proposedTo', { name: proposed })}
          </span>
        )}
        {pending ? (
          <StatusLabel level="warning">{t('admin.rollover.needsReview')}</StatusLabel>
        ) : item.reviewedAt === null ? null : (
          <StatusLabel level="ok">{t('admin.rollover.reviewed')}</StatusLabel>
        )}
      </td>
      <td>
        {props.draft ? (
          <form
            className="sp-admin__inline"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <SelectField
              label={t('admin.rollover.decisionFor', {
                name: `${item.player.firstName} ${item.player.lastName}`,
              })}
              value={value}
              options={[
                { value: 'stay', label: t('admin.rollover.decision.stay') },
                ...options.map((c) => ({
                  value: `move:${c.id}`,
                  label: t('admin.rollover.moveTo', { name: c.name }),
                })),
              ]}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={save.isPending || (value === decisionValue(item) && !pending)}
            >
              {pending && value === decisionValue(item)
                ? t('admin.rollover.confirm')
                : t('common.save')}
            </Button>
            <ActionError error={save.error} />
          </form>
        ) : item.outcome === null ? (
          t('common.notAvailable')
        ) : (
          <StatusLabel
            level={item.outcome === 'moved' || item.outcome === 'stayed' ? 'ok' : 'warning'}
          >
            {t(`admin.rollover.outcome.${item.outcome}`)}
          </StatusLabel>
        )}
      </td>
    </tr>
  );
}

function RolloverHistory(props: { rollovers: readonly SeasonRollover[] }) {
  const t = useT();
  const format = useClubFormat();
  return (
    <AdminSection id="admin-rollover-history" title={t('admin.rollover.history')}>
      <ul className="sp-admin__history">
        {props.rollovers.map((rollover) => (
          <li key={rollover.id}>
            <RolloverStatus rollover={rollover} />{' '}
            {t('admin.rollover.historyItem', {
              date: format.date(rollover.effectiveOn),
              createdAt: format.dateTime(rollover.createdAt),
              players: rollover.counts.players,
            })}
          </li>
        ))}
      </ul>
    </AdminSection>
  );
}
