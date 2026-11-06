import type { AttemptAggregation } from '@sport-performance/domain';
import { formatUnit } from '@sport-performance/i18n';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  PendingMark,
  ScreenBody,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';
import {
  CMJ_INPUT_MODES,
  WEEKLY_CMJ_METHODS,
  nextAttemptNumber,
  nextPendingPlayer,
  parseAttempt,
  todayResultFor,
  type CmjAttemptView,
  type CmjResultView,
  type CmjVerdict,
  type ResultTarget,
  type WeeklyCmjRow,
  type WeeklyCmjSettings,
} from '../weekly-cmj/model.ts';

/**
 * The weekly CMJ of M17/M19 (B-506, ADR 0079): presentational, fed by the
 * route with what the local base and the queue hold, so it is tested
 * without a device.
 */

export interface WeeklyCmjProtocol {
  readonly version: number;
  readonly attemptCount: number;
  readonly aggregation: AttemptAggregation;
}

export type WeeklyCmjRosterState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | {
      readonly status: 'ready';
      readonly rows: readonly WeeklyCmjRow[];
      readonly otherStages: number;
      /** When the roster was read from the server, already formatted. */
      readonly savedAt: string;
    };

export type WeeklyCmjSetupState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'no_test' }
  | {
      readonly status: 'ready';
      readonly protocol: WeeklyCmjProtocol;
      readonly categories: readonly { readonly id: string; readonly name: string }[];
    };

const height = (cm: number) => formatUnit(cm, 'cm', { decimals: 1 });
const signedPct = (dropPct: number) =>
  // A drop is shown as a negative change against the baseline.
  formatUnit(-dropPct, 'pct', { decimals: 1, sign: 'always' });

