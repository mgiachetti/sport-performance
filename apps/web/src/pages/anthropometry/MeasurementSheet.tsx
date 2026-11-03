import type {
  AnthroMeasurementInput,
  AnthroPreview,
  AnthroPreviewReference,
  Category,
  Player,
} from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import {
  formatLocalDate,
  formatNumber,
  formatUnit,
  type MessageKey,
  type Translator,
} from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { translate, useT } from '../../i18n/i18n';
import { canOnCategoryPlayers } from '../../permissions/permissions';
import { Button, ErrorNotice, Notice } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { ParentHeightsForm } from './ParentHeightsForm';
import { anthropometryKey, previewQuery } from './queries';
import {
  FIELD_MAX,
  SHEET_FIELDS,
  hasProblems,
  hasValues,
  newDraft,
  parseRow,
  previewPayload,
  rowIssues,
  savePayload,
  type FieldProblem,
  type IssueTarget,
  type ParsedRow,
  type RowDraft,
  type SheetField,
} from './sheet-model';

/** Wait after the last keystroke before asking the API for the maturation. */
export const PREVIEW_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}

const PROBLEM_MESSAGES: Record<FieldProblem, MessageKey> = {
  number: 'anthropometry.error.number',
  range: 'anthropometry.error.range',
  sittingAboveHeight: 'anthropometry.error.sittingAboveHeight',
};

const COLUMN_KEYS: Record<SheetField, MessageKey> = {
  heightCm: 'anthropometry.column.heightCm',
  sittingHeightCm: 'anthropometry.column.sittingHeightCm',
  weightKg: 'anthropometry.column.weightKg',
  skinfoldsSumMm: 'anthropometry.column.skinfoldsSumMm',
};

/**
 * One line per set of coefficients behind what the sheet shows that is not
 * verified against the original publication (the Khamis-Roche table of the
 * club and each maturity-offset equation used), with its status.
 */
export function unverifiedCoefficients(
  t: Translator['t'],
  reference: AnthroPreviewReference | undefined,
  items: readonly AnthroPreview[],
): string[] {
  const status = (value: NonNullable<AnthroPreview['maturityOffsetVerification']>) =>
    translate(t, `anthropometry.verification.status.${value}`);
  const lines: string[] = [];
  if (
    reference !== undefined &&
    reference !== null &&
    reference.verification !== 'verified_against_publication'
  ) {
    lines.push(
      t('anthropometry.verification.khamisRoche', { status: status(reference.verification) }),
    );
  }
  const equations = new Map<
    NonNullable<AnthroPreview['maturityOffsetEquation']>,
    NonNullable<AnthroPreview['maturityOffsetVerification']>
  >();
  for (const item of items) {
    const verification = item.maturityOffsetVerification;
    if (
      item.maturityOffsetEquation !== null &&
      verification !== null &&
      verification !== 'verified_against_publication'
    ) {
      equations.set(item.maturityOffsetEquation, verification);
    }
  }
  for (const [equation, verification] of [...equations].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      t('anthropometry.verification.offset', {
        equation: translate(t, `anthropometry.equation.${equation}`),
        status: status(verification),
      }),
    );
  }
  return lines;
}

