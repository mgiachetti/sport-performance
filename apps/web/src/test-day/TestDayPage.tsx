import { ApiError, type TestDaySheet, type TestResult } from '@sport-performance/contracts';
import { formatLocalDateLong, formatNumber } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { categoryFacts, useCan } from '../permissions/permissions';
import { Button, ErrorNotice, Notice, Page } from '../ui/components';
import { TestDayStatus, testLabel } from './parts';
import { testDaysKey, testDayResultsQuery, testDaySheetQuery } from './queries';
import { StationPanel, initialStationState, type StationState } from './StationPanel';
import './test-day.css';

const route = getRouteApi('/_authed/_club/test-days/$testSessionId');

type RunStatus = 'scheduled' | 'in_progress' | 'completed';

/**
 * A test day (B-405, pantalla 3): the header of the day and how it runs, its
 * stations and, per station, the sheet of the roster. The sheet comes in one
 * read (`GET …/sheet`); the results of the day come apart and refresh after
 * every write.
 */
export function TestDayPage() {
  const t = useT();
  const { testSessionId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { api } = useServices();
  const active = useActiveClub();
  const { data: sheet } = useSuspenseQuery(testDaySheetQuery(api, active.selection, testSessionId));
  const results = useQuery(testDayResultsQuery(api, active.selection, testSessionId));
  const [stations, setStations] = useState<Record<string, StationState>>({});

  const session = sheet.testSession;
  const category = active.categories.find((c) => c.id === session.categoryId) ?? null;
  const target = category === null ? undefined : { category: categoryFacts(category) };
  const canManage = useCan('test_session', 'manage', target);
  const title =
    category === null
      ? t('testDay.titleNoCategory')
      : t('testDay.title', { category: category.name });
  const subtitle = t('testDay.subtitle', {
    window: sheet.testWindow?.label ?? t('testDay.window.none'),
    date: formatLocalDateLong(session.scheduledOn),
  });

  const selected =
    sheet.stations.find((s) => s.testCode === search.station) ?? sheet.stations[0] ?? null;
  const resultsOf = (testCode: string): TestResult[] =>
    (results.data ?? []).filter((result) => result.testCode === testCode);

  return (
    <Page
      title={title}
      subtitle={subtitle}
      actions={canManage ? <RunActions sheet={sheet} /> : undefined}
    >
      <DayHeader sheet={sheet} />
      {session.status === 'cancelled' ? (
        <Notice level="warning">
          <p>{t('testDay.cancelled')}</p>
        </Notice>
      ) : null}
      {results.error === null ? null : <ErrorNotice error={results.error} />}
      {sheet.stations.length === 0 ? (
        <Notice level="info">
          <p>{t('testDay.noStations')}</p>
        </Notice>
      ) : (
        <>
          <nav className="sp-td-stations" aria-label={t('testDay.stations')}>
            {sheet.stations.map((station) => {
              const done = new Set(resultsOf(station.testCode).map((r) => r.playerId)).size;
              return (
                <button
                  key={station.testCode}
                  type="button"
                  className="sp-td-station"
                  aria-pressed={station.testCode === selected?.testCode}
                  onClick={() =>
                    void navigate({
                      search: (prev) => ({ ...prev, station: station.testCode }),
                      replace: true,
                    })
                  }
                >
                  <b>{testLabel(t, station.testCode)}</b>
                  <small>
                    {t('testDay.station.progress', {
                      done: formatNumber(done),
                      total: formatNumber(sheet.players.length),
                    })}
                  </small>
                  {station.scheduled ? null : <small>{t('testDay.station.extra')}</small>}
                </button>
              );
            })}
          </nav>
          {selected === null ? null : (
            <StationPanel
              key={selected.testCode}
              sheet={sheet}
              station={selected}
              results={resultsOf(selected.testCode)}
              resultsLoaded={results.isSuccess}
              state={stations[selected.testCode] ?? initialStationState(selected)}
              onStateChange={(update) => {
                setStations((all) => ({
                  ...all,
                  [selected.testCode]: update(
                    all[selected.testCode] ?? initialStationState(selected),
                  ),
                }));
              }}
            />
          )}
        </>
      )}
    </Page>
  );
}

function DayHeader(props: { sheet: TestDaySheet }) {
  const t = useT();
  const session = props.sheet.testSession;
  const { conditions } = session;
  const lines = [
    conditions.surface === undefined
      ? null
      : t('testDay.conditions.surface', { value: conditions.surface }),
    conditions.footwear === undefined
      ? null
      : t('testDay.conditions.footwear', { value: conditions.footwear }),
    conditions.weather === undefined
      ? null
      : t('testDay.conditions.weather', { value: conditions.weather }),
    conditions.temperatureC === undefined
      ? null
      : t('testDay.conditions.temperature', {
          value: `${formatNumber(conditions.temperatureC, { maxDecimals: 1 })} °C`,
        }),
    conditions.standardizedWarmUp === undefined
      ? null
      : t(
          conditions.standardizedWarmUp
            ? 'testDay.conditions.warmUp'
            : 'testDay.conditions.noWarmUp',
        ),
  ].filter((line): line is string => line !== null);
  return (
    <section className="sp-card sp-td-header" aria-label={t('testDay.conditions.title')}>
      <p>
        <TestDayStatus status={session.status} />
      </p>
      {session.location === null ? null : (
        <p>{t('testDay.location', { location: session.location })}</p>
      )}
      <div>
        <h2 className="sp-td-subtitle">{t('testDay.conditions.title')}</h2>
        {lines.length === 0 ? (
          <p>{t('testDay.conditions.none')}</p>
        ) : (
          <ul className="sp-tag-list">
            {lines.map((line) => (
              <li key={line} className="sp-tag">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      {session.notes === null ? null : <p>{t('testDay.notes', { notes: session.notes })}</p>}
    </section>
  );
}

/** Start, close and reopen the day (`PATCH` with `version`; a stale one is a `409`). */
function RunActions(props: { sheet: TestDaySheet }) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const { selection } = useActiveClub();
  const session = props.sheet.testSession;
  const run = useMutation({
    mutationFn: (status: RunStatus) =>
      api.updateTestSession({
        params: { testSessionId: session.id },
        body: { version: session.version, status },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: testDaysKey(selection) }),
  });
  const next: { status: RunStatus; label: string } | null =
    session.status === 'scheduled'
      ? { status: 'in_progress', label: t('testDay.action.start') }
      : session.status === 'in_progress'
        ? { status: 'completed', label: t('testDay.action.complete') }
        : session.status === 'completed'
          ? { status: 'in_progress', label: t('testDay.action.reopen') }
          : null;
  if (next === null) return null;
  const conflict = run.error instanceof ApiError && run.error.status === 409;
  return (
    <div className="sp-td-run">
      <Button
        disabled={run.isPending}
        onClick={() => {
          run.mutate(next.status);
        }}
      >
        {next.label}
      </Button>
      {run.error === null ? null : conflict ? (
        <Notice level="warning" role="alert">
          <p>{t('testDay.action.conflict')}</p>
        </Notice>
      ) : (
        <ErrorNotice error={run.error} />
      )}
    </div>
  );
}