function ChoiceRow({
  label,
  checked,
  onPress,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : theme.colors.border.subtle,
        backgroundColor: checked ? theme.colors.surfaceRaised : 'transparent',
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: theme.borderWidth.thick,
          borderColor: checked ? theme.colors.brand.solid : theme.colors.border.strong,
          backgroundColor: checked ? theme.colors.brand.solid : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Text style={[theme.text.caption, { color: theme.colors.brand.onSolid }]}>✓</Text>
        ) : null}
      </View>
      <Text style={[theme.text.body, { color: theme.colors.text.primary, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

function Choices<T extends string>({
  title,
  hint,
  options,
  value,
  onChange,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.xs }}>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {title}
      </AppText>
      {options.map((option) => (
        <ChoiceRow
          key={option.value}
          label={option.label}
          checked={option.value === value}
          onPress={() => {
            onChange(option.value);
          }}
        />
      ))}
      {hint === undefined ? null : (
        <AppText role="caption" tone="secondary">
          {hint}
        </AppText>
      )}
    </View>
  );
}

function VerdictMessage({ verdict }: { readonly verdict: CmjVerdict }) {
  const { t } = useTranslator();
  switch (verdict.kind) {
    case 'compared': {
      const values = {
        pct: signedPct(verdict.dropPct),
        baseline: height(verdict.baselineHeightCm),
      };
      return (
        <StatusMessage level={verdict.severity}>
          {t(`weeklyCmj.verdict.${verdict.severity}`, values)}
        </StatusMessage>
      );
    }
    case 'no_baseline':
      return (
        <AppText role="bodySmall" tone="secondary">
          {t('weeklyCmj.verdict.noBaseline', { samples: verdict.samples, min: verdict.minSamples })}
        </AppText>
      );
    case 'no_rule':
      return (
        <AppText role="bodySmall" tone="secondary">
          {t('weeklyCmj.verdict.noRule')}
        </AppText>
      );
  }
}

function attemptText(attempt: CmjAttemptView): string {
  const value = attempt.heightCm === null ? '—' : height(attempt.heightCm);
  return attempt.flightTimeMs === null
    ? value
    : `${value} (${formatUnit(attempt.flightTimeMs, 'msec', { decimals: 0 })})`;
}

function AttemptLine({
  attempt,
  index,
  onVoid,
}: {
  readonly attempt: CmjAttemptView;
  readonly index: number;
  readonly onVoid: ((reason: string) => Promise<void>) | null;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const number = attempt.attemptNumber ?? index + 1;
  const label = t('weeklyCmj.attempt.label', { number });
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText role="bodySmall">
        {`${label}: ${attemptText(attempt)}`}
        {attempt.counts ? ` · ✓ ${t('weeklyCmj.attempt.counts')}` : ''}
      </AppText>
      {attempt.voidedReason === null ? null : (
        <AppText role="caption" tone="secondary">
          {t('weeklyCmj.attempt.voided', { reason: attempt.voidedReason })}
        </AppText>
      )}
      {attempt.voidedReason !== null || onVoid === null ? null : reason === null ? (
        <Button
          variant="link"
          label={t('weeklyCmj.attempt.void', { number })}
          onPress={() => {
            setReason(t('weeklyCmj.attempt.void.defaultReason'));
          }}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          <TextField
            label={t('weeklyCmj.attempt.void.reason')}
            hint={t('weeklyCmj.attempt.void.hint')}
            value={reason}
            onChangeText={setReason}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button
              label={t('weeklyCmj.attempt.void.confirm')}
              busy={busy}
              disabled={reason.trim() === ''}
              onPress={() => {
                setBusy(true);
                onVoid(reason.trim())
                  .then(() => {
                    setReason(null);
                  })
                  .catch(() => undefined)
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            />
            <Button
              variant="secondary"
              label={t('common.cancel')}
              onPress={() => {
                setReason(null);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function EntryPanel({
  row,
  settings,
  protocol,
  onRecord,
  onVoid,
  onClose,
}: {
  readonly row: WeeklyCmjRow;
  readonly settings: WeeklyCmjSettings;
  readonly protocol: WeeklyCmjProtocol;
  readonly onRecord: (row: WeeklyCmjRow, values: readonly number[]) => Promise<void>;
  readonly onVoid: (target: ResultTarget, entryId: string, reason: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const existing: CmjResultView | null = todayResultFor(row, settings.method);
  const fields = existing === null ? protocol.attemptCount : 1;
  const firstNumber = nextAttemptNumber(existing);
  const [drafts, setDrafts] = useState<string[]>(() => Array.from({ length: fields }, () => ''));
  const [submitted, setSubmitted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const parsed = drafts.map((draft) => parseAttempt(draft, settings.mode, row.player.sex));
  const typed = parsed.flatMap((p) => (p.status === 'ok' ? [p] : []));
  const invalid = parsed.some((p) => p.status === 'invalid');
  const implausible = typed.filter((p) => p.implausible);
  const name = `${row.player.firstName} ${row.player.lastName}`;

  const save = () => {
    setSubmitted(true);
    if (invalid || typed.length === 0) return;
    if (implausible.length > 0 && !confirmed) return;
    setSaving(true);
    setSaveError(false);
    onRecord(
      row,
      typed.map((p) => p.value),
    )
      .then(() => {
        setDrafts(Array.from({ length: 1 }, () => ''));
        setSubmitted(false);
        setConfirmed(false);
      })
      .catch(() => {
        setSaveError(true);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {row.today.map((result) => (
        <View key={'id' in result.target ? result.target.id : result.target.clientUuid}>
          {result.attempts.map((attempt, index) => (
            <AttemptLine
              key={attempt.id}
              attempt={attempt}
              index={index}
              onVoid={(reason) => onVoid(result.target, attempt.id, reason)}
            />
          ))}
        </View>
      ))}
      {drafts.map((draft, index) => {
        const p = parsed[index];
        const number = firstNumber + index;
        return (
          <TextField
            key={`${String(number)}-${String(index)}`}
            label={`${t('weeklyCmj.attempt.label', { number })} · ${t(`weeklyCmj.mode.${settings.mode}`)}`}
            value={draft}
            onChangeText={(text) => {
              setDrafts((current) => current.map((value, i) => (i === index ? text : value)));
              setConfirmed(false);
            }}
            error={submitted && p?.status === 'invalid' ? t('weeklyCmj.attempt.invalid') : null}
            inputProps={{ keyboardType: 'decimal-pad', accessibilityHint: name }}
          />
        );
      })}
      {submitted && typed.length === 0 && !invalid ? (
        <StatusMessage level="warning">{t('weeklyCmj.attempt.none')}</StatusMessage>
      ) : null}
      {submitted && implausible.length > 0 && !confirmed ? (
        <>
          <StatusMessage level="warning">
            {t('weeklyCmj.attempt.implausible', {
              height: implausible.map((p) => height(p.heightCm)).join(', '),
            })}
          </StatusMessage>
          <Button
            variant="secondary"
            label={t('weeklyCmj.attempt.saveAnyway')}
            onPress={() => {
              setConfirmed(true);
            }}
          />
        </>
      ) : null}
      {saveError ? (
        <StatusMessage level="critical">{t('weeklyCmj.saveError')}</StatusMessage>
      ) : null}
      <Button
        label={t('weeklyCmj.save')}
        accessibilityLabel={`${t('weeklyCmj.save')}: ${name}`}
        busy={saving}
        onPress={save}
      />
      <Button variant="link" label={t('weeklyCmj.player.close')} onPress={onClose} />
    </View>
  );
}

function PlayerCard({
  row,
  selected,
  settings,
  protocol,
  onSelect,
  onRecord,
  onVoid,
  onClose,
}: {
  readonly row: WeeklyCmjRow;
  readonly selected: boolean;
  readonly settings: WeeklyCmjSettings;
  readonly protocol: WeeklyCmjProtocol;
  readonly onSelect: () => void;
  readonly onRecord: (row: WeeklyCmjRow, values: readonly number[]) => Promise<void>;
  readonly onVoid: (target: ResultTarget, entryId: string, reason: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslator();
  const { player, baseline } = row;
  const name = `${player.firstName} ${player.lastName}`;
  const weeks = Math.round((row.rule?.params.baselineWindowDays ?? 42) / 7);
  return (
    <Card>
      <AppText role="bodyStrong" accessibilityRole="header">
        {name}
      </AppText>
      {player.availability === 'unavailable' ? (
        <StatusMessage level="critical">{t('weeklyCmj.player.unavailable')}</StatusMessage>
      ) : player.availability === 'limited' ? (
        <StatusMessage level="warning">{t('weeklyCmj.player.limited')}</StatusMessage>
      ) : null}
      <AppText role="bodySmall" tone="secondary">
        {baseline.heightCm === null
          ? t('weeklyCmj.baseline.none', { samples: baseline.samples, min: baseline.minSamples })
          : t('weeklyCmj.baseline', {
              height: height(baseline.heightCm),
              count: baseline.samples,
              weeks,
            })}
      </AppText>
      {row.otherMethodDays > 0 ? (
        <AppText role="caption" tone="secondary">
          {t('weeklyCmj.baseline.otherMethod', { count: row.otherMethodDays })}
        </AppText>
      ) : null}
      <AppText role="bodySmall">
        {row.todayHeightCm === null
          ? t('weeklyCmj.today.none')
          : t('weeklyCmj.today', { height: height(row.todayHeightCm) })}
      </AppText>
      {row.sync === 'queued' ? <PendingMark /> : null}
      {row.today.length > 1 ? (
        <AppText role="caption" tone="secondary">
          {t('weeklyCmj.today.many', { count: row.today.length })}
        </AppText>
      ) : null}
      {row.verdict === null ? null : <VerdictMessage verdict={row.verdict} />}
      {selected ? (
        <EntryPanel
          row={row}
          settings={settings}
          protocol={protocol}
          onRecord={onRecord}
          onVoid={onVoid}
          onClose={onClose}
        />
      ) : (
        <Button
          variant="secondary"
          label={t(
            row.today.length === 0 ? 'weeklyCmj.player.record' : 'weeklyCmj.player.addAttempt',
            {
              name,
            },
          )}
          onPress={onSelect}
        />
      )}
    </Card>
  );
}

export function WeeklyCmjScreen({
  setup,
  roster,
  settings,
  offline,
  refreshing,
  refreshFailed,
  onRefresh,
  onChangeSettings,
  onRecord,
  onVoid,
}: {
  readonly setup: WeeklyCmjSetupState;
  readonly roster: WeeklyCmjRosterState | null;
  readonly settings: WeeklyCmjSettings;
  readonly offline: boolean;
  readonly refreshing: boolean;
  readonly refreshFailed: boolean;
  readonly onRefresh: () => void;
  readonly onChangeSettings: (settings: WeeklyCmjSettings) => void;
  readonly onRecord: (row: WeeklyCmjRow, values: readonly number[]) => Promise<void>;
  readonly onVoid: (target: ResultTarget, entryId: string, reason: string) => Promise<void>;
}) {
  const { t } = useTranslator();
  const [selected, setSelected] = useState<string | null>(null);

  const header = (
    <>
      <AppText role="title" accessibilityRole="header">
        {t('weeklyCmj.title')}
      </AppText>
      <AppText tone="secondary">{t('weeklyCmj.body')}</AppText>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {refreshFailed && !offline ? (
        <StatusMessage level="warning">{t('weeklyCmj.setup.error')}</StatusMessage>
      ) : null}
    </>
  );

  if (setup.status !== 'ready') {
    return (
      <ScreenBody>
        {header}
        {setup.status === 'loading' ? (
          <LoadingView label={t('weeklyCmj.setup.loading')} />
        ) : (
          <>
            <StatusMessage level="warning">
              {t(setup.status === 'no_test' ? 'weeklyCmj.setup.noTest' : 'weeklyCmj.setup.missing')}
            </StatusMessage>
            <Button
              variant="secondary"
              label={t('weeklyCmj.refresh')}
              busy={refreshing}
              disabled={offline}
              onPress={onRefresh}
            />
          </>
        )}
      </ScreenBody>
    );
  }

  const { protocol, categories } = setup;
  const rows = roster?.status === 'ready' ? roster.rows : [];
  const done = rows.filter((row) => row.today.length > 0).length;
  const next = nextPendingPlayer(rows, selected);

  return (
    <ScreenBody>
      {header}
      <AppText role="bodySmall" tone="secondary">
        {t('weeklyCmj.protocol', {
          version: protocol.version,
          count: protocol.attemptCount,
          aggregation: protocol.aggregation,
        })}
      </AppText>
      <Card>
        {categories.length === 0 ? (
          <StatusMessage level="warning">{t('weeklyCmj.category.none')}</StatusMessage>
        ) : (
          <Choices
            title={t('weeklyCmj.category')}
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
            value={settings.categoryId}
            onChange={(categoryId) => {
              setSelected(null);
              onChangeSettings({ ...settings, categoryId });
            }}
          />
        )}
        <Choices
          title={t('weeklyCmj.method')}
          hint={t('weeklyCmj.method.hint')}
          options={WEEKLY_CMJ_METHODS.map((method) => ({
            value: method,
            label: t(`method.${method}`),
          }))}
          value={settings.method}
          onChange={(method) => {
            onChangeSettings({ ...settings, method });
          }}
        />
        <Choices
          title={t('weeklyCmj.mode')}
          options={CMJ_INPUT_MODES.map((mode) => ({
            value: mode,
            label: t(`weeklyCmj.mode.${mode}`),
          }))}
          value={settings.mode}
          onChange={(mode) => {
            onChangeSettings({ ...settings, mode });
          }}
        />
      </Card>

      {settings.categoryId === null ? (
        <AppText tone="secondary">{t('weeklyCmj.category.pick')}</AppText>
      ) : roster === null || roster.status === 'loading' ? (
        <LoadingView label={t('weeklyCmj.setup.loading')} />
      ) : roster.status === 'missing' ? (
        <StatusMessage level="warning">{t('weeklyCmj.setup.missing')}</StatusMessage>
      ) : (
        <>
          <AppText role="caption" tone="secondary">
            {t('weeklyCmj.savedAt', { date: roster.savedAt })}
          </AppText>
          <Button
            variant="link"
            label={t('weeklyCmj.refresh')}
            busy={refreshing}
            disabled={offline}
            onPress={onRefresh}
          />
          {rows.length === 0 ? (
            <AppText tone="secondary">{t('weeklyCmj.roster.empty')}</AppText>
          ) : (
            <>
              <AppText role="bodyStrong">
                {t('weeklyCmj.progress', { done, total: rows.length })}
              </AppText>
              {next === null ? (
                done === rows.length ? (
                  <StatusMessage level="ok">{t('weeklyCmj.allDone')}</StatusMessage>
                ) : null
              ) : (
                <Button
                  variant="secondary"
                  label={t('weeklyCmj.next')}
                  onPress={() => {
                    setSelected(next);
                  }}
                />
              )}
            </>
          )}
          {roster.otherStages > 0 ? (
            <AppText role="caption" tone="secondary">
              {t('weeklyCmj.roster.otherStages', { count: roster.otherStages })}
            </AppText>
          ) : null}
          {rows.map((row) => (
            <PlayerCard
              key={row.player.playerId}
              row={row}
              selected={selected === row.player.playerId}
              settings={settings}
              protocol={protocol}
              onSelect={() => {
                setSelected(row.player.playerId);
              }}
              onRecord={onRecord}
              onVoid={onVoid}
              onClose={() => {
                setSelected(null);
              }}
            />
          ))}
        </>
      )}
    </ScreenBody>
  );
}
