import type { SyncOperationRequest } from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import { formatLocalDate, formatNumber, formatUnit } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { AnthroCategory } from '../anthropometry/data.ts';
import {
  FIELD_MAX,
  canSave,
  correctionInput,
  draftOf,
  fieldsFor,
  parseDraft,
  plausibilityOf,
  type AnthroField,
  type DayMeasurement,
  type DraftTexts,
  type FieldProblem,
  type MeasurementValues,
  type ParsedDraft,
  type SquadPlayer,
} from '../anthropometry/model.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  PendingMark,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Screens of the field anthropometry (B-508, ADR 0083): presentational, fed
 * by the route with what the local database and the cached reads hold, so
 * they are tested without a device. Each player's row keeps its own draft;
 * saving hands the values to the route, which queues them.
 */

/** Short measures on the sheet: one decimal at most, no thousands separator. */
const formatMeasure = (value: number) => formatNumber(value, { maxDecimals: 1, grouping: false });

const PROBLEM_MESSAGES = {
  number: 'anthropometry.error.number',
  range: 'anthropometry.error.range',
  sittingAboveHeight: 'anthropometry.error.sittingAboveHeight',
} as const satisfies Record<FieldProblem, string>;

const FIELD_LABELS = {
  heightCm: 'anthropometry.column.heightCm',
  sittingHeightCm: 'anthropometry.column.sittingHeightCm',
  weightKg: 'anthropometry.column.weightKg',
  skinfoldsSumMm: 'anthropometry.column.skinfoldsSumMm',
} as const satisfies Record<AnthroField, string>;

// ─── Category ───────────────────────────────────────────────────────────────────────

export type CategoriesState =
  | { readonly status: 'loading' }
  /** Nothing kept on the phone and no signal (or the read failed). */
  | { readonly status: 'missing'; readonly message: string | null }
  | { readonly status: 'ready'; readonly categories: readonly AnthroCategory[] };

export function AnthropometryCategoriesScreen({
  state,
  offline,
  sync,
  onSelect,
}: {
  readonly state: CategoriesState;
  readonly offline: boolean;
  readonly sync?: ReactNode;
  readonly onSelect: (categoryId: string) => void;
}) {
  const { t } = useTranslator();
  if (state.status === 'loading') return <LoadingView label={t('common.loading')} />;
  return (
    <ScreenBody header={<ScreenHeader title={t('anthropometry.field.open')} />}>
      <AppText role="bodySmall" tone="secondary">
        {t('anthropometry.field.subtitle')}
      </AppText>
      {sync}
      {offline ? (
        <StatusMessage level="warning">{t('anthropometry.field.offline')}</StatusMessage>
      ) : null}
      {state.status === 'missing' ? (
        <StatusMessage level="warning">
          {state.message ?? t('anthropometry.field.noContext')}
        </StatusMessage>
      ) : state.categories.length === 0 ? (
        <StatusMessage level="warning">{t('anthropometry.field.noCategories')}</StatusMessage>
      ) : (
        <>
          <AppText role="bodyStrong">{t('anthropometry.field.pickCategory')}</AppText>
          {state.categories.map((category) => (
            <Button
              key={category.id}
              variant="secondary"
              label={category.name}
              onPress={() => {
                onSelect(category.id);
              }}
            />
          ))}
        </>
      )}
    </ScreenBody>
  );
}

// ─── Sheet ──────────────────────────────────────────────────────────────────────────

export type SquadState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing'; readonly message: string | null }
  | {
      readonly status: 'ready';
      readonly players: readonly SquadPlayer[];
      /** When the squad was read from the server (epoch ms). */
      readonly savedAt: number;
    };

export interface SheetProps {
  readonly categoryName: string;
  readonly measuredOn: LocalDate;
  readonly squad: SquadState;
  readonly measurements: ReadonlyMap<string, DayMeasurement>;
  readonly offline: boolean;
  readonly refreshing: boolean;
  /** Formats when the squad was saved, in the club's time zone. */
  readonly formatSavedAt: (epochMs: number) => string;
  readonly sync?: ReactNode;
  readonly onChangeCategory: () => void;
  /** Queues the measurement of a player; rejects when the phone could not keep it. */
  readonly onSave: (playerId: string, values: MeasurementValues) => Promise<void>;
  readonly onCorrect: (input: SyncOperationRequest<'anthro.update'>) => Promise<void>;
}

