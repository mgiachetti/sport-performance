import type {
  BatteryEntryDto,
  CatalogTest,
  Category,
  EffectiveBattery,
} from '@sport-performance/contracts';
import {
  BatteryEntryValidationError,
  DEFAULT_AGE_BANDS,
  MAX_BATTERY_CADENCE_WEEKS,
  STAGES,
  TEST_WINDOW_NUMBERS,
  type CategoryId,
  type LocalDate,
  type Sex,
  type Sport,
  type Stage,
  type TestWindowNumber,
  validateBatteryStage,
} from '@sport-performance/domain';
import { formatLocalDate, type Translator } from '@sport-performance/i18n';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { CheckboxField, CheckboxGroup } from '../ui/choice';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { StatusLabel } from '../ui/fields';
import {
  batteryEntriesQuery,
  catalogTestsQuery,
  effectiveBatteryQuery,
  invalidateConfiguration,
} from './queries';
import {
  PhaseLabel,
  newClientUuid,
  parseDateInput,
  parseInteger,
  stageLabel,
  testLabel,
  useClubToday,
  validityPhase,
  validityText,
} from './shared';

type T = Translator['t'];

interface Schedule {
  readonly windows: readonly number[];
  readonly cadenceWeeks: { readonly min: number; readonly max: number } | null;
}

/** "V1 · V3", "Cada 4–6 semanas", "Semanal", or both; `null` when nothing is scheduled. */
export function scheduleText(t: T, schedule: Schedule): string | null {
  const parts: string[] = [];
  if (schedule.windows.length > 0) {
    parts.push(
      [...schedule.windows]
        .sort((a, b) => a - b)
        .map((number) => t('configuration.battery.window', { number }))
        .join(' · '),
    );
  }
  const cadence = schedule.cadenceWeeks;
  if (cadence !== null) {
    parts.push(
      cadence.min === 1 && cadence.max === 1
        ? t('configuration.battery.cadenceWeekly')
        : cadence.min === cadence.max
          ? t('configuration.battery.cadenceEvery', { weeks: cadence.min })
          : t('configuration.battery.cadenceRange', { min: cadence.min, max: cadence.max }),
    );
  }
  return parts.length === 0 ? null : parts.join(' + ');
}

/** Where an entry applies, from the most specific dimension. */
function sourceText(t: T, entry: BatteryEntryDto): string {
  if (entry.categoryId !== null) return t('configuration.battery.from.category');
  if (entry.stage !== null) return t('configuration.battery.from.stage');
  if (entry.sex !== null) return t('configuration.battery.from.sex');
  return t('configuration.battery.from.club');
}

