import type {
  AlertDetailDto,
  AlertEventDto,
  NotificationPreference,
  PanelAlert,
} from '@sport-performance/contracts';
import type { AvailabilityStatus, NotificationKind } from '@sport-performance/domain';
import { alertMessage, formatLocalDate, type Translator } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useState, type ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { PushState } from '../notifications/registration.ts';
import type { Board, BoardPlayer } from '../staff/board.ts';
import { useKeyedState } from '../state/keyed-state.ts';
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
 * Screens of the staff on the phone (B-510, ADR 0081): the quick look before
 * training, an alert with its review, and the notifications of the phone.
 * Presentation only: data and callbacks come by props (the routes read the
 * local database and the API).
 */

const GLYPHS: Readonly<Record<StatusLevel, string>> = { ok: '✓', warning: '!', critical: '✕' };

/**
 * A state inside a row: icon and text, never color alone. Unlike
 * `StatusMessage` it is not announced as it appears (a list of players is
 * not an alert).
 */
function StatusPill({ level, label }: { readonly level: StatusLevel; readonly label: string }) {
  const theme = useTheme();
  const colors = theme.colors.status[level];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.hairline,
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <Text style={[theme.text.caption, { color: colors.fg, fontWeight: '700' }]}>
        {GLYPHS[level]}
      </Text>
      <Text style={[theme.text.caption, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

const AVAILABILITY_LEVEL: Readonly<Record<AvailabilityStatus, StatusLevel>> = {
  available: 'ok',
  limited: 'warning',
  unavailable: 'critical',
};

function availabilityLabel(status: AvailabilityStatus | null, { t }: Translator): string {
  return t(`panel.availability.${status ?? 'unknown'}`);
}

/** The text of an alert, or a generic line for a rule this build does not know. */
export function alertLine(
  alert: Pick<PanelAlert, 'messageKey' | 'values'>,
  translator: Translator,
): string {
  return (
    alertMessage(translator.t, alert.messageKey, alert.values) ??
    translator.t('staff.board.alertUnknown')
  );
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "Actualizado hace 5 minutos": relative, so it needs no time zone. */
export function fetchedText(fetchedAt: number, nowMs: number, { t }: Translator): string {
  const age = Math.max(0, nowMs - fetchedAt);
  const [since, count] =
    age < MINUTE_MS
      ? (['now', 0] as const)
      : age < HOUR_MS
        ? (['minutes', Math.floor(age / MINUTE_MS)] as const)
        : age < DAY_MS
          ? (['hours', Math.floor(age / HOUR_MS)] as const)
          : (['days', Math.floor(age / DAY_MS)] as const);
  return t('staff.fetched', { since, count });
}

/** When the data was read, and whether it is the copy kept on the phone. */
export interface Freshness {
  readonly fetchedAt: number | null;
  readonly fromCache: boolean;
  readonly nowMs: number;
}

function FreshnessLine({ freshness }: { readonly freshness: Freshness }) {
  const translator = useTranslator();
  if (freshness.fetchedAt === null) return null;
  const when = fetchedText(freshness.fetchedAt, freshness.nowMs, translator);
  if (freshness.fromCache) {
    return <StatusMessage level="warning">{`${translator.t('staff.kept')} ${when}`}</StatusMessage>;
  }
  return (
    <AppText role="caption" tone="secondary">
      {when}
    </AppText>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        paddingHorizontal: theme.spacing.md,
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : selected
            ? theme.colors.brand.solid
            : theme.colors.border.strong,
        backgroundColor: selected ? theme.colors.brand.solid : theme.colors.surfaceRaised,
      }}
    >
      <Text
        style={[
          theme.text.bodyStrong,
          { color: selected ? theme.colors.brand.onSolid : theme.colors.text.primary },
        ]}
      >
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

function PlayerRow({
  player,
  onOpenAlert,
}: {
  readonly player: BoardPlayer;
  readonly onOpenAlert: (alertId: string) => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const name = `${player.firstName} ${player.lastName}`;
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.sm,
        borderTopWidth: theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      <AppText role="bodyStrong">{name}</AppText>
      {player.categoryNames.length > 0 ? (
        <AppText role="caption" tone="secondary">
          {player.categoryNames.join(' · ')}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {player.availability !== null && player.availability !== 'available' ? (
          <StatusPill
            level={AVAILABILITY_LEVEL[player.availability]}
            label={availabilityLabel(player.availability, translator)}
          />
        ) : null}
        <StatusPill
          level={player.wellnessToday ? 'ok' : 'warning'}
          label={
            player.wellnessToday ? t('staff.board.wellnessToday') : t('staff.board.wellnessMissing')
          }
        />
      </View>
      {player.alerts.map((alert) => (
        <View key={alert.id} style={{ gap: theme.spacing.xs }}>
          <StatusPill
            level={alert.severity}
            label={t(alert.severity === 'critical' ? 'status.critical' : 'status.warning')}
          />
          <AppText role="bodySmall">{alertLine(alert, translator)}</AppText>
          <Button
            variant="link"
            label={t('staff.board.openAlert')}
            accessibilityLabel={t('staff.board.openAlertOf', { name })}
            onPress={() => {
              onOpenAlert(alert.id);
            }}
          />
        </View>
      ))}
    </View>
  );
}

function CountsSummary({ board }: { readonly board: Board }) {
  const { t } = useTranslator();
  const theme = useTheme();
  const { counts } = board;
  const items: { level: StatusLevel; label: string; show: boolean }[] = [
    {
      level: 'critical',
      label: t('staff.board.count.unavailable', { count: counts.unavailable }),
      show: counts.unavailable > 0,
    },
    {
      level: 'critical',
      label: t('staff.board.count.critical', { count: counts.critical }),
      show: counts.critical > 0,
    },
    {
      level: 'warning',
      label: t('staff.board.count.limited', { count: counts.limited }),
      show: counts.limited > 0,
    },
    {
      level: 'warning',
      label: t('staff.board.count.warning', { count: counts.warning }),
      show: counts.warning > 0,
    },
    {
      level: 'warning',
      label: t('staff.board.count.missingWellness', { count: counts.missingWellness }),
      show: counts.missingWellness > 0,
    },
  ];
  const shown = items.filter((item) => item.show);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t('staff.board.counts')}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
    >
      {shown.length === 0 ? (
        <StatusPill level="ok" label={t('staff.board.allClear')} />
      ) : (
        shown.map((item) => <StatusPill key={item.label} level={item.level} label={item.label} />)
      )}
    </View>
  );
}

export interface BoardCategory {
  readonly id: string;
  readonly name: string;
}

/** The quick look before training. */
export function StaffBoardScreen({
  board,
  loading,
  error,
  freshness,
  categories,
  categoryId,
  sessionFilter,
  push,
  onSelectCategory,
  onOpenAlert,
  onRetry,
  onEnablePush,
}: {
  /** `null` while nothing is loaded yet or it failed. */
  readonly board: Board | null;
  readonly loading: boolean;
  /** What to say when the API failed and the phone keeps nothing. */
  readonly error: string | null;
  readonly freshness: Freshness;
  readonly categories: readonly BoardCategory[];
  readonly categoryId: string | null;
  /** Opened from the summary before training: the session's title (`''` without one). */
  readonly sessionFilter: string | null;
  /** The pushes of this phone, to offer turning them on. */
  readonly push: PushState;
  readonly onSelectCategory: (categoryId: string | null) => void;
  readonly onOpenAlert: (alertId: string) => void;
  readonly onRetry: () => void;
  readonly onEnablePush: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  if (loading && board === null) return <LoadingView label={t('staff.board.loading')} />;
  const offerPush = push.status === 'needsPermission';
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('staff.board.title')}
      </AppText>
      <AppText tone="secondary">{t('staff.board.subtitle')}</AppText>
      <FreshnessLine freshness={freshness} />
      {board?.stale === true ? (
        <StatusMessage level="warning">
          {t('staff.board.stale', { date: formatLocalDate(board.panelDay) })}
        </StatusMessage>
      ) : null}
      {offerPush ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('staff.push.prompt.title')}
          </AppText>
          <AppText role="bodySmall">{t('staff.push.prompt.body')}</AppText>
          <Button
            variant="secondary"
            label={t('staff.push.enable')}
            busy={push.busy}
            onPress={onEnablePush}
          />
        </Card>
      ) : null}
      {board === null ? (
        <>
          <StatusMessage level="critical">{error ?? t('error.generic')}</StatusMessage>
          <Button variant="secondary" label={t('staff.retry')} onPress={onRetry} />
        </>
      ) : (
        <>
          {categories.length > 1 ? (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('staff.board.categories')}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
            >
              <Chip
                label={t('staff.board.allCategories')}
                selected={categoryId === null}
                onPress={() => {
                  onSelectCategory(null);
                }}
              />
              {categories.map((category) => (
                <Chip
                  key={category.id}
                  label={category.name}
                  selected={categoryId === category.id}
                  onPress={() => {
                    onSelectCategory(category.id);
                  }}
                />
              ))}
            </View>
          ) : null}
          {sessionFilter !== null ? (
            <AppText role="bodySmall" tone="secondary">
              {sessionFilter === ''
                ? t('staff.board.fromSummary')
                : t('staff.board.fromSummaryTitle', { title: sessionFilter })}
            </AppText>
          ) : null}
          {board.counts.players === 0 ? (
            <StatusMessage level="ok">{t('staff.board.empty')}</StatusMessage>
          ) : (
            <>
              <CountsSummary board={board} />
              {board.attention.length > 0 ? (
                <Card>
                  <AppText role="overline" tone="secondary" accessibilityRole="header">
                    {t('staff.board.attention')}
                  </AppText>
                  {board.attention.map((player) => (
                    <PlayerRow key={player.playerId} player={player} onOpenAlert={onOpenAlert} />
                  ))}
                </Card>
              ) : null}
              {board.missingWellness.length > 0 ? (
                <Card>
                  <AppText role="overline" tone="secondary" accessibilityRole="header">
                    {t('staff.board.missingWellness')}
                  </AppText>
                  {board.missingWellness.map((player) => (
                    <PlayerRow key={player.playerId} player={player} onOpenAlert={onOpenAlert} />
                  ))}
                </Card>
              ) : null}
              {board.clearCount > 0 ? (
                <AppText tone="secondary">
                  {t('staff.board.clear', { count: board.clearCount })}
                </AppText>
              ) : null}
            </>
          )}
        </>
      )}
      <AppText role="caption" tone="muted">
        {t('staff.board.heuristics')}
      </AppText>
      <AppText role="caption" tone="muted">
        {t('legal.notMedicalDevice')}
      </AppText>
    </ScreenBody>
  );
}