export function AnthropometrySheetScreen(props: SheetProps) {
  const { t } = useTranslator();
  const { squad } = props;
  return (
    <ScreenBody
      header={
        <ScreenHeader
          title={t('anthropometry.field.sheetTitle', {
            category: props.categoryName,
            date: formatLocalDate(props.measuredOn),
          })}
        />
      }
    >
      <Button
        variant="link"
        label={t('anthropometry.field.changeCategory')}
        onPress={props.onChangeCategory}
      />
      {props.sync}
      {props.offline ? (
        <StatusMessage level="warning">{t('anthropometry.field.offline')}</StatusMessage>
      ) : null}
      {props.refreshing ? (
        <AppText role="bodySmall" tone="secondary">
          {t('anthropometry.field.refreshing')}
        </AppText>
      ) : null}
      {squad.status === 'loading' ? (
        <AppText role="bodySmall" tone="secondary">
          {t('common.loading')}
        </AppText>
      ) : squad.status === 'missing' ? (
        <StatusMessage level="warning">
          {squad.message ?? t('anthropometry.field.noSquad')}
        </StatusMessage>
      ) : (
        <>
          <AppText role="caption" tone="secondary">
            {t('anthropometry.field.squadSavedOn', { date: props.formatSavedAt(squad.savedAt) })}
          </AppText>
          {squad.players.length === 0 ? (
            <StatusMessage level="warning">{t('anthropometry.sheet.empty')}</StatusMessage>
          ) : (
            squad.players.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                measuredOn={props.measuredOn}
                measurement={props.measurements.get(player.id) ?? null}
                onSave={props.onSave}
                onCorrect={props.onCorrect}
              />
            ))
          )}
        </>
      )}
    </ScreenBody>
  );
}

function PlayerRow({
  player,
  measuredOn,
  measurement,
  onSave,
  onCorrect,
}: {
  readonly player: SquadPlayer;
  readonly measuredOn: LocalDate;
  readonly measurement: DayMeasurement | null;
  readonly onSave: SheetProps['onSave'];
  readonly onCorrect: SheetProps['onCorrect'];
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [texts, setTexts] = useState<DraftTexts>({});
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<'reasonRequired' | 'nothingChanged' | null>(null);
  const fields = fieldsFor(player);
  const draft = parseDraft(texts, player);

  const editing = measurement === null || correcting;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await task();
      setTexts({});
      setReason('');
      setCorrecting(false);
      setNotice(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    void run(() => onSave(player.id, draft.values));
  };
  const saveCorrection = () => {
    if (measurement === null) return;
    if (reason.trim() === '') {
      setNotice('reasonRequired');
      return;
    }
    const input = correctionInput(
      measurement.target,
      measurement.values,
      draft.values,
      fields,
      reason,
    );
    if (input === null) {
      setNotice('nothingChanged');
      return;
    }
    void run(() => onCorrect(input));
  };

  return (
    <Card title={player.name}>
      {player.blocked ? (
        <StatusMessage level="critical">{t('anthropometry.blocked')}</StatusMessage>
      ) : null}
      {!player.blocked && player.parentHeightsMissing ? (
        <StatusMessage level="warning">
          {t('anthropometry.gap.parent_heights_missing')}
        </StatusMessage>
      ) : null}
      {!player.blocked && player.stage === null ? (
        <StatusMessage level="warning">{t('anthropometry.field.stageUnknown')}</StatusMessage>
      ) : null}
      {measurement !== null && !correcting ? <SavedMeasurement measurement={measurement} /> : null}
      {player.blocked || !editing ? null : (
        <DraftFields
          player={player}
          fields={fields}
          texts={texts}
          draft={draft}
          measuredOn={measuredOn}
          onChange={(field, text) => {
            setTexts((current) => ({ ...current, [field]: text }));
            setNotice(null);
          }}
        />
      )}
      {correcting ? (
        <TextField
          label={t('anthropometry.field.reason')}
          hint={t('anthropometry.field.reasonHint')}
          value={reason}
          onChangeText={(text) => {
            setReason(text);
            setNotice(null);
          }}
          error={notice === 'reasonRequired' ? t('anthropometry.field.reasonRequired') : null}
        />
      ) : null}
      {notice === 'nothingChanged' ? (
        <StatusMessage level="warning">{t('anthropometry.field.nothingChanged')}</StatusMessage>
      ) : null}
      {failed ? (
        <StatusMessage level="critical">{t('anthropometry.field.saveFailed')}</StatusMessage>
      ) : null}
      {player.blocked ? null : measurement === null ? (
        <Button
          label={t('anthropometry.field.save')}
          accessibilityLabel={t('anthropometry.field.saveA11y', { player: player.name })}
          disabled={!canSave(draft, player)}
          busy={busy}
          onPress={save}
        />
      ) : correcting ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('anthropometry.field.saveCorrection')}
            disabled={draft.touched && Object.keys(draft.problems).length > 0}
            busy={busy}
            onPress={saveCorrection}
          />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            onPress={() => {
              setCorrecting(false);
              setTexts({});
              setReason('');
              setNotice(null);
            }}
          />
        </View>
      ) : (
        <Button
          variant="secondary"
          label={t('anthropometry.field.correct')}
          accessibilityLabel={t('anthropometry.field.correctA11y', { player: player.name })}
          onPress={() => {
            setTexts(draftOf(measurement.values, formatMeasure));
            setCorrecting(true);
          }}
        />
      )}
    </Card>
  );
}