function scopeText(t: T, entry: BatteryEntryDto, categories: readonly Category[]): string {
  const parts = [
    entry.sex === null ? null : t(`sex.${entry.sex}`),
    entry.stage === null ? null : stageLabel(t, entry.stage),
    entry.categoryId === null
      ? null
      : (categories.find((c) => c.id === entry.categoryId)?.name ?? entry.categoryId),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? t('configuration.battery.sportWide') : parts.join(' · ');
}

/**
 * Whether the test may be scheduled for the stage (and the category's age
 * band): the domain's principle 3 check, the same the API runs.
 */
function allowedForStage(test: CatalogTest, stage: Stage, category: Category | null): boolean {
  const ageBand =
    category === null
      ? null
      : (DEFAULT_AGE_BANDS.find((band) => band.code === category.ageBandCode) ?? null);
  try {
    validateBatteryStage({ stage, maximalLoad: test.maximalLoad, ageBand });
    return true;
  } catch (error) {
    if (error instanceof BatteryEntryValidationError) return false;
    throw error;
  }
}

/** The cell of the matrix being looked at: a stage of the branch, maybe of one category. */
interface Cell {
  readonly testCode: string;
  readonly stage: Stage;
  readonly sex: Sex;
  readonly categoryId: CategoryId | null;
  /** `sex` of an entry that reaches only this branch: `null` when the sport has one branch. */
  readonly sexForNew: Sex | null;
}

/**
 * Whether the entry is the cell's own, so editing it changes nothing else:
 * same test, stage and category, and it reaches no other branch. A stage
 * entry without a sex reaches every branch of the sport, so it is only the
 * cell's own when the club runs a single branch of it.
 */
export function isOwnEntry(entry: BatteryEntryDto, cell: Cell): boolean {
  if (entry.testCode !== cell.testCode) return false;
  if (entry.stage !== cell.stage || entry.categoryId !== cell.categoryId) return false;
  // A category belongs to one branch: its entries reach no other, with or without a sex.
  if (cell.categoryId !== null) return true;
  return entry.sex === cell.sex || (entry.sex === null && cell.sexForNew === null);
}

/** What the editor changes: a test for a stage (and category) of the matrix. */
interface EditTarget {
  readonly testCode: string;
  readonly stage: Stage | null;
  readonly sex: Sex | null;
  readonly categoryId: CategoryId | null;
  /** The entry the change replaces (current) or edits (planned); `null` creates one. */
  readonly base: BatteryEntryDto | null;
  /** The broader entry the cell inherits today, if any. */
  readonly inherited: BatteryEntryDto | null;
  readonly initial: Schedule;
}

export function BatterySection(props: {
  sport: Sport;
  sex: Sex;
  /** Branches (sexes) of the sport the club runs, whatever the user is assigned to. */
  branches: readonly Sex[];
  category: Category | null;
  canEdit: boolean;
}) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const today = useClubToday();
  const { selection, categories } = active;
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [saved, setSaved] = useState(false);
  const categoryId = props.category?.id ?? null;

  const tests = useQuery(catalogTestsQuery(api, selection, props.sport));
  const effective = useQueries({
    queries: STAGES.map((stage) =>
      effectiveBatteryQuery(api, selection, {
        sport: props.sport,
        sex: props.sex,
        stage,
        categoryId,
      }),
    ),
  });
  const entries = useQuery(batteryEntriesQuery(api, selection, props.sport));

  // A new entry names the branch only when the club runs more than one of the sport.
  const sexForNew = new Set(props.branches).size > 1 ? props.sex : null;
  const cellOf = (testCode: string, stage: Stage): Cell => ({
    testCode,
    stage,
    sex: props.sex,
    categoryId,
    sexForNew,
  });

  const planned = (entries.data ?? []).filter((entry) => validityPhase(entry, today) === 'planned');
  /** The first planned entry of the cell's own scope, by start date. */
  const plannedOf = (cell: Cell): BatteryEntryDto | undefined =>
    planned
      .filter((entry) => isOwnEntry(entry, cell))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];

  const failed = tests.error ?? effective.find((query) => query.error !== null)?.error ?? null;
  const byStage = new Map<Stage, EffectiveBattery>();
  STAGES.forEach((stage, index) => {
    const data = effective[index]?.data;
    if (data !== undefined) byStage.set(stage, data);
  });

  const open = (target: EditTarget) => {
    setSaved(false);
    setEditing(target);
  };
  const done = () => {
    setEditing(null);
    setSaved(true);
  };

  const openCell = (test: CatalogTest, stage: Stage) => {
    const resolved = byStage
      .get(stage)
      ?.tests.find((candidate) => candidate.testCode === test.code);
    const entry = resolved?.entry ?? null;
    const cell = cellOf(test.code, stage);
    if (entry !== null && isOwnEntry(entry, cell)) {
      open({
        testCode: test.code,
        stage,
        sex: entry.sex,
        categoryId,
        base: entry,
        inherited: null,
        initial: entry,
      });
      return;
    }
    // Without a current entry of its own, a planned one of the cell is what to edit:
    // a new entry would overlap it.
    const ownPlanned = plannedOf(cell);
    open({
      testCode: test.code,
      stage,
      sex: ownPlanned?.sex ?? sexForNew,
      categoryId,
      base: ownPlanned ?? null,
      inherited: entry,
      initial: ownPlanned ?? {
        windows: resolved?.windows ?? [],
        cadenceWeeks: resolved?.cadenceWeeks ?? null,
      },
    });
  };

  return (
    <section className="sp-card" aria-labelledby="battery-title">
      <h2 id="battery-title" className="sp-card__title">
        {t('configuration.battery.title')}
      </h2>
      <p className="sp-field__help">{t('configuration.battery.help')}</p>
      {saved ? (
        <Notice level="ok" role="status">
          <p>{t('configuration.saved')}</p>
        </Notice>
      ) : null}
      {failed !== null ? (
        <ErrorNotice error={failed} />
      ) : tests.data === undefined || byStage.size < STAGES.length ? (
        <Loading />
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table sp-matrix">
            <caption className="sp-visually-hidden">{t('configuration.battery.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('configuration.battery.test')}</th>
                {STAGES.map((stage) => (
                  <th key={stage} scope="col">
                    {stageLabel(t, stage)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tests.data.map((test) => (
                <tr key={test.code}>
                  <th scope="row">
                    <span>{testLabel(t, test.code)}</span>
                    {test.maximalLoad ? (
                      <span className="sp-tag sp-matrix__tag">
                        {t('configuration.battery.maximalLoad')}
                      </span>
                    ) : null}
                    {test.inForce ? null : (
                      <StatusLabel level="warning">
                        {t('configuration.battery.notInForce')}
                      </StatusLabel>
                    )}
                  </th>
                  {STAGES.map((stage) => {
                    const resolved = byStage
                      .get(stage)
                      ?.tests.find((candidate) => candidate.testCode === test.code);
                    const summary = resolved === undefined ? null : scheduleText(t, resolved);
                    const change = plannedOf(cellOf(test.code, stage));
                    const allowed = allowedForStage(test, stage, props.category);
                    const text = summary ?? t('configuration.battery.notDone');
                    return (
                      <td key={stage}>
                        {props.canEdit && allowed ? (
                          <button
                            type="button"
                            className={`sp-matrix__cell${summary === null ? '' : ' sp-matrix__cell--on'}`}
                            aria-expanded={
                              editing?.testCode === test.code && editing.stage === stage
                            }
                            onClick={() => {
                              openCell(test, stage);
                            }}
                          >
                            <span>{text}</span>
                            <span className="sp-visually-hidden">
                              {`: ${t('configuration.battery.editCell', {
                                test: testLabel(t, test.code),
                                stage: stageLabel(t, stage),
                              })}`}
                            </span>
                          </button>
                        ) : (
                          <span className="sp-matrix__value">{text}</span>
                        )}
                        {!allowed ? (
                          <span className="sp-matrix__note">
                            {t('configuration.battery.maximalLoadNotAllowed')}
                          </span>
                        ) : resolved === undefined ? null : (
                          <span className="sp-matrix__note">{sourceText(t, resolved.entry)}</span>
                        )}
                        {change === undefined ? null : (
                          <span className="sp-matrix__note">
                            {t('configuration.battery.plannedChange', {
                              from: formatLocalDate(change.validFrom),
                            })}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing === null ? null : (
        <BatteryEditor
          key={`${editing.testCode}:${editing.stage ?? ''}:${editing.base?.id ?? 'new'}`}
          target={editing}
          sport={props.sport}
          today={today}
          onCancel={() => {
            setEditing(null);
          }}
          onDone={done}
        />
      )}

      <h3 className="sp-config__subtitle">{t('configuration.battery.entries.title')}</h3>
      <p className="sp-field__help">{t('configuration.battery.entries.help')}</p>
      {entries.error !== null ? (
        <ErrorNotice error={entries.error} />
      ) : entries.data === undefined ? (
        <Loading />
      ) : entries.data.length === 0 ? (
        <p>{t('configuration.battery.entries.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">
              {t('configuration.battery.entries.title')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('configuration.battery.test')}</th>
                <th scope="col">{t('configuration.battery.entries.scope')}</th>
                <th scope="col">{t('configuration.battery.entries.schedule')}</th>
                <th scope="col">{t('configuration.validity')}</th>
                <th scope="col">{t('configuration.rules.state')}</th>
                {props.canEdit ? <th scope="col">{t('configuration.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.data.map((entry) => {
                const phase = validityPhase(entry, today);
                return (
                  <tr key={entry.id}>
                    <td>{testLabel(t, entry.testCode)}</td>
                    <td>{scopeText(t, entry, categories)}</td>
                    <td>{scheduleText(t, entry) ?? t('configuration.battery.notDone')}</td>
                    <td>{validityText(t, entry)}</td>
                    <td>
                      <PhaseLabel phase={phase} t={t} />
                    </td>
                    {props.canEdit ? (
                      <td>
                        {phase === 'ended' ? null : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              open({
                                testCode: entry.testCode,
                                stage: entry.stage,
                                sex: entry.sex,
                                categoryId: entry.categoryId,
                                base: entry,
                                inherited: null,
                                initial: entry,
                              });
                            }}
                          >
                            {t('common.edit')}
                            <span className="sp-visually-hidden">
                              {` ${testLabel(t, entry.testCode)} · ${scopeText(t, entry, categories)}`}
                            </span>
                          </Button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const WINDOW_OPTIONS = TEST_WINDOW_NUMBERS.map((number) => number);

function BatteryEditor(props: {
  target: EditTarget;
  sport: Sport;
  today: LocalDate;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection, categories } = useActiveClub();
  const { target, today } = props;
  const base = target.base;
  const phase = base === null ? null : validityPhase(base, today);

  const [windows, setWindows] = useState<TestWindowNumber[]>(
    target.initial.windows.filter((n): n is TestWindowNumber =>
      (TEST_WINDOW_NUMBERS as readonly number[]).includes(n),
    ),
  );
  const [continuous, setContinuous] = useState(target.initial.cadenceWeeks !== null);
  const [minText, setMinText] = useState(String(target.initial.cadenceWeeks?.min ?? 4));
  const [maxText, setMaxText] = useState(String(target.initial.cadenceWeeks?.max ?? 6));
  const [fromText, setFromText] = useState<string>(
    phase === 'planned' && base !== null ? base.validFrom : today,
  );
  const [stopText, setStopText] = useState<string>(today);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const finish = async () => {
    await invalidateConfiguration(queryClient, selection);
    props.onDone();
  };

  const save = useMutation({
    mutationFn: async (input: {
      windows: TestWindowNumber[];
      cadenceWeeks: { min: number; max: number } | null;
      validFrom: LocalDate;
      clientUuid: string;
    }) => {
      if (base !== null && phase === 'planned') {
        return api.updateBatteryEntry({
          params: { batteryEntryId: base.id },
          body: {
            version: base.version,
            windows: input.windows,
            cadenceWeeks: input.cadenceWeeks,
            validFrom: input.validFrom,
          },
        });
      }
      return api.createBatteryEntry({
        body: {
          clientUuid: input.clientUuid,
          sport: props.sport,
          sex: target.sex,
          stage: target.stage,
          categoryId: target.categoryId,
          testCode: target.testCode,
          windows: input.windows,
          cadenceWeeks: input.cadenceWeeks,
          validFrom: input.validFrom,
          // A current entry of the same scope closes the day the new one starts.
          ...(base === null ? {} : { closePrevious: true }),
        },
      });
    },
    onSuccess: finish,
  });

  const stop = useMutation({
    mutationFn: (validTo: LocalDate) => {
      if (base === null) throw new Error('Nothing to stop');
      return api.updateBatteryEntry({
        params: { batteryEntryId: base.id },
        body: { version: base.version, validTo },
      });
    },
    onSuccess: finish,
  });

  const archive = useMutation({
    mutationFn: () => {
      if (base === null) throw new Error('Nothing to archive');
      return api.archiveBatteryEntry({ params: { batteryEntryId: base.id } });
    },
    onSuccess: finish,
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    let cadenceWeeks: { min: number; max: number } | null = null;
    if (continuous) {
      const min = parseInteger(minText);
      const max = parseInteger(maxText);
      const inRange = (value: number | null) =>
        value !== null && value >= 1 && value <= MAX_BATTERY_CADENCE_WEEKS;
      if (!inRange(min)) next.min = t('configuration.integerInvalid');
      if (!inRange(max)) next.max = t('configuration.integerInvalid');
      else if (min !== null && max !== null && max < min) {
        next.max = t('configuration.battery.cadenceInvalid');
      }
      if (min !== null && max !== null) cadenceWeeks = { min, max };
    }
    if (windows.length === 0 && !continuous) {
      next.schedule = t('configuration.battery.scheduleRequired');
    }
    const validFrom = parseDateInput(fromText);
    if (validFrom === null) next.from = t('configuration.dateRequired');
    else if (validFrom < today) next.from = t('configuration.dateFromToday');
    setErrors(next);
    if (Object.keys(next).length > 0 || validFrom === null) return;
    save.mutate({ windows, cadenceWeeks, validFrom, clientUuid: newClientUuid() });
  };

  const submitStop = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validTo = parseDateInput(stopText);
    if (validTo === null) {
      setErrors({ stop: t('configuration.dateRequired') });
      return;
    }
    if (validTo < today) {
      setErrors({ stop: t('configuration.dateFromToday') });
      return;
    }
    setErrors({});
    stop.mutate(validTo);
  };

  const test = testLabel(t, target.testCode);
  const where =
    target.stage === null ? t('configuration.battery.sportWide') : stageLabel(t, target.stage);
  const categoryName =
    target.categoryId === null
      ? null
      : (categories.find((c) => c.id === target.categoryId)?.name ?? null);
  const busy = save.isPending || stop.isPending || archive.isPending;
  const failure = save.error ?? stop.error ?? archive.error;

  return (
    <section className="sp-config__editor" aria-labelledby="battery-editor-title">
      <h3 id="battery-editor-title" className="sp-config__subtitle">
        {t('configuration.battery.editor.title', {
          test,
          stage: categoryName === null ? where : `${where} · ${categoryName}`,
        })}
      </h3>
      <p>
        {base === null
          ? t('configuration.battery.editor.new')
          : phase === 'planned'
            ? t('configuration.battery.editor.planned')
            : t('configuration.battery.editor.current')}
      </p>
      {target.inherited === null ? null : (
        <Notice level="info">
          <p>
            {t('configuration.battery.editor.inherited', {
              scope: scopeText(t, target.inherited, categories),
            })}
          </p>
          <p>{t('configuration.battery.editor.cannotExclude')}</p>
        </Notice>
      )}
      {failure === null ? null : <ErrorNotice error={failure} />}
      <form className="sp-form" onSubmit={submit} noValidate>
        <CheckboxGroup
          legend={t('configuration.battery.windowsLegend')}
          options={WINDOW_OPTIONS.map((number) => ({
            value: number,
            label: t('configuration.battery.window', { number }),
          }))}
          value={windows}
          onChange={setWindows}
          disabled={busy}
        />
        <CheckboxField
          label={t('configuration.battery.continuous')}
          checked={continuous}
          disabled={busy}
          onChange={(event) => {
            setContinuous(event.currentTarget.checked);
          }}
        />
        {continuous ? (
          <div className="sp-form__row">
            <TextField
              label={t('configuration.battery.cadenceMin')}
              inputMode="numeric"
              value={minText}
              error={errors.min}
              disabled={busy}
              onChange={(event) => {
                setMinText(event.currentTarget.value);
              }}
            />
            <TextField
              label={t('configuration.battery.cadenceMax')}
              inputMode="numeric"
              value={maxText}
              error={errors.max}
              disabled={busy}
              onChange={(event) => {
                setMaxText(event.currentTarget.value);
              }}
            />
          </div>
        ) : null}
        {errors.schedule === undefined ? null : (
          <Notice level="warning" role="alert">
            <p>{errors.schedule}</p>
          </Notice>
        )}
        <TextField
          label={t('configuration.validFrom')}
          type="date"
          min={today}
          value={fromText}
          error={errors.from}
          disabled={busy}
          onChange={(event) => {
            setFromText(event.currentTarget.value);
          }}
        />
        <div className="sp-form__actions">
          <Button type="submit" disabled={busy}>
            {t('configuration.battery.save')}
          </Button>
          {base !== null && phase === 'planned' ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                archive.mutate();
              }}
            >
              {t('configuration.battery.archive')}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
      {base !== null && phase === 'current' ? (
        <form className="sp-form sp-config__stop" onSubmit={submitStop} noValidate>
          <TextField
            label={t('configuration.battery.stopFrom')}
            type="date"
            min={today}
            value={stopText}
            error={errors.stop}
            disabled={busy}
            onChange={(event) => {
              setStopText(event.currentTarget.value);
            }}
          />
          <div className="sp-form__actions">
            <Button type="submit" variant="secondary" disabled={busy}>
              {t('configuration.battery.stop')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
