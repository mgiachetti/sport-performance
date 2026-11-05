import type { MenstrualCycleDays, MenstrualCycleStatus } from '@sport-performance/contracts';
import {
  MENSTRUAL_CYCLE_VIEWERS_MAX,
  MENSTRUAL_FLOWS,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  CYCLE_NOTE_MAX_LENGTH,
  CYCLE_SYMPTOMS,
  cycleDraftProblem,
  setFlow,
  setNote,
  toggleSymptom,
  type CycleDraft,
  type CycleScreenState,
} from '../menstrual-cycle/model.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * "Mi ciclo" (B-806, ADR 0092): the player turns tracking on, logs a day in
 * two taps (bleeding and "Guardar"), sees what she logged and decides who
 * else sees it. Presentation only: the route reads the server (nothing of it
 * is kept on the phone) and queues the day.
 */

/** A chip of a single or multiple choice: 44 pt, visible focus, a check mark besides the color. */
function Chip({
  label,
  selected,
  multiple,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly multiple: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={multiple ? { checked: selected } : { checked: selected, selected }}
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
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

function Group({
  label,
  multiple,
  children,
}: {
  readonly label: string;
  readonly multiple: boolean;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText role="bodyStrong">{label}</AppText>
      <View
        accessibilityRole={multiple ? undefined : 'radiogroup'}
        accessibilityLabel={label}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
      >
        {children}
      </View>
    </View>
  );
}

export interface CycleSaved {
  /** Still in the queue of the phone (no connection yet). */
  readonly queued: boolean;
}

export interface MenstrualCycleScreenProps {
  readonly state: CycleScreenState;
  readonly today: LocalDate | null;
  readonly yesterday: LocalDate | null;
  /** The day being logged (today or yesterday). */
  readonly day: LocalDate | null;
  readonly onPickDay: (day: LocalDate) => void;
  readonly days: MenstrualCycleDays | null;
  readonly draft: CycleDraft;
  readonly onChange: (draft: CycleDraft) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly saved: CycleSaved | null;
  readonly error: string | null;
  readonly onStart: () => void;
  readonly onEnd: () => void;
  readonly onAuthorize: (membershipId: string) => void;
  readonly onRevoke: (shareId: string) => void;
  /** A change of the tracking or of who sees it is on its way. */
  readonly busy: boolean;
  readonly settingsError: string | null;
  readonly onRetry: () => void;
}

function Privacy() {
  const { t } = useTranslator();
  return (
    <Card>
      <AppText tone="secondary">{t('cycle.privacy')}</AppText>
      <AppText role="caption" tone="muted">
        {t('cycle.notMedical')}
      </AppText>
    </Card>
  );
}

function Viewers({
  status,
  onAuthorize,
  onRevoke,
  busy,
}: {
  readonly status: MenstrualCycleStatus;
  readonly onAuthorize: (membershipId: string) => void;
  readonly onRevoke: (shareId: string) => void;
  readonly busy: boolean;
}) {
  const { t } = useTranslator();
  const pending = status.candidates.filter((c) => !c.authorized);
  const full = status.viewers.length >= MENSTRUAL_CYCLE_VIEWERS_MAX;
  return (
    <Card title={t('cycle.viewers.title')}>
      {status.viewers.length === 0 ? (
        <AppText>{t('cycle.viewers.none')}</AppText>
      ) : (
        status.viewers.map((viewer) => (
          <View key={viewer.id}>
            <AppText role="bodyStrong">{viewer.name}</AppText>
            <AppText tone="secondary">{t(`cycle.role.${viewer.role}`)}</AppText>
            <Button
              variant="secondary"
              label={t('cycle.viewers.revoke', { name: viewer.name })}
              disabled={busy}
              onPress={() => {
                onRevoke(viewer.id);
              }}
            />
          </View>
        ))
      )}
      <AppText role="bodyStrong">{t('cycle.viewers.candidates')}</AppText>
      {pending.length === 0 ? (
        <AppText tone="secondary">{t('cycle.viewers.noCandidates')}</AppText>
      ) : full ? (
        <StatusMessage level="warning">
          {t('cycle.viewers.max', { max: MENSTRUAL_CYCLE_VIEWERS_MAX })}
        </StatusMessage>
      ) : (
        pending.map((candidate) => (
          <View key={candidate.membershipId}>
            <AppText tone="secondary">{t(`cycle.role.${candidate.role}`)}</AppText>
            <Button
              variant="secondary"
              label={t('cycle.viewers.authorize', { name: candidate.name })}
              disabled={busy}
              onPress={() => {
                onAuthorize(candidate.membershipId);
              }}
            />
          </View>
        ))
      )}
    </Card>
  );
}

function Summary({ days }: { readonly days: MenstrualCycleDays }) {
  const { t } = useTranslator();
  const { summary } = days;
  const lengths = summary.cycleLengthsDays.slice(-3);
  return (
    <Card title={t('cycle.summary.title')}>
      {summary.lastPeriodStart === null || summary.cycleDay === null ? (
        <AppText>{t('cycle.summary.noPeriod')}</AppText>
      ) : (
        <>
          <AppText role="bodyStrong">
            {t('cycle.summary.cycleDay', { day: summary.cycleDay })}
          </AppText>
          <AppText tone="secondary">
            {t('cycle.summary.lastStart', { date: formatLocalDate(summary.lastPeriodStart) })}
          </AppText>
        </>
      )}
      {lengths.length > 0 ? (
        <AppText tone="secondary">
          {t('cycle.summary.lengths', { count: lengths.length, lengths: lengths.join(', ') })}
        </AppText>
      ) : null}
      <AppText role="caption" tone="muted">
        {t('cycle.summary.daysLogged', { count: summary.daysLogged })}
      </AppText>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {t('cycle.history.title')}
      </AppText>
      {days.days.length === 0 ? (
        <AppText tone="secondary">{t('cycle.history.none')}</AppText>
      ) : (
        [...days.days]
          .reverse()
          .slice(0, 14)
          .map((day) => (
            <AppText key={day.id}>
              {t('cycle.history.row', {
                date: formatLocalDate(day.localDate),
                flow: t(`cycle.flow.${day.flow}`),
              })}
            </AppText>
          ))
      )}
    </Card>
  );
}

export function MenstrualCycleScreen(props: MenstrualCycleScreenProps) {
  const { t } = useTranslator();
  const { state, draft } = props;
  const problem = cycleDraftProblem(draft);

  if (state.kind === 'loading') return <LoadingView label={t('cycle.loading')} />;
  if (state.kind === 'error') {
    return (
      <ScreenBody>
        <StatusMessage level="critical">{t('cycle.error')}</StatusMessage>
        <Button label={t('cycle.retry')} onPress={props.onRetry} />
      </ScreenBody>
    );
  }
  if (state.kind === 'offline') {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t('cycle.offline')}</StatusMessage>
        <Button label={t('cycle.retry')} onPress={props.onRetry} />
      </ScreenBody>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t(`cycle.unavailable.${state.reason}`)}</StatusMessage>
        {state.tracking ? (
          <Card>
            <AppText tone="secondary">{t('cycle.end.hint')}</AppText>
            <Button
              variant="secondary"
              label={t('cycle.end')}
              busy={props.busy}
              onPress={props.onEnd}
            />
          </Card>
        ) : null}
        <Privacy />
      </ScreenBody>
    );
  }
  if (state.kind === 'off') {
    return (
      <ScreenBody>
        <Card>
          <AppText role="title" accessibilityRole="header">
            {t('cycle.start.title')}
          </AppText>
          <AppText tone="secondary">{t('cycle.start.hint')}</AppText>
          <Button label={t('cycle.start')} busy={props.busy} onPress={props.onStart} />
        </Card>
        {props.settingsError === null ? null : (
          <StatusMessage level="critical">{props.settingsError}</StatusMessage>
        )}
        <Privacy />
      </ScreenBody>
    );
  }

  return (
    <ScreenBody>
      <Card>
        <AppText role="title" accessibilityRole="header">
          {props.day === null || props.day === props.today
            ? t('cycle.day.title')
            : t('cycle.day.titleOf', { date: formatLocalDate(props.day) })}
        </AppText>
        {props.today !== null && props.yesterday !== null ? (
          <Group label={t('cycle.day.pick')} multiple={false}>
            {(
              [
                [props.today, t('cycle.day.today')],
                [props.yesterday, t('cycle.day.yesterday')],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                multiple={false}
                selected={props.day === value}
                onPress={() => {
                  props.onPickDay(value);
                }}
              />
            ))}
          </Group>
        ) : null}
        <Group label={t('cycle.flow.label')} multiple={false}>
          {MENSTRUAL_FLOWS.map((flow) => (
            <Chip
              key={flow}
              label={t(`cycle.flow.${flow}`)}
              multiple={false}
              selected={draft.flow === flow}
              onPress={() => {
                props.onChange(setFlow(draft, flow));
              }}
            />
          ))}
        </Group>
        <Group label={t('cycle.symptoms.label')} multiple>
          {CYCLE_SYMPTOMS.map((symptom) => (
            <Chip
              key={symptom}
              label={t(`cycle.symptom.${symptom}`)}
              multiple
              selected={draft.symptoms.includes(symptom)}
              onPress={() => {
                props.onChange(toggleSymptom(draft, symptom));
              }}
            />
          ))}
        </Group>
        <TextField
          label={t('cycle.note.label')}
          value={draft.note}
          onChangeText={(note) => {
            props.onChange(setNote(draft, note));
          }}
          hint={t('cycle.note.hint', { max: CYCLE_NOTE_MAX_LENGTH })}
          error={
            problem === 'note_too_long'
              ? t('cycle.note.tooLong', { max: CYCLE_NOTE_MAX_LENGTH })
              : null
          }
          inputProps={{ multiline: true, maxLength: CYCLE_NOTE_MAX_LENGTH * 2 }}
        />
        {problem === 'no_flow' ? (
          <AppText role="caption" tone="secondary">
            {t('cycle.error.flow')}
          </AppText>
        ) : null}
        <Button
          label={t('cycle.save')}
          disabled={problem !== null}
          busy={props.saving}
          onPress={props.onSave}
        />
        {props.saved === null ? null : (
          <StatusMessage level={props.saved.queued ? 'warning' : 'ok'}>
            {props.saved.queued ? t('cycle.queued') : t('cycle.saved')}
          </StatusMessage>
        )}
        {props.error === null ? null : (
          <StatusMessage level="critical">{props.error}</StatusMessage>
        )}
      </Card>
      {props.days === null ? null : <Summary days={props.days} />}
      <Viewers
        status={state.status}
        onAuthorize={props.onAuthorize}
        onRevoke={props.onRevoke}
        busy={props.busy}
      />
      {props.settingsError === null ? null : (
        <StatusMessage level="critical">{props.settingsError}</StatusMessage>
      )}
      <Card>
        <AppText tone="secondary">{t('cycle.end.hint')}</AppText>
        <Button
          variant="secondary"
          label={t('cycle.end')}
          busy={props.busy}
          onPress={props.onEnd}
        />
      </Card>
      <Privacy />
    </ScreenBody>
  );
}