function DraftFields({
  player,
  fields,
  texts,
  draft,
  measuredOn,
  onChange,
}: {
  readonly player: SquadPlayer;
  readonly fields: readonly AnthroField[];
  readonly texts: DraftTexts;
  readonly draft: ParsedDraft;
  readonly measuredOn: LocalDate;
  readonly onChange: (field: AnthroField, text: string) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const warnings = plausibilityOf(player, draft.values, measuredOn);
  return (
    <>
      {fields.map((field) => {
        const problem = draft.problems[field];
        const warning = warnings.find((w) => w.field === field);
        const label = t(FIELD_LABELS[field]);
        return (
          <View key={field} style={{ gap: theme.spacing.xs }}>
            <TextField
              label={t('anthropometry.input.label', { field: label, player: player.name })}
              value={texts[field] ?? ''}
              onChangeText={(text) => {
                onChange(field, text);
              }}
              error={
                problem === undefined
                  ? null
                  : problem === 'range'
                    ? t('anthropometry.error.range', {
                        max: formatMeasure(FIELD_MAX[field]),
                      })
                    : t(PROBLEM_MESSAGES[problem])
              }
              inputProps={{ keyboardType: 'decimal-pad', inputMode: 'decimal' }}
            />
            {warning === undefined ? null : (
              <>
                <StatusMessage level="warning">
                  {t(`anthropometry.plausibility.${warning.status}`, {
                    min: formatMeasure(warning.minValue),
                    max: formatMeasure(warning.maxValue),
                  })}
                </StatusMessage>
                {warning.suggestedValues.map((value) => (
                  <Button
                    key={value}
                    variant="link"
                    label={t('anthropometry.field.useSuggestion', { value: formatMeasure(value) })}
                    accessibilityLabel={t('anthropometry.plausibility.suggestion', {
                      value: formatMeasure(value),
                    })}
                    onPress={() => {
                      onChange(field, formatMeasure(value));
                    }}
                  />
                ))}
              </>
            )}
          </View>
        );
      })}
    </>
  );
}

function SavedMeasurement({ measurement }: { readonly measurement: DayMeasurement }) {
  const { t } = useTranslator();
  const { maturation } = measurement;
  return (
    <>
      {(Object.keys(FIELD_LABELS) as AnthroField[]).map((field) => {
        const value = measurement.values[field];
        if (value === null) return null;
        return (
          <AppText key={field} role="body">
            {t('anthropometry.field.value', {
              field: t(FIELD_LABELS[field]),
              value: formatMeasure(value),
            })}
          </AppText>
        );
      })}
      {measurement.sync === 'synced' ? null : (
        <PendingMark accessibilityLabel={t(`anthropometry.field.state.${measurement.sync}`)} />
      )}
      {maturation === null ? (
        <AppText role="bodySmall" tone="secondary">
          {t('anthropometry.field.maturation.later')}
        </AppText>
      ) : maturation.derivedAt === null ? (
        <AppText role="bodySmall" tone="secondary">
          {t('anthropometry.field.maturation.computing')}
        </AppText>
      ) : maturation.phvOffsetYears === null && maturation.adultHeightPct === null ? (
        <AppText role="bodySmall" tone="secondary">
          {t('anthropometry.field.maturation.none')}
        </AppText>
      ) : (
        <>
          {maturation.phvOffsetYears === null ||
          maturation.maturityOffsetEquation === null ? null : (
            <AppText role="bodySmall">
              {t('anthropometry.field.maturation.offset', {
                value: formatNumber(maturation.phvOffsetYears, { decimals: 1, sign: 'always' }),
                equation: t(`anthropometry.equation.${maturation.maturityOffsetEquation}`),
              })}
            </AppText>
          )}
          {maturation.adultHeightPct === null ||
          maturation.predictedAdultHeightCm === null ? null : (
            <AppText role="bodySmall">
              {t('anthropometry.field.maturation.adultHeight', {
                pct: formatUnit(maturation.adultHeightPct, 'pct'),
                predicted: formatMeasure(maturation.predictedAdultHeightCm),
              })}
            </AppText>
          )}
        </>
      )}
    </>
  );
}
