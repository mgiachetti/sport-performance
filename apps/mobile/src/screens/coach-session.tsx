import {
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
} from '@sport-performance/contracts';
import {
  PARTICIPATION_STATUSES,
  participationCarriesLoad,
  type ParticipationStatus,
} from '@sport-performance/domain';
import { formatDuration, formatNumber } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SheetSummary } from '../coach-session/model.ts';
import type { ClockView, SessionListItem, SheetPlayer } from '../coach-session/view.ts';
import {
  firstTabWithError,
  sheetTabCounts,
  sheetTabs,
  type SheetTab,
} from '../coach-session/tabs.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  PendingMark,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import {
  SegmentedTabs,
  TabPanel,
  segmentKey,
  useRememberedSegment,
  type TabSegment,
} from '../ui/segmented-tabs.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Screens of the coach's session on the field (B-509, ADR 0080):
 * presentational, fed by the routes with what the phone knows, so they are
 * tested without a device.
 */

/** Icon and text, never color alone (CLAUDE.md). */
function Tag({ level, children }: { readonly level: StatusLevel; readonly children: string }) {
  const theme = useTheme();
  const colors = theme.colors.status[level];
  const glyph = { ok: '✓', warning: '!', critical: '✕' }[level];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
      <View
        accessible={false}
        style={{
          width: theme.sizes.statusIcon,
          height: theme.sizes.statusIcon,
          borderRadius: theme.sizes.statusIcon / 2,
          backgroundColor: colors.solid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.text.caption, { color: colors.onSolid, fontWeight: '700' }]}>
          {glyph}
        </Text>
      </View>
      <Text style={[theme.text.bodySmall, { color: theme.colors.text.secondary, flexShrink: 1 }]}>
        {children}
      </Text>
    </View>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────────────

function SessionRow({
  item,
  onOpen,
}: {
  readonly item: SessionListItem;
  readonly onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('coachSession.list.open', { title: item.title })}
      accessibilityHint={item.drafted ? t('coachSession.list.drafted') : undefined}
      onPress={() => {
        onOpen(item.id);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : theme.colors.border.subtle,
        backgroundColor: theme.colors.surface,
      }}
    >
      <AppText role="bodyStrong">{item.title}</AppText>
      <AppText role="bodySmall" tone="secondary">
        {item.when}
      </AppText>
      {item.drafted ? <Tag level="warning">{t('coachSession.list.drafted')}</Tag> : null}
    </Pressable>
  );
}

