import {
  EXTERNAL_LOAD_ACTIVITIES,
  EXTERNAL_LOAD_DETAIL_MAX_LENGTH,
  EXTERNAL_LOAD_MINUTES_MAX,
  EXTERNAL_LOAD_MINUTES_MIN,
  EXTERNAL_LOAD_RPE_MAX,
  EXTERNAL_LOAD_RPE_MIN,
  addDays,
  type ExternalLoadActivity,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate, formatNumber, isMessageKey } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  MINUTES_PRESETS,
  draftLoadAu,
  draftOf,
  draftProblems,
  emptyDraft,
  externalLoadTotal,
  reportableDays,
  type ExternalLoadDraft,
  type ExternalLoadItem,
  type ExternalLoadItemState,
} from '../external-load/model.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, Card, ScreenBody, StatusMessage, TextField } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * External load (B-511, ADR 0084): the player reports what they trained
 * outside the club in a few taps (type, day, minutes, CR-10 RPE), corrects
 * it with a reason or deletes it. Presentation only: the route writes
 * through the offline queue and passes the activities of the week.
 */

const RPE_VALUES = Array.from(
  { length: EXTERNAL_LOAD_RPE_MAX - EXTERNAL_LOAD_RPE_MIN + 1 },
  (_, i) => EXTERNAL_LOAD_RPE_MIN + i,
);

