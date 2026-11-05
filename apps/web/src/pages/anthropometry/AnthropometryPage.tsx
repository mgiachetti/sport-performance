import type { AnthroMeasurement, Category, Player } from '@sport-performance/contracts';
import {
  compareLocalDates,
  isLocalDate,
  localDateInTimeZone,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate, formatNumber, formatUnit } from '@sport-performance/i18n';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useScope } from '../../club/use-scope';
import { useT } from '../../i18n/i18n';
import { canOnCategoryPlayers } from '../../permissions/permissions';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  Notice,
  Page,
  TextField,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { MeasurementSheet, playerName } from './MeasurementSheet';
import { categoryPlayersQuery, recentMeasurementsQuery } from './queries';
import './anthropometry.css';

/**
 * Anthropometry (B-412): the sheet of a measurement day for the category of
 * the scope selector, with the maturation at once, and its latest
 * measurements with what the worker derived. S&C of the category and the
 * administration load; the rest of the staff that reads it only sees.
 */
export function AnthropometryPage() {
  const t = useT();
  const active = useActiveClub();
  const scope = useScope();
  const category = scope.category;
  const readable = canOnCategoryPlayers(
    active.subject,
    'anthropometry',
    'read',
    category === null ? scope.categoryOptions : [category],
  );

  return (
    <Page title={t('anthropometry.title')} subtitle={t('anthropometry.subtitle')}>
      {!readable ? (
        <Notice level="warning" role="alert">
          <p>{t('error.forbidden')}</p>
        </Notice>
      ) : category === null ? (
        <Card>
          <EmptyState icon="ruler" title={t('anthropometry.pickCategory')} />
        </Card>
      ) : (
        <CategoryAnthropometry key={category.id} category={category} />
      )}
    </Page>
  );
}

function CategoryAnthropometry(props: { category: Category }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const today = localDateInTimeZone(new Date(), active.club.timeZone);
  const [measuredOn, setMeasuredOn] = useState<LocalDate>(today);
  const [dateText, setDateText] = useState<string>(today);
  const players = useQuery(categoryPlayersQuery(api, active.selection, props.category.id));
  const canRecord = canOnCategoryPlayers(active.subject, 'anthropometry', 'record', [
    props.category,
  ]);
  const dateValid = isLocalDate(dateText) && compareLocalDates(dateText, today) <= 0;

  if (players.isPending) return <Loading />;
  if (players.error !== null) return <ErrorNotice error={players.error} />;
  const names = new Map(players.data.map((player) => [player.id as string, player]));

  return (
    <>
      {canRecord ? (
        <>
          <div className="sp-anthro__date">
            <TextField
              label={t('anthropometry.sheet.date')}
              help={t('anthropometry.sheet.dateHelp')}
              type="date"
              max={today}
              value={dateText}
              error={dateValid ? null : t('anthropometry.error.date')}
              onChange={(event) => {
                const value = event.target.value;
                setDateText(value);
                if (isLocalDate(value) && compareLocalDates(value, today) <= 0) {
                  setMeasuredOn(value);
                }
              }}
            />
          </div>
          <MeasurementSheet
            category={props.category}
            players={players.data}
            measuredOn={measuredOn}
            dateInvalid={!dateValid}
          />
        </>
      ) : (
        <Notice level="info">
          <p>{t('anthropometry.readOnly')}</p>
        </Notice>
      )}
      <RecentMeasurements category={props.category} players={names} />
    </>
  );
}

function RecentMeasurements(props: { category: Category; players: ReadonlyMap<string, Player> }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const query = useInfiniteQuery(recentMeasurementsQuery(api, active.selection, props.category.id));
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const skinfolds = items.some((item) => item.skinfoldsSumMm !== null);

  return (
    <Card variant="flush" title={t('anthropometry.recent.title')}>
      {query.isPending ? (
        <Loading />
      ) : query.error !== null ? (
        <ErrorNotice error={query.error} />
      ) : items.length === 0 ? (
        <EmptyState icon="ruler" title={t('anthropometry.recent.empty')} />
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-table__caption sp-anthro__caption">
              {t('anthropometry.recent.caption', { category: props.category.name })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('anthropometry.column.date')}</th>
                <th scope="col">{t('anthropometry.column.player')}</th>
                <th scope="col" className="sp-table__number">
                  {t('anthropometry.column.heightCm')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('anthropometry.column.sittingHeightCm')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('anthropometry.column.weightKg')}
                </th>
                {skinfolds ? (
                  <th scope="col" className="sp-table__number">
                    {t('anthropometry.column.skinfoldsSumMm')}
                  </th>
                ) : null}
                <th scope="col" className="sp-table__number">
                  {t('anthropometry.column.phvOffset')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('anthropometry.column.adultHeight')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <RecentRow
                  key={item.id}
                  item={item}
                  player={props.players.get(item.playerId)}
                  skinfolds={skinfolds}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage ? (
        <div className="sp-card__footer">
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {t('anthropometry.recent.more')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function RecentRow(props: {
  item: AnthroMeasurement;
  player: Player | undefined;
  skinfolds: boolean;
}) {
  const t = useT();
  const { item } = props;
  const pending = item.maturation.derivedAt === null;
  const cm = (value: number | null) => formatNumber(value, { maxDecimals: 1 });
  const derived = (value: string) =>
    pending ? (
      <span className="sp-anthro__status sp-anthro__status--info">
        <Icon name="sync" /> {t('anthropometry.recent.pending')}
      </span>
    ) : (
      value
    );
  return (
    <tr>
      <td className="is-date">{formatLocalDate(item.measuredOn)}</td>
      <th scope="row">{props.player === undefined ? '—' : playerName(props.player)}</th>
      <td className="sp-table__number">{cm(item.heightCm)}</td>
      <td className="sp-table__number">{cm(item.sittingHeightCm)}</td>
      <td className="sp-table__number">{cm(item.weightKg)}</td>
      {props.skinfolds ? <td className="sp-table__number">{cm(item.skinfoldsSumMm)}</td> : null}
      <td className="sp-table__number">
        {derived(
          item.maturation.phvOffsetYears === null
            ? '—'
            : t('anthropometry.value.offset', {
                value: formatNumber(item.maturation.phvOffsetYears, {
                  decimals: 1,
                  sign: 'always',
                }),
              }),
        )}
      </td>
      <td className="sp-table__number">
        {derived(
          item.maturation.adultHeightPct === null
            ? '—'
            : t('anthropometry.value.adultHeight', {
                pct: formatUnit(item.maturation.adultHeightPct, 'pct'),
                predicted: formatUnit(item.maturation.predictedAdultHeightCm, 'cm'),
              }),
        )}
      </td>
    </tr>
  );
}