export function CoachSessionListScreen({
  today,
  recent,
  recentDays,
  olderDrafts = [],
  loading,
  neverSynced,
  rostersFailed,
  sync,
  onOpen,
}: {
  readonly today: readonly SessionListItem[];
  readonly recent: readonly SessionListItem[];
  readonly recentDays: number;
  /** Sessions that left the list with a draft still on the phone: shown so unsaved work never disappears. */
  readonly olderDrafts?: readonly SessionListItem[];
  readonly loading: boolean;
  /** The sessions never came down to this phone: nothing to show without a sync. */
  readonly neverSynced: boolean;
  /** Rosters the last prefetch could not download. */
  readonly rostersFailed: number;
  readonly sync?: ReactNode;
  readonly onOpen: (id: string) => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody
      header={
        <ScreenHeader
          title={t('coachSession.list.title')}
          subtitle={t('coachSession.list.subtitle')}
        />
      }
    >
      {sync}
      {neverSynced ? (
        <StatusMessage level="warning">{t('coachSession.list.neverSynced')}</StatusMessage>
      ) : null}
      {rostersFailed > 0 ? (
        <StatusMessage level="warning">
          {t('coachSession.list.rostersFailed', { count: rostersFailed })}
        </StatusMessage>
      ) : null}
      {loading ? (
        <AppText tone="secondary">{t('coachSession.list.loading')}</AppText>
      ) : (
        <>
          <Section title={t('coachSession.list.today')}>
            {today.length === 0 ? (
              <AppText tone="secondary">{t('coachSession.list.emptyToday')}</AppText>
            ) : (
              today.map((item) => <SessionRow key={item.id} item={item} onOpen={onOpen} />)
            )}
          </Section>
          <Section title={t('coachSession.list.recent', { days: recentDays })}>
            {recent.length === 0 ? (
              <AppText tone="secondary">{t('coachSession.list.emptyRecent')}</AppText>
            ) : (
              recent.map((item) => <SessionRow key={item.id} item={item} onOpen={onOpen} />)
            )}
          </Section>
          {olderDrafts.length === 0 ? null : (
            <Section title={t('coachSession.list.olderDrafts')}>
              <StatusMessage level="warning">
                {t('coachSession.list.olderDraftsHint')}
              </StatusMessage>
              {olderDrafts.map((item) => (
                <SessionRow key={item.id} item={item} onOpen={onOpen} />
              ))}
            </Section>
          )}
        </>
      )}
    </ScreenBody>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────────────

function StatusChoice({
  name,
  value,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly value: ParticipationStatus | '';
  readonly disabled: boolean;
  readonly onChange: (status: ParticipationStatus) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('coachSession.player.status', { name })}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
    >
      {PARTICIPATION_STATUSES.map((status) => {
        const checked = value === status;
        return (
          <Pressable
            key={status}
            accessibilityRole="radio"
            accessibilityLabel={t(`coachSession.status.${status}`)}
            accessibilityState={{ checked, disabled }}
            aria-checked={checked}
            disabled={disabled}
            onPress={() => {
              onChange(status);
            }}
            style={{
              minHeight: theme.sizes.touchTarget,
              paddingHorizontal: theme.spacing.md,
              justifyContent: 'center',
              borderRadius: theme.radius.md,
              borderWidth: theme.borderWidth.thick,
              borderColor: checked ? theme.colors.brand.solid : theme.colors.border.strong,
              backgroundColor: checked ? theme.colors.brand.solid : theme.colors.surfaceRaised,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text
              style={[
                theme.text.button,
                { color: checked ? theme.colors.brand.onSolid : theme.colors.text.primary },
              ]}
            >
              {/* The selected one also says so in text: never color alone. */}
              {checked
                ? `✓ ${t(`coachSession.status.${status}`)}`
                : t(`coachSession.status.${status}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const AVAILABILITY_LEVEL: Readonly<Record<string, StatusLevel>> = {
  available: 'ok',
  limited: 'warning',
  unavailable: 'critical',
  unknown: 'warning',
};

/**
 * What the sheet asks for, from the sport's field rules (B-803, ADR 0091):
 * contacts only in sports with contacts; minutes by period in a match with
 * rolling substitutions (hockey).
 */
export interface SheetFieldRules {
  readonly contacts: boolean;
  readonly byPeriod: boolean;
}

const TOTALS: SheetFieldRules = { contacts: true, byPeriod: false };

interface PlayerRowHandlers {
  readonly onStatus: (playerId: string, status: ParticipationStatus) => void;
  readonly onMinutes: (playerId: string, text: string) => void;
  readonly onContacts: (playerId: string, delta: 1 | -1) => void;
  readonly onContactsText: (playerId: string, text: string) => void;
  readonly onToggleField: (playerId: string) => void;
}

/**
 * What the coach must know of a player in every tab: availability (without
 * the cause) and the staff notes, playing while unavailable, why they cannot
 * be loaded. Outside attendance a plain "available" is left out: only what
 * warns.
 */
function PlayerWarnings({ player, tab }: { readonly player: SheetPlayer; readonly tab: SheetTab }) {
  const { t } = useTranslator();
  const availability = player.availability;
  return (
    <>
      {tab === 'attendance' && player.calledUp ? (
        <AppText role="bodySmall" tone="secondary">
          {t('coachSession.player.calledUp')}
        </AppText>
      ) : null}
      {availability !== null && (tab === 'attendance' || availability.status !== 'available') ? (
        <Tag level={AVAILABILITY_LEVEL[availability.status] ?? 'warning'}>
          {t(`coachSession.player.availability.${availability.status}`)}
        </Tag>
      ) : null}
      {availability?.staffNotes.map((note, index) => (
        <AppText key={index} role="bodySmall" tone="secondary">
          {t('coachSession.player.staffNote', { note })}
        </AppText>
      ))}
      {player.playsWhileUnavailable ? (
        <Tag level="critical">{t('coachSession.player.unavailablePlaying')}</Tag>
      ) : null}
      {player.readOnly === null ? null : (
        <Tag level="warning">
          {player.readOnly === 'noConsent'
            ? t('coachSession.player.noConsent')
            : player.readOnly === 'leftClub'
              ? t('coachSession.player.leftClub')
              : t('coachSession.player.notAllowed')}
        </Tag>
      )}
    </>
  );
}

/** Minutes, the on/off-field button of the clock, the periods and the RPE the player reported. */
function MinutesControls({
  player,
  onMinutes,
  onToggleField,
}: {
  readonly player: SheetPlayer;
  readonly onMinutes: PlayerRowHandlers['onMinutes'];
  readonly onToggleField: PlayerRowHandlers['onToggleField'];
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const { row, name } = player;
  const editable = player.readOnly === null;
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <View style={{ flex: 1, minWidth: 120 }}>
          <TextField
            label={t('coachSession.player.minutes')}
            value={row.minutes}
            onChangeText={(text) => {
              onMinutes(player.id, text);
            }}
            error={
              player.errors.includes('minutes')
                ? t('coachSession.player.error.minutes', { max: PARTICIPATION_MINUTES_MAX })
                : null
            }
            inputProps={{
              keyboardType: 'number-pad',
              editable,
              accessibilityLabel: t('coachSession.player.minutesOf', { name }),
            }}
          />
        </View>
        {player.field === null || !editable ? null : (
          <View style={{ flex: 1, minWidth: 140, gap: theme.spacing.xs }}>
            <Tag level={player.field.on ? 'ok' : 'warning'}>
              {player.field.on
                ? t('coachSession.player.onField', { minutes: player.field.minutes })
                : t('coachSession.player.offField', { minutes: player.field.minutes })}
            </Tag>
            <Button
              variant="secondary"
              label={
                player.field.on ? t('coachSession.player.goOut') : t('coachSession.player.goIn')
              }
              accessibilityLabel={
                player.field.on
                  ? t('coachSession.player.goOutOf', { name })
                  : t('coachSession.player.goInOf', { name })
              }
              onPress={() => {
                onToggleField(player.id);
              }}
            />
          </View>
        )}
      </View>
      {row.periods === undefined || row.periods === '' ? null : (
        <AppText role="bodySmall" tone="secondary">
          {t('coachSession.player.periods', {
            periods: row.periods.split(',').join(' · '),
          })}
        </AppText>
      )}
      {player.rpe !== null ? (
        <AppText role="bodySmall" tone="secondary">
          {player.srpeAu !== null
            ? t('coachSession.player.rpe', {
                rpe: formatNumber(player.rpe),
                srpe: formatNumber(player.srpeAu),
              })
            : t('coachSession.player.rpeNoLoad', { rpe: formatNumber(player.rpe) })}
        </AppText>
      ) : row.status !== '' && participationCarriesLoad(row.status) ? (
        <AppText role="bodySmall" tone="muted">
          {t('coachSession.player.rpePending')}
        </AppText>
      ) : null}
    </>
  );
}

/** The contacts field and the +1/−1 buttons, for a sport with contacts. */
function ContactsControls({
  player,
  onContacts,
  onContactsText,
}: {
  readonly player: SheetPlayer;
  readonly onContacts: PlayerRowHandlers['onContacts'];
  readonly onContactsText: PlayerRowHandlers['onContactsText'];
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const { row, name } = player;
  const editable = player.readOnly === null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.spacing.sm,
        flexWrap: 'wrap',
      }}
    >
      <View style={{ flex: 1, minWidth: 120 }}>
        <TextField
          label={t('coachSession.player.contacts')}
          value={row.contacts}
          onChangeText={(text) => {
            onContactsText(player.id, text);
          }}
          error={
            player.errors.includes('contacts')
              ? t('coachSession.player.error.contacts', { max: PARTICIPATION_CONTACTS_MAX })
              : null
          }
          inputProps={{
            keyboardType: 'number-pad',
            editable,
            accessibilityLabel: t('coachSession.player.contactsOf', { name }),
          }}
        />
      </View>
      <View style={{ flex: 1, minWidth: 140, flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            label={t('coachSession.player.contactRemove')}
            accessibilityLabel={t('coachSession.player.contactRemoveOf', { name })}
            disabled={!editable || row.contacts === '' || row.contacts === '0'}
            onPress={() => {
              onContacts(player.id, -1);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t('coachSession.player.contactAdd')}
            accessibilityLabel={t('coachSession.player.contactAddOf', { name })}
            disabled={!editable}
            onPress={() => {
              onContacts(player.id, 1);
            }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * A player in one tab of the sheet (ADR 0104): the name, the warnings that
 * go with them in every tab, only that tab's controls, and whether the row
 * is unsaved or not sent yet.
 */
function PlayerRow({
  player,
  tab,
  first,
  handlers,
}: {
  readonly player: SheetPlayer;
  readonly tab: SheetTab;
  readonly first: boolean;
  readonly handlers: PlayerRowHandlers;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const { row, name } = player;
  return (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.md,
        borderTopWidth: first ? 0 : theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      <AppText role="bodyStrong" accessibilityRole="header">
        {name}
      </AppText>
      <PlayerWarnings player={player} tab={tab} />
      {tab === 'attendance' ? (
        <StatusChoice
          name={name}
          value={row.status}
          disabled={player.readOnly !== null}
          onChange={(status) => {
            handlers.onStatus(player.id, status);
          }}
        />
      ) : row.status !== '' && !participationCarriesLoad(row.status) ? (
        <AppText role="bodySmall" tone="secondary">
          {t('coachSession.row.noLoad', { status: t(`coachSession.status.${row.status}`) })}
        </AppText>
      ) : tab === 'minutes' ? (
        <MinutesControls
          player={player}
          onMinutes={handlers.onMinutes}
          onToggleField={handlers.onToggleField}
        />
      ) : (
        <ContactsControls
          player={player}
          onContacts={handlers.onContacts}
          onContactsText={handlers.onContactsText}
        />
      )}
      {player.edited ? (
        <Tag level="warning">{t('coachSession.player.edited')}</Tag>
      ) : player.unsent ? (
        <PendingMark />
      ) : null}
    </View>
  );
}

function ClockCard({
  clock,
  byPeriod,
  onStart,
  onPause,
  onFinish,
}: {
  readonly clock: ClockView;
  readonly byPeriod: boolean;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onFinish: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  return (
    <Card title={t('coachSession.clock.title')}>
      {clock.status === 'off' ? (
        <>
          <AppText role="bodySmall" tone="secondary">
            {t('coachSession.clock.hint')}
          </AppText>
          {byPeriod ? (
            <AppText role="bodySmall" tone="secondary">
              {t('coachSession.clock.periodHint')}
            </AppText>
          ) : null}
          <Button variant="secondary" label={t('coachSession.clock.start')} onPress={onStart} />
        </>
      ) : (
        <>
          <Tag level={clock.status === 'running' ? 'ok' : 'warning'}>
            {clock.status === 'running'
              ? t('coachSession.clock.running', { elapsed: formatDuration(clock.elapsedS) })
              : t('coachSession.clock.paused', { elapsed: formatDuration(clock.elapsedS) })}
          </Tag>
          <AppText role="bodySmall" tone="secondary">
            {t('coachSession.clock.onField', { count: clock.onField })}
          </AppText>
          {byPeriod ? (
            <AppText role="bodySmall" tone="secondary">
              {t('coachSession.clock.periods', { count: clock.periods })}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              label={
                clock.status === 'running'
                  ? byPeriod
                    ? t('coachSession.clock.endPeriod')
                    : t('coachSession.clock.pause')
                  : t('coachSession.clock.resume')
              }
              onPress={clock.status === 'running' ? onPause : onStart}
            />
            <Button label={t('coachSession.clock.finish')} onPress={onFinish} />
          </View>
        </>
      )}
    </Card>
  );
}

export type RosterState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing'; readonly retrying: boolean }
  | {
      readonly status: 'ready';
      readonly players: readonly SheetPlayer[];
      /** "dd/mm/aaaa" and "HH:mm" of a roster that could not be refreshed now. */
      readonly staleSince: { readonly date: string; readonly time: string } | null;
    };

export type SaveNotice =
  | { readonly kind: 'saved'; readonly count: number }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed' }
  | null;

export function CoachSessionSheetScreen({
  title,
  when,
  plannedMinutes,
  fieldRules = TOTALS,
  roster,
  clock,
  summary,
  changeCount,
  needsReason,
  reason,
  reasonMissing,
  saving,
  notice,
  confirmDiscard,
  sync,
  onBack,
  onRetryRoster,
  onStatus,
  onMinutes,
  onContacts,
  onContactsText,
  onToggleField,
  onStartClock,
  onPauseClock,
  onFinishClock,
  onFillPresent,
  onReason,
  onSave,
  onDiscard,
  onCancelDiscard,
  segmentScope = null,
  initialTab = 'attendance',
}: {
  readonly title: string;
  readonly when: string;
  readonly plannedMinutes: number | null;
  /** The sport's field rules; a rugby sheet when omitted. */
  readonly fieldRules?: SheetFieldRules;
  readonly roster: RosterState;
  readonly clock: ClockView;
  readonly summary: SheetSummary;
  /** Players the save would write. */
  readonly changeCount: number;
  readonly needsReason: boolean;
  readonly reason: string;
  readonly reasonMissing: boolean;
  readonly saving: boolean;
  readonly notice: SaveNotice;
  /** The first press of "discard" asks to confirm. */
  readonly confirmDiscard: boolean;
  readonly sync?: ReactNode;
  readonly onBack: () => void;
  readonly onRetryRoster: () => void;
  readonly onStatus: (playerId: string, status: ParticipationStatus) => void;
  readonly onMinutes: (playerId: string, text: string) => void;
  readonly onContacts: (playerId: string, delta: 1 | -1) => void;
  readonly onContactsText: (playerId: string, text: string) => void;
  readonly onToggleField: (playerId: string) => void;
  readonly onStartClock: () => void;
  readonly onPauseClock: () => void;
  readonly onFinishClock: () => void;
  readonly onFillPresent: () => void;
  readonly onReason: (text: string) => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onCancelDiscard: () => void;
  /** The membership whose last tab the sheet remembers (ADR 0104). */
  readonly segmentScope?: string | null;
  /** The tab before the coach picks one in this app session. */
  readonly initialTab?: SheetTab;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const hasDraft = changeCount > 0 || clock.status !== 'off';
  const tabs = sheetTabs(fieldRules);
  const [tab, setTab] = useRememberedSegment(
    segmentKey('coach-session-sheet', segmentScope),
    tabs,
    initialTab,
  );
  const players = roster.status === 'ready' ? roster.players : [];
  const counts = sheetTabCounts(players);
  const tabLabel = (value: SheetTab) => t(`coachSession.tabs.${value}`);
  const segments = tabs.map((value): TabSegment<SheetTab> => {
    const errors = counts.errors[value];
    return {
      value,
      label: tabLabel(value),
      badge:
        errors > 0 && value !== tab
          ? {
              count: errors,
              label: t('coachSession.tabs.errors', { count: errors }),
              tone: 'critical',
            }
          : value === 'attendance' && counts.noStatus > 0
            ? {
                count: counts.noStatus,
                label: t('coachSession.tabs.noStatus', { count: counts.noStatus }),
              }
            : null,
    };
  });
  const handlers: PlayerRowHandlers = {
    onStatus,
    onMinutes,
    onContacts,
    onContactsText,
    onToggleField,
  };
  return (
    <ScreenBody>
      <Button variant="link" label={t('coachSession.back')} onPress={onBack} />
      <AppText role="title" accessibilityRole="header">
        {title}
      </AppText>
      <AppText tone="secondary">{when}</AppText>
      {plannedMinutes === null ? null : (
        <AppText role="bodySmall" tone="secondary">
          {t('coachSession.session.planned', { minutes: plannedMinutes })}
        </AppText>
      )}
      {sync}
      {roster.status === 'loading' ? (
        <AppText tone="secondary">{t('coachSession.roster.loading')}</AppText>
      ) : roster.status === 'missing' ? (
        <>
          <StatusMessage level="warning">{t('coachSession.roster.missing')}</StatusMessage>
          <Button
            variant="secondary"
            label={t('coachSession.roster.retry')}
            busy={roster.retrying}
            onPress={onRetryRoster}
          />
        </>
      ) : (
        <>
          {roster.staleSince === null ? null : (
            <StatusMessage level="warning">
              {t('coachSession.roster.stale', roster.staleSince)}
            </StatusMessage>
          )}
          {roster.players.length === 0 ? (
            <AppText tone="secondary">{t('coachSession.roster.empty')}</AppText>
          ) : (
            <>
              <ClockCard
                clock={clock}
                byPeriod={fieldRules.byPeriod}
                onStart={onStartClock}
                onPause={onPauseClock}
                onFinish={onFinishClock}
              />
              <Button
                variant="secondary"
                label={
                  plannedMinutes === null
                    ? t('coachSession.fillPresentNoMinutes')
                    : t('coachSession.fillPresent', { minutes: plannedMinutes })
                }
                onPress={onFillPresent}
              />
              <Card title={t('coachSession.summary.title')}>
                <AppText>{t('coachSession.summary.line', { ...summary })}</AppText>
                <AppText role="bodySmall" tone="secondary">
                  {fieldRules.contacts
                    ? t('coachSession.summary.totals', {
                        minutes: formatNumber(summary.minutes),
                        contacts: formatNumber(summary.contacts),
                      })
                    : t('coachSession.summary.minutesOnly', {
                        minutes: formatNumber(summary.minutes),
                      })}
                </AppText>
              </Card>
              <SegmentedTabs
                label={t('coachSession.tabs.label')}
                segments={segments}
                value={tab}
                onChange={setTab}
              />
              <TabPanel label={tabLabel(tab)}>
                <Card variant="flush">
                  <View style={{ paddingHorizontal: theme.spacing.lg }}>
                    {roster.players.map((player, index) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        tab={tab}
                        first={index === 0}
                        handlers={handlers}
                      />
                    ))}
                  </View>
                </Card>
              </TabPanel>
              {needsReason ? (
                <TextField
                  label={t('coachSession.reason.label')}
                  hint={t('coachSession.reason.help')}
                  value={reason}
                  onChangeText={onReason}
                  error={reasonMissing ? t('coachSession.reason.required') : null}
                />
              ) : null}
              {notice === null ? null : notice.kind === 'saved' ? (
                <StatusMessage level="ok">
                  {t('coachSession.saved', { count: notice.count })}
                </StatusMessage>
              ) : notice.kind === 'nothing' ? (
                <StatusMessage level="ok">{t('coachSession.nothingToSave')}</StatusMessage>
              ) : notice.kind === 'invalid' ? (
                <StatusMessage level="critical">{t('coachSession.invalidRows')}</StatusMessage>
              ) : (
                <StatusMessage level="critical">{t('coachSession.saveFailed')}</StatusMessage>
              )}
              <Button
                label={t('coachSession.save', { count: changeCount })}
                busy={saving}
                disabled={changeCount === 0}
                onPress={() => {
                  // An invalid value in another tab: show it where it is fixed.
                  const errorTab = firstTabWithError(players, tabs);
                  if (errorTab !== null) setTab(errorTab);
                  onSave();
                }}
              />
              {hasDraft ? (
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                  <Button
                    variant={confirmDiscard ? 'primary' : 'link'}
                    label={
                      confirmDiscard ? t('coachSession.discardConfirm') : t('coachSession.discard')
                    }
                    onPress={onDiscard}
                  />
                  {confirmDiscard ? (
                    <Button
                      variant="link"
                      label={t('coachSession.discardCancel')}
                      onPress={onCancelDiscard}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </>
      )}
    </ScreenBody>
  );
}
