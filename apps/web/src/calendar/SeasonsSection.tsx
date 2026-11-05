import type { Season, TestWindow } from '@sport-performance/contracts';
import {
  SEASON_MAX_DAYS,
  TEST_WINDOW_NUMBERS,
  localDate,
  localDateParts,
  seasonSpanProblem,
  testWindowLabel,
  type DateSpan,
  type LocalDate,
  type Sport,
  type TestWindowNumber,
} from '@sport-performance/domain';
import { formatLocalDate } from '@sport-performance/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { translate, useT } from '../i18n/i18n';
import { useCan } from '../permissions/permissions';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { Icon } from '../ui/icons';
import {
  dateInput,
  missingWindowNumbers,
  seasonKeepsWindows,
  suggestWindowSpan,
  windowPlanProblems,
  type WindowDraftProblem,
} from './model';
import { seasonsQuery } from './queries';
import { EditorFrame, SaveError, isConflict, useRefreshCalendar, versionKey } from './shared';

/**
 * The open editor: the season as read when it was opened and, for a window,
 * its number. The editor gets the current copy among the fetched seasons,
 * keyed by its version, so after a `409` the refetch opens it again on what
 * changed, the next save sends the new version and a window is checked
 * against the current season (ADR 0032). `reloaded`: opened again after a
 * conflict.
 */
type Editing =
  | { readonly kind: 'season'; readonly season: Season | null; readonly reloaded: boolean }
  | {
      readonly kind: 'window';
      readonly season: Season;
      readonly number: TestWindowNumber;
      readonly reloaded: boolean;
    };

/** An archive or restore waiting for the user to confirm it. */
type Confirming =
  | { readonly kind: 'season'; readonly season: Season; readonly restore: boolean }
  | {
      readonly kind: 'window';
      readonly season: Season;
      readonly window: TestWindow;
      readonly restore: boolean;
    };

/**
 * Seasons of the sport in scope (or every sport the user sees) with their
 * windows V1–V4 (B-317, B-406). The administration creates, edits, archives
 * and restores seasons (`season.manage`); the administration and the S&C plan
 * the windows (`season.plan_windows`). Everyone on the staff reads them.
 */