export function playerName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${player.firstName} ${player.lastName}`;
}

/**
 * The sheet of a measurement day (B-412): one row per player of the
 * category, the values typed in es-AR, and the maturation of each row
 * computed by the API while typing (the same function the worker stores).
 */
export function MeasurementSheet(props: {
  category: Category;
  players: readonly Player[];
  measuredOn: LocalDate;
  /** The date field holds a rejected date: `measuredOn` is the last valid one, never saved. */
  dateInvalid?: boolean;
}) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [openParents, setOpenParents] = useState<string | null>(null);
  const [parentsSaved, setParentsSaved] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly AnthroMeasurementInput[]>([]);

  const rows = useMemo(
    () => props.players.map((player) => parseRow(player.id, drafts[player.id])),
    [props.players, drafts],
  );
  const preview = previewPayload(rows, props.measuredOn);
  // Query keys hash by content: the same rows typed again hit the cache.
  const debounced = useDebounced(JSON.stringify(preview), PREVIEW_DEBOUNCE_MS);
  const previewRows = useMemo(() => JSON.parse(debounced) as typeof preview, [debounced]);
  const previewResult = useQuery(previewQuery(api, active.selection, previewRows));
  const items = new Map(
    (previewResult.data?.items ?? []).map((item) => [item.playerId as string, item]),
  );
  const reference = previewResult.data?.reference;
  const unverified = unverifiedCoefficients(t, reference, [...items.values()]);

  const canReportParents = canOnCategoryPlayers(active.subject, 'parent_height', 'report', [
    props.category,
  ]);
  const performance =
    props.category.defaultStage === 'performance' ||
    [...items.values()].some((item) => item.stage === 'performance');

  const save = useMutation({
    mutationFn: (measurements: AnthroMeasurementInput[]) =>
      api.recordAnthroMeasurements({ body: { measurements } }),
    onSuccess: async (result) => {
      setSaved(result.measurements.length);
      setDrafts({});
      setSent([]);
      await queryClient.invalidateQueries({ queryKey: anthropometryKey(active.selection) });
    },
  });
  const issues = rowIssues(save.error, sent);

  const toSave = rows.filter(hasValues);
  const dateInvalid = props.dateInvalid ?? false;
  const blocking = dateInvalid || rows.some(hasProblems);

  function setValue(playerId: string, field: SheetField, text: string) {
    setSaved(null);
    setDrafts((current) => {
      const draft = current[playerId] ?? newDraft();
      return { ...current, [playerId]: { ...draft, values: { ...draft.values, [field]: text } } };
    });
  }

  function onSave() {
    setSaved(null);
    if (blocking || toSave.length === 0) return;
    const measurements = savePayload(rows, drafts, props.measuredOn);
    setSent(measurements);
    save.mutate(measurements);
  }

  const fields = SHEET_FIELDS.filter((field) => field !== 'skinfoldsSumMm' || performance);

  return (
    <section className="sp-card" aria-labelledby="anthro-sheet-title">
      <h2 id="anthro-sheet-title" className="sp-card__title">
        {t('anthropometry.sheet.title')}
      </h2>
      {reference === null ? (
        <Notice level="info">
          <p>{t('anthropometry.reference.none')}</p>
        </Notice>
      ) : null}
      {unverified.length === 0 ? null : (
        <Notice level="warning">
          <p>{t('anthropometry.verification.title')}</p>
          <ul>
            {unverified.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Notice>
      )}
      {previewResult.error === null ? null : <ErrorNotice error={previewResult.error} />}
      {props.players.length === 0 ? (
        <p>{t('anthropometry.sheet.empty')}</p>
      ) : (
        <div className="sp-anthro__scroll">
          <table className="sp-anthro__table">
            <caption>
              {t('anthropometry.sheet.caption', {
                category: props.category.name,
                date: formatLocalDate(props.measuredOn),
              })}
              {previewResult.isFetching ? (
                <span className="sp-anthro__fetching" role="status">
                  <Icon name="sync" /> {t('anthropometry.sheet.previewing')}
                </span>
              ) : null}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('anthropometry.column.player')}</th>
                {fields.map((field) => (
                  <th key={field} scope="col">
                    {t(COLUMN_KEYS[field])}
                  </th>
                ))}
                <th scope="col">{t('anthropometry.column.phvOffset')}</th>
                <th scope="col">{t('anthropometry.column.adultHeight')}</th>
                <th scope="col">{t('anthropometry.column.growthVelocity')}</th>
              </tr>
            </thead>
            <tbody>
              {props.players.map((player, index) => {
                const row = rows[index];
                if (row === undefined) return null;
                return (
                  <SheetRow
                    key={player.id}
                    player={player}
                    row={row}
                    draft={drafts[player.id]}
                    fields={fields}
                    preview={items.get(player.id)}
                    issues={issues?.get(player.id) ?? {}}
                    onChange={(field, text) => {
                      setValue(player.id, field, text);
                    }}
                    parentsOpen={openParents === player.id}
                    onToggleParents={
                      canReportParents
                        ? () => {
                            setOpenParents((open) => (open === player.id ? null : player.id));
                          }
                        : undefined
                    }
                    onParentsSaved={() => {
                      setOpenParents(null);
                      setParentsSaved(playerName(player));
                    }}
                    columnCount={fields.length + 4}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {parentsSaved === null ? null : (
        <Notice level="ok" role="status">
          <p>{t('anthropometry.parents.saved', { player: parentsSaved })}</p>
        </Notice>
      )}
      {saved === null ? null : (
        <Notice level="ok" role="status">
          <p>{t('anthropometry.sheet.saved', { count: saved })}</p>
        </Notice>
      )}
      {save.error === null ? null : issues === null ? (
        <ErrorNotice error={save.error} />
      ) : (
        <Notice level="critical" role="alert">
          <p>{t('anthropometry.sheet.rejected')}</p>
        </Notice>
      )}
      {dateInvalid ? (
        <Notice level="warning">
          <p>{t('anthropometry.sheet.fixDate')}</p>
        </Notice>
      ) : blocking ? (
        <Notice level="warning">
          <p>{t('anthropometry.sheet.fixFirst')}</p>
        </Notice>
      ) : null}
      <div className="sp-form__secondary">
        <Button
          onClick={onSave}
          disabled={save.isPending || blocking || toSave.length === 0}
          aria-describedby={toSave.length === 0 ? 'anthro-nothing' : undefined}
        >
          {save.isPending
            ? t('anthropometry.sheet.saving')
            : t('anthropometry.sheet.save', { count: toSave.length })}
        </Button>
        {toSave.length === 0 ? (
          <p id="anthro-nothing" className="sp-field__help">
            {t('anthropometry.sheet.nothingToSave')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SheetRow(props: {
  player: Player;
  row: ParsedRow;
  draft: RowDraft | undefined;
  fields: readonly SheetField[];
  preview: AnthroPreview | undefined;
  issues: Partial<Record<IssueTarget, MessageKey>>;
  onChange: (field: SheetField, text: string) => void;
  parentsOpen: boolean;
  onToggleParents: (() => void) | undefined;
  onParentsSaved: () => void;
  columnCount: number;
}) {
  const t = useT();
  const name = playerName(props.player);
  const preview = props.preview;
  const blocked = preview?.blockedBy === 'consent_required';
  const notPerformance = preview !== undefined && preview.stage !== 'performance';
  const missingParents = preview?.gaps.adultHeight.includes('parent_heights_missing') ?? false;
  const rowIssue = props.issues.playerId ?? props.issues.measuredOn;

  return (
    <>
      <tr aria-invalid={rowIssue === undefined ? undefined : true}>
        <th scope="row">
          <span className="sp-anthro__name">{name}</span>
          {preview?.ageYears === null || preview?.ageYears === undefined ? null : (
            <span className="sp-anthro__meta">
              {t('anthropometry.value.age', {
                age: formatNumber(preview.ageYears, { decimals: 1 }),
              })}
            </span>
          )}
          {blocked ? (
            <span className="sp-anthro__status sp-anthro__status--warning">
              <Icon name="warning" /> {t('anthropometry.blocked')}
            </span>
          ) : null}
          {rowIssue === undefined ? null : (
            <span className="sp-anthro__status sp-anthro__status--critical">
              <Icon name="critical" /> {t(rowIssue)}
            </span>
          )}
        </th>
        {props.fields.map((field) => (
          <td key={field}>
            <ValueInput
              field={field}
              playerName={name}
              text={props.draft?.values[field] ?? ''}
              problem={props.row.problems[field]}
              issue={props.issues[field]}
              plausibility={preview?.plausibility.find((p) => p.field === field)}
              disabled={blocked || (field === 'skinfoldsSumMm' && notPerformance)}
              onChange={(text) => {
                props.onChange(field, text);
              }}
            />
          </td>
        ))}
        <td>
          <MaturationCell
            touched={props.row.touched}
            value={
              preview?.phvOffsetYears === null || preview?.phvOffsetYears === undefined
                ? null
                : t('anthropometry.value.offset', {
                    value: formatNumber(preview.phvOffsetYears, { decimals: 1, sign: 'always' }),
                  })
            }
            detail={
              preview?.maturityOffsetEquation === null ||
              preview?.maturityOffsetEquation === undefined
                ? null
                : translate(t, `anthropometry.equation.${preview.maturityOffsetEquation}`)
            }
            gaps={preview?.gaps.phvOffset ?? []}
          />
        </td>
        <td>
          <MaturationCell
            touched={props.row.touched}
            value={
              preview?.adultHeightPct === null || preview?.adultHeightPct === undefined
                ? null
                : t('anthropometry.value.adultHeight', {
                    pct: formatUnit(preview.adultHeightPct, 'pct'),
                    predicted: formatUnit(preview.predictedAdultHeightCm, 'cm'),
                  })
            }
            detail={null}
            // Missing parents is actionable before measuring: shown even on an empty row.
            gaps={preview?.gaps.adultHeight ?? []}
            alwaysShow={['parent_heights_missing']}
          />
          {missingParents && props.onToggleParents !== undefined ? (
            <Button
              variant="ghost"
              className="sp-anthro__inline-action"
              aria-expanded={props.parentsOpen}
              onClick={props.onToggleParents}
            >
              {t('anthropometry.parents.action')}
            </Button>
          ) : null}
        </td>
        <td>
          {preview?.growthVelocityCmYear === null || preview?.growthVelocityCmYear === undefined
            ? '—'
            : formatUnit(preview.growthVelocityCmYear, 'cm_year')}
        </td>
      </tr>
      {props.parentsOpen ? (
        <tr className="sp-anthro__expanded">
          <td colSpan={props.columnCount}>
            <ParentHeightsForm
              player={props.player}
              onSaved={props.onParentsSaved}
              onCancel={() => {
                props.onToggleParents?.();
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ValueInput(props: {
  field: SheetField;
  playerName: string;
  text: string;
  problem: FieldProblem | undefined;
  issue: MessageKey | undefined;
  plausibility: AnthroPreview['plausibility'][number] | undefined;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const t = useT();
  const id = `anthro-${props.field}-${props.playerName.replace(/\W+/g, '-')}`;
  const error =
    props.problem === undefined
      ? props.issue === undefined
        ? null
        : t(props.issue)
      : props.problem === 'range'
        ? t('anthropometry.error.range', {
            max: formatNumber(FIELD_MAX[props.field], { maxDecimals: 0 }),
          })
        : t(PROBLEM_MESSAGES[props.problem]);
  const warning = props.plausibility;
  const describedBy = error !== null ? `${id}-error` : warning ? `${id}-warning` : undefined;
  return (
    <div className="sp-anthro__cell">
      <input
        id={id}
        className="sp-field__input sp-anthro__input"
        inputMode="decimal"
        autoComplete="off"
        aria-label={t('anthropometry.input.label', {
          field: t(COLUMN_KEYS[props.field]),
          player: props.playerName,
        })}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy}
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {error === null ? null : (
        <p id={`${id}-error`} className="sp-field__error">
          <Icon name="critical" />
          <span>{error}</span>
        </p>
      )}
      {error === null && warning !== undefined ? (
        <div id={`${id}-warning`} className="sp-anthro__status sp-anthro__status--warning">
          <Icon name="warning" />
          <span>
            {t(
              warning.status === 'below'
                ? 'anthropometry.plausibility.below'
                : 'anthropometry.plausibility.above',
              {
                min: formatNumber(warning.minValue, { maxDecimals: 1 }),
                max: formatNumber(warning.maxValue, { maxDecimals: 1 }),
              },
            )}
          </span>
          {warning.suggestedValues.slice(0, 1).map((value) => {
            const text = formatNumber(value, { maxDecimals: 2, grouping: false });
            return (
              <Button
                key={value}
                variant="ghost"
                className="sp-anthro__inline-action"
                onClick={() => {
                  props.onChange(text);
                }}
              >
                {t('anthropometry.plausibility.suggestion', { value: text })}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MaturationCell(props: {
  touched: boolean;
  value: string | null;
  detail: string | null;
  gaps: readonly AnthroPreview['gaps']['phvOffset'][number][];
  alwaysShow?: readonly string[];
}) {
  const t = useT();
  if (props.value !== null) {
    return (
      <div className="sp-anthro__result">
        <span className="sp-anthro__figure">{props.value}</span>
        {props.detail === null ? null : <span className="sp-anthro__meta">{props.detail}</span>}
      </div>
    );
  }
  const shown = props.touched
    ? props.gaps
    : props.gaps.filter((gap) => props.alwaysShow?.includes(gap) ?? false);
  if (shown.length === 0) return <span aria-label={t('common.noData')}>—</span>;
  return (
    <ul className="sp-anthro__gaps">
      {shown.map((gap) => (
        <li key={gap} className="sp-anthro__status sp-anthro__status--info">
          <Icon name="info" /> {translate(t, `anthropometry.gap.${gap}`)}
        </li>
      ))}
    </ul>
  );
}