/** One option of a single-choice group: a radio with a 44 pt target and a visible focus. */
function Choice({
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        minWidth: theme.sizes.touchTarget,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : selected
            ? theme.colors.brand.solid
            : theme.colors.border.strong,
        backgroundColor: selected ? theme.colors.brand.solid : theme.colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={[
          theme.text.button,
          { color: selected ? theme.colors.brand.onSolid : theme.colors.text.primary },
        ]}
      >
        {/* The check mark says "chosen" without color (CLAUDE.md). */}
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

function ChoiceGroup({
  label,
  error,
  children,
}: {
  readonly label: string;
  readonly error: string | null;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText role="bodyStrong">{label}</AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
      >
        {children}
      </View>
      {error === null ? null : <StatusMessage level="critical">{error}</StatusMessage>}
    </View>
  );
}

const STATE_LEVEL: Readonly<Record<ExternalLoadItemState, 'ok' | 'warning'>> = {
  local: 'warning',
  pending: 'warning',
  synced: 'ok',
};

export function ExternalLoadScreen({
  today,
  timeZoneKnown,
  items,
  sync,
  onReport,
  onCorrect,
  onArchive,
}: {
  /** Today in the club's zone. */
  readonly today: LocalDate;
  /** `false` while the club's zone is not known yet (the phone's is used). */
  readonly timeZoneKnown: boolean;
  /** The activities of the week (`externalLoadItems`). */
  readonly items: readonly ExternalLoadItem[];
  /** The sync indicator. */
  readonly sync?: ReactNode;
  readonly onReport: (draft: ExternalLoadDraft) => Promise<void>;
  readonly onCorrect: (
    item: ExternalLoadItem,
    draft: ExternalLoadDraft,
    reason: string,
  ) => Promise<'saved' | 'unchanged'>;
  readonly onArchive: (item: ExternalLoadItem) => Promise<void>;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [draft, setDraft] = useState<ExternalLoadDraft>(() => emptyDraft(today));
  const [editing, setEditing] = useState<ExternalLoadItem | null>(null);
  const [reason, setReason] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ level: 'ok' | 'critical'; text: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  const problems = draftProblems(draft, today);
  const reasonMissing = editing !== null && reason.trim() === '';
  const load = draftLoadAu(draft);
  const total = externalLoadTotal(items);

  const activityName = (activity: ExternalLoadActivity) => t(`externalLoad.activity.${activity}`);
  const dayName = (day: LocalDate) =>
    day === today
      ? t('externalLoad.day.today')
      : day === addDays(today, -1)
        ? t('externalLoad.day.yesterday')
        : formatLocalDate(day);
  const rpeName = (value: number): string | null => {
    const key = `rpe.scale.${String(value)}`;
    return isMessageKey(key) ? (t as (key: string) => string)(key) : null;
  };
  const update = (patch: Partial<ExternalLoadDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(null);
  };
  const reset = () => {
    setDraft(emptyDraft(today));
    setEditing(null);
    setReason('');
    setShowProblems(false);
  };

  const submit = async () => {
    setShowProblems(true);
    if (Object.keys(problems).length > 0 || reasonMissing) return;
    setBusy(true);
    try {
      if (editing === null) {
        await onReport(draft);
        reset();
        setNotice({ level: 'ok', text: t('externalLoad.saved') });
      } else {
        const outcome = await onCorrect(editing, draft, reason);
        if (outcome === 'unchanged') {
          setNotice({ level: 'critical', text: t('externalLoad.correct.nothing') });
        } else {
          reset();
          setNotice({ level: 'ok', text: t('externalLoad.corrected') });
        }
      }
    } catch {
      setNotice({ level: 'critical', text: t('externalLoad.saveFailed') });
    } finally {
      setBusy(false);
    }
  };

  const archive = async (item: ExternalLoadItem) => {
    if (confirmArchive !== item.key) {
      setConfirmArchive(item.key);
      return;
    }
    setConfirmArchive(null);
    try {
      await onArchive(item);
      if (editing?.key === item.key) reset();
      setNotice({ level: 'ok', text: t('externalLoad.archived') });
    } catch {
      setNotice({ level: 'critical', text: t('externalLoad.saveFailed') });
    }
  };

  const shown = (field: keyof typeof problems, message: string) =>
    showProblems && problems[field] !== undefined ? message : null;
  const minutesValue = draft.minutesText.trim();
  const presetChosen = MINUTES_PRESETS.some((m) => String(m) === minutesValue);

  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {editing === null ? t('externalLoad.title') : t('externalLoad.correct.title')}
      </AppText>
      <AppText tone="secondary">{t('externalLoad.intro')}</AppText>
      {timeZoneKnown ? null : (
        <StatusMessage level="warning">{t('externalLoad.timeZoneUnknown')}</StatusMessage>
      )}
      {sync}
      {notice === null ? null : <StatusMessage level={notice.level}>{notice.text}</StatusMessage>}

      <Card>
        <ChoiceGroup
          label={t('externalLoad.activity.label')}
          error={shown('activity', t('externalLoad.activity.missing'))}
        >
          {EXTERNAL_LOAD_ACTIVITIES.map((activity) => (
            <Choice
              key={activity}
              label={activityName(activity)}
              selected={draft.activity === activity}
              onPress={() => {
                update({ activity });
              }}
            />
          ))}
        </ChoiceGroup>
        <TextField
          label={t('externalLoad.detail.label')}
          hint={t('externalLoad.detail.hint')}
          value={draft.detail}
          onChangeText={(detail) => {
            update({ detail });
          }}
          error={shown(
            'detail',
            t('externalLoad.detail.invalid', { max: EXTERNAL_LOAD_DETAIL_MAX_LENGTH }),
          )}
          inputProps={{
            maxLength: EXTERNAL_LOAD_DETAIL_MAX_LENGTH + 10,
            autoCapitalize: 'sentences',
          }}
        />
        <ChoiceGroup
          label={t('externalLoad.day.label')}
          error={shown('day', t('externalLoad.day.missing'))}
        >
          {reportableDays(today).map((day) => (
            <Choice
              key={day}
              label={dayName(day)}
              selected={draft.day === day}
              onPress={() => {
                update({ day });
              }}
            />
          ))}
        </ChoiceGroup>
        <ChoiceGroup label={t('externalLoad.minutes.label')} error={null}>
          {MINUTES_PRESETS.map((minutes) => (
            <Choice
              key={minutes}
              label={t('externalLoad.minutes.option', { minutes })}
              selected={minutesValue === String(minutes)}
              onPress={() => {
                update({ minutesText: String(minutes) });
              }}
            />
          ))}
        </ChoiceGroup>
        <TextField
          label={t('externalLoad.minutes.custom')}
          value={presetChosen ? '' : draft.minutesText}
          onChangeText={(minutesText) => {
            update({ minutesText });
          }}
          error={shown(
            'minutes',
            t('externalLoad.minutes.invalid', {
              min: EXTERNAL_LOAD_MINUTES_MIN,
              max: EXTERNAL_LOAD_MINUTES_MAX,
            }),
          )}
          inputProps={{ keyboardType: 'number-pad', inputMode: 'numeric', maxLength: 3 }}
        />
        <ChoiceGroup
          label={t('externalLoad.rpe.label')}
          error={shown('rpe', t('externalLoad.rpe.missing'))}
        >
          {RPE_VALUES.map((value) => {
            const name = rpeName(value);
            return (
              <Choice
                key={value}
                label={String(value)}
                accessibilityLabel={
                  name === null
                    ? String(value)
                    : t('externalLoad.rpe.option', { value: String(value), name })
                }
                selected={draft.rpe === value}
                onPress={() => {
                  update({ rpe: value });
                }}
              />
            );
          })}
        </ChoiceGroup>
        {draft.rpe === null || rpeName(draft.rpe) === null ? null : (
          <AppText tone="secondary">{rpeName(draft.rpe) ?? ''}</AppText>
        )}
        {load === null ? null : (
          <AppText role="bodyStrong">
            {t('externalLoad.load', { load: formatNumber(load, { decimals: 0 }) })}
          </AppText>
        )}
        {editing === null ? null : (
          <TextField
            label={t('externalLoad.reason.label')}
            hint={t('externalLoad.reason.hint')}
            value={reason}
            onChangeText={setReason}
            error={showProblems && reasonMissing ? t('externalLoad.reason.missing') : null}
          />
        )}
        <Button
          label={editing === null ? t('externalLoad.save') : t('externalLoad.saveCorrection')}
          busy={busy}
          onPress={() => {
            void submit();
          }}
        />
        {editing === null ? null : (
          <Button variant="secondary" label={t('externalLoad.cancel')} onPress={reset} />
        )}
      </Card>

      <Card>
        <AppText role="overline" tone="secondary" accessibilityRole="header">
          {t('externalLoad.list.title')}
        </AppText>
        {items.length === 0 ? (
          <AppText tone="secondary">{t('externalLoad.list.empty')}</AppText>
        ) : (
          <AppText role="bodyStrong">
            {t('externalLoad.list.total', {
              count: total.count,
              load: formatNumber(total.loadAu, { decimals: 0 }),
            })}
          </AppText>
        )}
        {items.map((item) => {
          const activity =
            item.detail === null
              ? activityName(item.activity)
              : `${activityName(item.activity)} (${item.detail})`;
          const day = dayName(item.localDate);
          return (
            <View key={item.key} style={{ gap: theme.spacing.xs }}>
              <AppText role="bodyStrong">{day}</AppText>
              <AppText>
                {t('externalLoad.item', {
                  activity,
                  minutes: item.minutes,
                  rpe: String(item.rpe),
                })}
              </AppText>
              <StatusMessage level={STATE_LEVEL[item.state]}>
                {t(`externalLoad.item.state.${item.state}`)}
              </StatusMessage>
              {confirmArchive === item.key ? (
                <StatusMessage level="warning">{t('externalLoad.archive.confirm')}</StatusMessage>
              ) : null}
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Button
                  variant="link"
                  label={t('externalLoad.correct')}
                  accessibilityLabel={t('externalLoad.correct.for', { activity, day })}
                  onPress={() => {
                    setEditing(item);
                    setDraft(draftOf(item));
                    setReason('');
                    setShowProblems(false);
                    setNotice(null);
                  }}
                />
                <Button
                  variant="link"
                  label={t('externalLoad.archive')}
                  accessibilityLabel={t('externalLoad.archive.for', { activity, day })}
                  onPress={() => {
                    void archive(item);
                  }}
                />
              </View>
            </View>
          );
        })}
      </Card>
      <AppText role="caption" tone="muted">
        {t('legal.notMedicalDevice')}
      </AppText>
    </ScreenBody>
  );
}