export function SeasonsSection(props: { today: LocalDate; onDone: (message: string) => void }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const scope = useScope();
  const canManage = useCan('season', 'manage');
  const canPlan = useCan('season', 'plan_windows');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const refresh = useRefreshCalendar();
  const query = useQuery(
    seasonsQuery(api, active.selection, scope.sport, showArchived ? 'all' : 'active'),
  );

  const archive = useMutation({
    mutationFn: (input: { season: Season; restore: boolean }) =>
      input.restore
        ? api.restoreSeason({ params: { seasonId: input.season.id } })
        : api.archiveSeason({ params: { seasonId: input.season.id } }),
    onSuccess: async (_season, input) => {
      setConfirming(null);
      await refresh();
      props.onDone(t(input.restore ? 'calendar.season.restored' : 'calendar.season.archived'));
    },
    onError: async (error) => {
      setConfirming(null);
      if (isConflict(error)) await refresh();
    },
  });
  const archiveWindow = useMutation({
    mutationFn: (input: { window: TestWindow; restore: boolean }) =>
      input.restore
        ? api.restoreTestWindow({ params: { testWindowId: input.window.id } })
        : api.archiveTestWindow({ params: { testWindowId: input.window.id } }),
    onSuccess: async (_window, input) => {
      setConfirming(null);
      await refresh();
      props.onDone(t(input.restore ? 'calendar.window.restored' : 'calendar.window.archived'));
    },
    onError: async (error) => {
      setConfirming(null);
      if (isConflict(error)) await refresh();
    },
  });

  const confirm = (next: Confirming) => {
    archive.reset();
    archiveWindow.reset();
    setConfirming(next);
  };
  const confirmed = (target: Confirming) => {
    if (target.kind === 'season') archive.mutate(target);
    else archiveWindow.mutate(target);
  };

  const done = (message: string) => {
    setEditing(null);
    props.onDone(message);
  };
  const conflicted = () => {
    setEditing((previous) => (previous === null ? null : { ...previous, reloaded: true }));
  };
  const seasons = query.data ?? [];
  const busy = archive.isPending || archiveWindow.isPending;
  // The season being edited as fetched now, or as read if it is no longer listed.
  const readSeason = editing?.season ?? null;
  const editedSeason =
    readSeason === null
      ? null
      : (seasons.find((candidate) => candidate.id === readSeason.id) ?? readSeason);
  const editedWindow =
    editing?.kind === 'window' && editedSeason !== null
      ? (editedSeason.testWindows.find((candidate) => candidate.number === editing.number) ?? null)
      : null;

  return (
    <section className="sp-card sp-cal__seasons" aria-labelledby="calendar-seasons">
      <header className="sp-cal__section-head">
        <h2 id="calendar-seasons" className="sp-card__title">
          {t('calendar.seasons.title')}
        </h2>
        <div className="sp-form__actions">
          <label className="sp-cal__toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => {
                setShowArchived(event.target.checked);
              }}
            />
            <span>{t('calendar.seasons.showArchived')}</span>
          </label>
          {canManage ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing({ kind: 'season', season: null, reloaded: false });
              }}
            >
              <Icon name="plus" />
              <span>{t('calendar.seasons.new')}</span>
            </Button>
          ) : null}
        </div>
      </header>
      <p className="sp-field__help">{t('calendar.seasons.intro')}</p>

      {editing?.kind === 'season' ? (
        <SeasonEditor
          key={versionKey(editedSeason)}
          season={editedSeason}
          reloaded={editing.reloaded}
          onConflict={conflicted}
          sports={scope.sport === null ? scope.sports : [scope.sport]}
          today={props.today}
          onDone={done}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === 'window' && editedSeason !== null ? (
        <WindowEditor
          key={`${editedSeason.id}-${String(editing.number)}-${versionKey(editedWindow)}`}
          season={editedSeason}
          window={editedWindow}
          number={editing.number}
          reloaded={editing.reloaded}
          onConflict={conflicted}
          onDone={done}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}

      <SaveError error={archive.error ?? archiveWindow.error} />
      {query.isPending ? <Loading /> : null}
      {query.isError ? <ErrorNotice error={query.error} /> : null}
      {query.isSuccess && seasons.length === 0 ? <p>{t('calendar.seasons.empty')}</p> : null}

      {seasons.map((season) => {
        const archived = season.archivedAt !== null;
        const missingNumbers = missingWindowNumbers(season);
        const heading =
          scope.sport === null ? `${season.name} · ${t(`sport.${season.sport}`)}` : season.name;
        return (
          <article key={season.id} className="sp-cal__season" aria-label={heading}>
            <header className="sp-cal__section-head">
              <div>
                <h3 className="sp-cal__season-name">{heading}</h3>
                <p className="sp-field__help">
                  {t('calendar.seasons.span', {
                    from: formatLocalDate(season.startsOn),
                    to: formatLocalDate(season.endsOn),
                  })}
                </p>
                {archived ? (
                  <StatusLabel level="info">{t('calendar.seasons.archivedBadge')}</StatusLabel>
                ) : null}
              </div>
              {canManage ? (
                <div className="sp-form__actions">
                  {archived ? null : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing({ kind: 'season', season, reloaded: false });
                      }}
                    >
                      {t('calendar.seasons.edit')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      confirm({ kind: 'season', season, restore: archived });
                    }}
                  >
                    {t(archived ? 'calendar.seasons.restore' : 'calendar.seasons.archive')}
                  </Button>
                </div>
              ) : null}
            </header>
            {confirming?.season.id === season.id ? (
              <ConfirmArchive
                target={confirming}
                busy={busy}
                onConfirm={confirmed}
                onCancel={() => {
                  setConfirming(null);
                }}
              />
            ) : null}
            <div className="sp-table-wrap">
              <table className="sp-table">
                <caption className="sp-visually-hidden">
                  {t('calendar.windows.caption', { name: heading })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('calendar.windows.number')}</th>
                    <th scope="col">{t('calendar.windows.span')}</th>
                    <th scope="col">{t('calendar.windows.state')}</th>
                    {canPlan && !archived ? (
                      <th scope="col">{t('calendar.windows.actions')}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {TEST_WINDOW_NUMBERS.map((number) => {
                    const label = testWindowLabel(number);
                    const window = season.testWindows.find((w) => w.number === number) ?? null;
                    const missing = missingNumbers.includes(number);
                    // An archived window still takes its number: it is hidden, not missing.
                    if (!showArchived && (window?.archivedAt ?? null) !== null) return null;
                    return (
                      <tr key={number}>
                        <th scope="row">{label}</th>
                        <td>
                          {window === null
                            ? '—'
                            : t('calendar.seasons.span', {
                                from: formatLocalDate(window.startsOn),
                                to: formatLocalDate(window.endsOn),
                              })}
                        </td>
                        <td>
                          {window === null ? (
                            <StatusLabel level="warning">
                              {t('calendar.windows.missing')}
                            </StatusLabel>
                          ) : window.archivedAt === null ? (
                            <span className="is-muted">{t('calendar.windows.active')}</span>
                          ) : (
                            <StatusLabel level="info">{t('calendar.windows.archived')}</StatusLabel>
                          )}
                        </td>
                        {canPlan && !archived ? (
                          <td>
                            <div className="sp-form__actions">
                              {missing ? (
                                <Button
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditing({ kind: 'window', season, number, reloaded: false });
                                  }}
                                >
                                  {t('calendar.windows.add', { label })}
                                </Button>
                              ) : null}
                              {window !== null && window.archivedAt === null ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditing({
                                        kind: 'window',
                                        season,
                                        number,
                                        reloaded: false,
                                      });
                                    }}
                                  >
                                    {t('calendar.windows.edit', { label })}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => {
                                      confirm({ kind: 'window', season, window, restore: false });
                                    }}
                                  >
                                    {t('calendar.windows.archive', { label })}
                                  </Button>
                                </>
                              ) : null}
                              {window !== null && window.archivedAt !== null ? (
                                <Button
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => {
                                    confirm({ kind: 'window', season, window, restore: true });
                                  }}
                                >
                                  {t('calendar.windows.restore', { label })}
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </section>
  );
}

/** Confirmation of an archive or restore of a season or a window, next to it. */
function ConfirmArchive(props: {
  target: Confirming;
  busy: boolean;
  onConfirm: (target: Confirming) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { target } = props;
  const message =
    target.kind === 'season'
      ? t(target.restore ? 'calendar.seasons.restoreConfirm' : 'calendar.seasons.archiveConfirm', {
          name: target.season.name,
        })
      : t(target.restore ? 'calendar.windows.restoreConfirm' : 'calendar.windows.archiveConfirm', {
          label: target.window.label,
          season: target.season.name,
        });
  return (
    <Notice
      level="warning"
      role="alert"
      action={
        <div className="sp-form__actions">
          <Button
            variant="secondary"
            disabled={props.busy}
            onClick={() => {
              props.onConfirm(target);
            }}
          >
            {t(target.restore ? 'calendar.confirm.restoreYes' : 'calendar.confirm.archiveYes')}
          </Button>
          <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <p>{message}</p>
    </Notice>
  );
}

/**
 * Planning year of the next season to suggest: this year until October,
 * the next one from November (when V4 closes the year).
 */
function suggestedSeasonYear(today: LocalDate): number {
  const { year, month } = localDateParts(today);
  return month >= 11 ? year + 1 : year;
}

function SeasonEditor(props: {
  season: Season | null;
  sports: readonly Sport[];
  today: LocalDate;
  /** Opened again on refetched data after a `409`: the explanation stays. */
  reloaded: boolean;
  /** A `409`: the section reopens the editor on the refetched season. */
  onConflict: () => void;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCalendar();
  const season = props.season;
  const year = suggestedSeasonYear(props.today);
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [sport, setSport] = useState<Sport | ''>(season?.sport ?? props.sports[0] ?? '');
  const [name, setName] = useState(season?.name ?? String(year));
  const [startsOn, setStartsOn] = useState<string>(season?.startsOn ?? localDate(year, 2, 1));
  const [endsOn, setEndsOn] = useState<string>(season?.endsOn ?? localDate(year, 11, 30));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (span: DateSpan) => {
      if (season === null) {
        return api.createSeason({
          body: { clientUuid, sport: sport as Sport, name: name.trim(), ...span },
        });
      }
      return api.updateSeason({
        params: { seasonId: season.id },
        body: {
          version: season.version,
          ...(name.trim() === season.name ? {} : { name: name.trim() }),
          ...(span.startsOn === season.startsOn ? {} : { startsOn: span.startsOn }),
          ...(span.endsOn === season.endsOn ? {} : { endsOn: span.endsOn }),
        },
      });
    },
    onSuccess: async () => {
      props.onDone(t('calendar.season.saved'));
      await refresh();
    },
    onError: async (error) => {
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (sport === '') next.sport = t('calendar.field.required');
    if (name.trim() === '') next.name = t('calendar.field.required');
    const from = dateInput(startsOn);
    const to = dateInput(endsOn);
    if (from === null) next.startsOn = t('calendar.field.invalidDate');
    if (to === null) next.endsOn = t('calendar.field.invalidDate');
    if (from !== null && to !== null) {
      const problem = seasonSpanProblem({ startsOn: from, endsOn: to });
      if (problem === 'ends_before_start')
        next.endsOn = t('calendar.season.problem.ends_before_start');
      else if (problem === 'too_long') {
        next.endsOn = t('calendar.season.problem.too_long', { max: SEASON_MAX_DAYS });
      } else if (season !== null && !seasonKeepsWindows(season, { startsOn: from, endsOn: to })) {
        next.endsOn = t('calendar.season.problem.windowsOutside');
      }
    }
    setErrors(next);
    if (Object.keys(next).length === 0 && from !== null && to !== null) {
      save.mutate({ startsOn: from, endsOn: to });
    }
  };

  return (
    <EditorFrame
      id="calendar-editor-season"
      title={
        season === null
          ? t('calendar.season.newTitle')
          : t('calendar.season.editTitle', { name: season.name })
      }
      onClose={props.onClose}
    >
      <form className="sp-form" noValidate onSubmit={submit}>
        <div className="sp-form__row">
          {season === null && props.sports.length > 1 ? (
            <SelectField
              label={t('calendar.season.sport')}
              value={sport}
              error={errors.sport}
              options={props.sports.map((value) => ({ value, label: t(`sport.${value}`) }))}
              onChange={(event) => {
                setSport(event.target.value as Sport);
              }}
            />
          ) : null}
          <TextField
            label={t('calendar.season.name')}
            help={t('calendar.season.name.help')}
            required
            value={name}
            error={errors.name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <TextField
            label={t('calendar.season.startsOn')}
            type="date"
            required
            value={startsOn}
            error={errors.startsOn}
            onChange={(event) => {
              setStartsOn(event.target.value);
            }}
          />
          <TextField
            label={t('calendar.season.endsOn')}
            type="date"
            required
            value={endsOn}
            error={errors.endsOn}
            onChange={(event) => {
              setEndsOn(event.target.value);
            }}
          />
        </div>
        <SaveError error={save.error} reloaded={props.reloaded && !save.isPending} />
        <div className="sp-form__actions">
          <Button type="submit" disabled={save.isPending}>
            {t('calendar.season.save')}
          </Button>
        </div>
      </form>
    </EditorFrame>
  );
}

function problemText(
  t: ReturnType<typeof useT>,
  problem: WindowDraftProblem,
  label: string,
): string {
  return translate(t, `calendar.window.problem.${problem.kind}`, {
    label,
    other: problem.other ?? '—',
  });
}

function WindowEditor(props: {
  season: Season;
  window: TestWindow | null;
  number: TestWindowNumber;
  /** Opened again on refetched data after a `409`: the explanation stays. */
  reloaded: boolean;
  /** A `409`: the section reopens the editor on the refetched season. */
  onConflict: () => void;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCalendar();
  const { season, window, number } = props;
  const label = testWindowLabel(number);
  const [suggestion] = useState(() => (window === null ? suggestWindowSpan(season, number) : null));
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [startsOn, setStartsOn] = useState<string>(window?.startsOn ?? suggestion?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState<string>(window?.endsOn ?? suggestion?.endsOn ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [planProblems, setPlanProblems] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (span: DateSpan) => {
      if (window === null) {
        return api.createTestWindow({
          params: { seasonId: season.id },
          body: { clientUuid, number, ...span },
        });
      }
      return api.updateTestWindow({
        params: { testWindowId: window.id },
        body: {
          version: window.version,
          ...(span.startsOn === window.startsOn ? {} : { startsOn: span.startsOn }),
          ...(span.endsOn === window.endsOn ? {} : { endsOn: span.endsOn }),
        },
      });
    },
    onSuccess: async () => {
      props.onDone(t('calendar.window.saved'));
      await refresh();
    },
    onError: async (error) => {
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const from = dateInput(startsOn);
    const to = dateInput(endsOn);
    if (from === null) next.startsOn = t('calendar.field.invalidDate');
    if (to === null) next.endsOn = t('calendar.field.invalidDate');
    const problems =
      from === null || to === null
        ? []
        : windowPlanProblems(season, {
            id: window?.id ?? null,
            number,
            startsOn: from,
            endsOn: to,
          });
    setErrors(next);
    setPlanProblems(problems.map((problem) => problemText(t, problem, label)));
    if (Object.keys(next).length === 0 && problems.length === 0 && from !== null && to !== null) {
      save.mutate({ startsOn: from, endsOn: to });
    }
  };

  return (
    <EditorFrame
      id="calendar-editor-window"
      title={t(window === null ? 'calendar.window.newTitle' : 'calendar.window.editTitle', {
        label,
        season: season.name,
      })}
      onClose={props.onClose}
    >
      {suggestion === null ? null : (
        <Notice level="info">
          <p>{t('calendar.window.suggested', { label })}</p>
        </Notice>
      )}
      <form className="sp-form" noValidate onSubmit={submit}>
        <div className="sp-form__row">
          <TextField
            label={t('calendar.window.startsOn')}
            type="date"
            required
            value={startsOn}
            error={errors.startsOn}
            onChange={(event) => {
              setStartsOn(event.target.value);
            }}
          />
          <TextField
            label={t('calendar.window.endsOn')}
            type="date"
            required
            value={endsOn}
            error={errors.endsOn}
            onChange={(event) => {
              setEndsOn(event.target.value);
            }}
          />
        </div>
        {planProblems.length === 0 ? null : (
          <Notice level="critical" role="alert">
            <ul className="sp-cal__problems">
              {planProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        )}
        <SaveError error={save.error} reloaded={props.reloaded && !save.isPending} />
        <div className="sp-form__actions">
          <Button type="submit" disabled={save.isPending}>
            {t('calendar.window.save')}
          </Button>
        </div>
      </form>
    </EditorFrame>
  );
}
