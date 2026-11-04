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
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, Card, ScreenBody, StatusMessage, TextField } from '../ui/primitives.tsx';
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
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('coachSession.list.title')}
      </AppText>
      <AppText tone="secondary">{t('coachSession.list.subtitle')}</AppText>
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

function PlayerCard({
  player,
  onStatus,
  onMinutes,
  onContacts,
  onContactsText,
  onToggleField,
}: {
  readonly player: SheetPlayer;
  readonly onStatus: (playerId: string, status: ParticipationStatus) => void;
  readonly onMinutes: (playerId: string, text: string) => void;
  readonly onContacts: (playerId: string, delta: 1 | -1) => void;
  readonly onContactsText: (playerId: string, text: string) => void;
  readonly onToggleField: (playerId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const { row, name } = player;
  const editable = player.readOnly === null;
  const carriesLoad = row.status === '' || participationCarriesLoad(row.status);
  const availability = player.availability;
  return (
    <Card>
      <AppText role="bodyStrong" accessibilityRole="header">
        {name}
      </AppText>
      {player.calledUp ? (
        <AppText role="bodySmall" tone="secondary">
          {t('coachSession.player.calledUp')}
        </AppText>
      ) : null}
      {availability === null ? null : (
        <>
          <Tag level={AVAILABILITY_LEVEL[availability.status] ?? 'warning'}>
            {t(`coachSession.player.availability.${availability.status}`)}
          </Tag>
          {availability.staffNotes.map((note, index) => (
            <AppText key={index} role="bodySmall" tone="secondary">
              {t('coachSession.player.staffNote', { note })}
            </AppText>
          ))}
        </>
      )}
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
      <StatusChoice
        name={name}
        value={row.status}
        disabled={!editable}
        onChange={(status) => {
          onStatus(player.id, status);
        }}
      />
      {player.field === null || !editable ? null : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            flexWrap: 'wrap',
          }}
        >
          <View style={{ flex: 1, minWidth: 140 }}>
            <Tag level={player.field.on ? 'ok' : 'warning'}>
              {player.field.on
                ? t('coachSession.player.onField', { minutes: player.field.minutes })
                : t('coachSession.player.offField', { minutes: player.field.minutes })}
            </Tag>
          </View>
          <Button
            variant="secondary"
            label={player.field.on ? t('coachSession.player.goOut') : t('coachSession.player.goIn')}
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
      {carriesLoad ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.md, flexWrap: 'wrap' }}>
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
          <View style={{ flex: 1, minWidth: 180, gap: theme.spacing.xs }}>
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
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
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
        </View>
      ) : null}
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
      {player.edited ? (
        <Tag level="warning">{t('coachSession.player.edited')}</Tag>
      ) : player.unsent ? (
        <Tag level="warning">{t('coachSession.player.unsent')}</Tag>
      ) : null}
    </Card>
  );
}

function ClockCard({
  clock,
  onStart,
  onPause,
  onFinish,
}: {
  readonly clock: ClockView;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onFinish: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  return (
    <Card>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {t('coachSession.clock.title')}
      </AppText>
      {clock.status === 'off' ? (
        <>
          <AppText role="bodySmall" tone="secondary">
            {t('coachSession.clock.hint')}
          </AppText>
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
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              label={
                clock.status === 'running'
                  ? t('coachSession.clock.pause')
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
}: {
  readonly title: string;
  readonly when: string;
  readonly plannedMinutes: number | null;
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
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const hasDraft = changeCount > 0 || clock.status !== 'off';
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
              <Card>
                <AppText role="overline" tone="secondary" accessibilityRole="header">
                  {t('coachSession.summary.title')}
                </AppText>
                <AppText>{t('coachSession.summary.line', { ...summary })}</AppText>
                <AppText role="bodySmall" tone="secondary">
                  {t('coachSession.summary.totals', {
                    minutes: formatNumber(summary.minutes),
                    contacts: formatNumber(summary.contacts),
                  })}
                </AppText>
              </Card>
              {roster.players.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  onStatus={onStatus}
                  onMinutes={onMinutes}
                  onContacts={onContacts}
                  onContactsText={onContactsText}
                  onToggleField={onToggleField}
                />
              ))}
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
                onPress={onSave}
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