/** What the alert screen shows: the detail of the API, or the panel's copy without signal. */
export type AlertView =
  | { readonly source: 'detail'; readonly alert: AlertDetailDto }
  | {
      readonly source: 'board';
      readonly alert: PanelAlert;
    };

function eventLine(event: AlertEventDto, { t }: Translator): string {
  return t('staff.alert.event', {
    date: formatLocalDate(event.localDate),
    event: t(`staff.alert.event.${event.type}`),
  });
}

/** An alert, its history and the staff's review. */
export function AlertDetailScreen({
  view,
  playerName,
  loading,
  error,
  freshness,
  canReview,
  online,
  reviewing,
  notice,
  onReview,
  onBack,
}: {
  readonly view: AlertView | null;
  /** `null` when the phone does not know the player's name. */
  readonly playerName: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly freshness: Freshness;
  /** The role may acknowledge and dismiss (`alert.acknowledge`). */
  readonly canReview: boolean;
  /** The review needs the server: without signal the actions are off. */
  readonly online: boolean;
  readonly reviewing: boolean;
  /** The outcome of the last review (done, conflict, failure). */
  readonly notice: { readonly level: StatusLevel; readonly text: string } | null;
  readonly onReview: (status: 'acknowledged' | 'dismissed', note: string) => void;
  readonly onBack: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  // The screen of a tab stays mounted from one alert to the next: the note
  // typed for one never shows on another.
  const alertKey = view?.alert.id ?? '';
  const [note, setNote] = useKeyedState(alertKey, '');
  const [noteError, setNoteError] = useKeyedState<string | null>(alertKey, null);
  if (loading && view === null) return <LoadingView label={t('staff.alert.loading')} />;
  if (view === null) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('staff.alert.title')}
        </AppText>
        <StatusMessage level="critical">{error ?? t('staff.alert.notFound')}</StatusMessage>
        <Button variant="secondary" label={t('staff.alert.back')} onPress={onBack} />
      </ScreenBody>
    );
  }
  const alert = view.alert;
  const severity = view.source === 'detail' ? view.alert.currentSeverity : view.alert.severity;
  const suggestionKey =
    view.source === 'detail' ? view.alert.suggestionKey : `alert.${view.alert.kind}.suggestion`;
  const suggestion = alertMessage(t, suggestionKey, alert.values);
  const resolvedOn = view.source === 'detail' ? view.alert.resolvedOn : null;
  const open = alert.status === 'open' && resolvedOn === null;
  const reviewable = canReview && view.source === 'detail' && open;
  let reviewSection: ReactNode = null;
  if (canReview && open) {
    reviewSection = (
      <Card>
        <AppText role="overline" tone="secondary" accessibilityRole="header">
          {t('staff.alert.review')}
        </AppText>
        {!online || view.source !== 'detail' ? (
          <StatusMessage level="warning">{t('staff.alert.reviewOffline')}</StatusMessage>
        ) : null}
        <TextField
          label={t('staff.alert.note.label')}
          hint={t('staff.alert.note.hint')}
          value={note}
          error={noteError}
          onChangeText={(value) => {
            setNote(value);
            setNoteError(null);
          }}
          inputProps={{ multiline: true, maxLength: 1000, editable: reviewable && online }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Button
            label={t('staff.alert.acknowledge')}
            disabled={!reviewable || !online}
            busy={reviewing}
            onPress={() => {
              onReview('acknowledged', note.trim());
            }}
          />
          <Button
            variant="secondary"
            label={t('staff.alert.dismiss')}
            disabled={!reviewable || !online || reviewing}
            onPress={() => {
              if (note.trim() === '') {
                setNoteError(t('staff.alert.note.required'));
                return;
              }
              onReview('dismissed', note.trim());
            }}
          />
        </View>
      </Card>
    );
  }
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {playerName ?? t('staff.alert.title')}
      </AppText>
      <FreshnessLine freshness={freshness} />
      {view.source === 'board' ? (
        <StatusMessage level="warning">{t('staff.alert.fromBoard')}</StatusMessage>
      ) : null}
      {notice !== null ? <StatusMessage level={notice.level}>{notice.text}</StatusMessage> : null}
      <Card>
        <StatusPill
          level={severity}
          label={t(severity === 'critical' ? 'status.critical' : 'status.warning')}
        />
        <AppText>{alertLine(alert, translator)}</AppText>
        <AppText role="caption" tone="secondary">
          {t('staff.alert.since', {
            raisedOn: formatLocalDate(alert.raisedOn),
            lastSeenOn: formatLocalDate(alert.lastSeenOn),
          })}
        </AppText>
        {resolvedOn !== null ? (
          <StatusPill
            level="ok"
            label={t('staff.alert.resolvedOn', { date: formatLocalDate(resolvedOn) })}
          />
        ) : null}
        <StatusPill
          level={alert.status === 'open' ? 'warning' : 'ok'}
          label={t(`player.alerts.review.${alert.status}`)}
        />
        {view.source === 'detail' && view.alert.acknowledgementNote !== null ? (
          <AppText role="bodySmall" tone="secondary">
            {t('staff.alert.reviewNote', { note: view.alert.acknowledgementNote })}
          </AppText>
        ) : null}
      </Card>
      {suggestion !== null ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('staff.alert.suggestion')}
          </AppText>
          <AppText role="bodySmall">{suggestion}</AppText>
        </Card>
      ) : null}
      {reviewSection}
      {view.source === 'detail' && view.alert.events.length > 0 ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('staff.alert.history')}
          </AppText>
          {view.alert.events.map((event) => (
            <View key={event.seq} style={{ gap: theme.spacing.xs }}>
              <AppText role="bodySmall">{eventLine(event, translator)}</AppText>
              {event.note !== null ? (
                <AppText role="caption" tone="secondary">
                  {t('staff.alert.reviewNote', { note: event.note })}
                </AppText>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
      <AppText role="caption" tone="muted">
        {t('staff.board.heuristics')}
      </AppText>
      <Button variant="link" label={t('staff.alert.back')} onPress={onBack} />
    </ScreenBody>
  );
}

const PUSH_STATUS_LEVEL: Readonly<Record<PushState['status'], StatusLevel>> = {
  unsupported: 'warning',
  off: 'warning',
  needsPermission: 'warning',
  denied: 'critical',
  // Not shown in practice (the screen needs a session): nothing is wrong.
  signedOut: 'ok',
  pending: 'warning',
  registered: 'ok',
};

function PreferenceSwitch({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ true: theme.colors.brand.solid, false: theme.colors.border.strong }}
    />
  );
}

/** The notifications of this phone and the person's preferences in this club. */
export function NotificationSettingsScreen({
  push,
  preferences,
  loading,
  error,
  saveError = null,
  online,
  saving,
  onEnablePush,
  onDisablePush,
  onOpenSettings,
  onChange,
}: {
  readonly push: PushState;
  /** `null` while loading or when it failed with nothing kept. */
  readonly preferences: readonly NotificationPreference[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** The last change could not be saved (it stays as it was). */
  readonly saveError?: string | null;
  /** Preferences are of the server: without signal they are read-only. */
  readonly online: boolean;
  /** A change is being saved (the switches wait). */
  readonly saving: boolean;
  readonly onEnablePush: () => void;
  readonly onDisablePush: () => void;
  readonly onOpenSettings: () => void;
  readonly onChange: (kind: NotificationKind, channel: 'push' | 'email', value: boolean) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const deviceOn = push.status !== 'off' && push.status !== 'unsupported';
  const row = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.sizes.touchTarget,
  } as const;
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('staff.notifications.title')}
      </AppText>
      <AppText tone="secondary">{t('staff.notifications.privacy')}</AppText>
      <Card>
        <View style={row}>
          <View style={{ flex: 1 }}>
            <AppText>{t('staff.notifications.device')}</AppText>
            <AppText role="bodySmall" tone="secondary">
              {t('staff.notifications.device.hint')}
            </AppText>
          </View>
          <PreferenceSwitch
            label={t('staff.notifications.device')}
            value={deviceOn}
            disabled={push.status === 'unsupported' || push.busy}
            onChange={(on) => {
              if (on) onEnablePush();
              else onDisablePush();
            }}
          />
        </View>
        <StatusMessage level={PUSH_STATUS_LEVEL[push.status]}>
          {t(`staff.notifications.status.${push.status}`)}
        </StatusMessage>
        {push.status === 'denied' ? (
          <Button
            variant="secondary"
            label={t('staff.notifications.openSettings')}
            onPress={onOpenSettings}
          />
        ) : null}
        {push.status === 'needsPermission' ? (
          <Button
            variant="secondary"
            label={t('staff.push.enable')}
            busy={push.busy}
            onPress={onEnablePush}
          />
        ) : null}
      </Card>
      <Card>
        <AppText role="overline" tone="secondary" accessibilityRole="header">
          {t('staff.notifications.kinds')}
        </AppText>
        {!online && preferences !== null ? (
          <StatusMessage level="warning">{t('staff.notifications.offline')}</StatusMessage>
        ) : null}
        {saveError !== null ? <StatusMessage level="critical">{saveError}</StatusMessage> : null}
        {preferences === null ? (
          loading ? (
            <AppText tone="secondary">{t('staff.notifications.loading')}</AppText>
          ) : (
            <StatusMessage level="critical">{error ?? t('error.generic')}</StatusMessage>
          )
        ) : preferences.length === 0 ? (
          <AppText tone="secondary">{t('staff.notifications.none')}</AppText>
        ) : (
          preferences.map((preference) => {
            const kind = t(`staff.notifications.kind.${preference.kind}`);
            return (
              <View key={preference.kind} style={{ gap: theme.spacing.xs }}>
                <AppText role="bodyStrong">{kind}</AppText>
                {(['push', 'email'] as const).map((channel) => (
                  <View key={channel} style={row}>
                    <View style={{ flex: 1 }}>
                      <AppText role="bodySmall">
                        {t(`staff.notifications.channel.${channel}`)}
                      </AppText>
                    </View>
                    <PreferenceSwitch
                      label={t('staff.notifications.switch', {
                        kind,
                        channel: t(`staff.notifications.channel.${channel}`),
                      })}
                      value={preference[channel]}
                      disabled={!online || saving}
                      onChange={(value) => {
                        onChange(preference.kind, channel, value);
                      }}
                    />
                  </View>
                ))}
              </View>
            );
          })
        )}
      </Card>
    </ScreenBody>
  );
}
