import type { MembershipSummary } from '@sport-performance/contracts';
import type { ClubTheme } from '@sport-performance/contracts';
import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';
import type { UpdatePrompt } from '../version/index.ts';
import { roleLabel, useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, Card, ClubBadge, ScreenBody, StatusMessage } from '../ui/primitives.tsx';
import { useTheme, useThemeVariant } from '../ui/theme.tsx';

function ClubHeader({
  membership,
  clubTheme,
}: {
  readonly membership: MembershipSummary;
  readonly clubTheme: ClubTheme | null;
}) {
  const theme = useTheme();
  const translator = useTranslator();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <ClubBadge
        name={membership.club.name}
        shortName={clubTheme?.shortName ?? membership.club.name.slice(0, 3).toUpperCase()}
        logoUrl={clubTheme?.logoUrl ?? null}
      />
      <View style={{ flex: 1 }}>
        <AppText role="heading">{membership.club.name}</AppText>
        <AppText tone="secondary">{roleLabel(membership.role, translator)}</AppText>
      </View>
    </View>
  );
}

export function HomeScreen({
  userName,
  membership,
  clubTheme,
  offline,
  sync,
  onOpenIft3015 = null,
  onOpenReaction = null,
  onOpenWeeklyCmj = null,
}: {
  readonly userName: string;
  readonly membership: MembershipSummary;
  readonly clubTheme: ClubTheme | null;
  readonly offline: boolean;
  /** The sync indicator (`SyncIndicator`). */
  readonly sync?: ReactNode;
  /** Field tools of the staff who records tests (B-507); `null` hides them. */
  readonly onOpenIft3015?: (() => void) | null;
  /** The reaction test on this phone (B-606); `null` hides it. */
  readonly onOpenReaction?: (() => void) | null;
  /** The weekly CMJ of M17/M19 (B-506); `null` hides it. */
  readonly onOpenWeeklyCmj?: (() => void) | null;
}) {
  const { t } = useTranslator();
  const name = userName.trim();
  return (
    <ScreenBody>
      <ClubHeader membership={membership} clubTheme={clubTheme} />
      <AppText role="title" accessibilityRole="header">
        {name === '' ? t('home.greetingAnonymous') : t('home.greeting', { name })}
      </AppText>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {sync}
      <Card>
        <AppText tone="secondary">{t('home.next')}</AppText>
      </Card>
      {onOpenIft3015 === null ? null : (
        <Card>
          <AppText tone="secondary">{t('ift.open.hint')}</AppText>
          <Button variant="secondary" label={t('ift.open')} onPress={onOpenIft3015} />
        </Card>
      )}
      {onOpenReaction === null ? null : (
        <Card>
          <AppText tone="secondary">{t('reaction.open.hint')}</AppText>
          <Button variant="secondary" label={t('reaction.open')} onPress={onOpenReaction} />
        </Card>
      )}
      {onOpenWeeklyCmj === null ? null : (
        <Card>
          <AppText tone="secondary">{t('weeklyCmj.open.hint')}</AppText>
          <Button variant="secondary" label={t('weeklyCmj.open')} onPress={onOpenWeeklyCmj} />
        </Card>
      )}
      <AppText role="caption" tone="muted">
        {t('legal.notMedicalDevice')}
      </AppText>
    </ScreenBody>
  );
}

export function AccountScreen({
  email,
  membership,
  clubTheme,
  canChangeClub,
  version,
  offline,
  signingOut,
  sync,
  extra,
  pendingCount = 0,
  confirmSignOut = false,
  onChangeClub,
  onSignOut,
  onOpenNotifications = null,
}: {
  readonly email: string | null;
  readonly membership: MembershipSummary;
  readonly clubTheme: ClubTheme | null;
  readonly canChangeClub: boolean;
  /** `1.0.0 (12)`: native version and build. */
  readonly version: string;
  readonly offline: boolean;
  readonly signingOut: boolean;
  /** The sync section: indicator and the changes that were not applied. */
  readonly sync?: ReactNode;
  /** What only some roles have in their account (the player's consents). */
  readonly extra?: ReactNode;
  /** Changes not sent yet: signing out loses them, so it asks to confirm. */
  readonly pendingCount?: number;
  /** The user pressed "sign out" with changes pending: the next press signs out anyway. */
  readonly confirmSignOut?: boolean;
  readonly onChangeClub: () => void;
  readonly onSignOut: () => void;
  /** The notifications of the phone and the preferences (B-510); `null` hides the entry. */
  readonly onOpenNotifications?: (() => void) | null;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const { variant, setVariant } = useThemeVariant();
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('account.title')}
      </AppText>
      {email !== null ? (
        <AppText tone="secondary">{t('account.signedInAs', { email })}</AppText>
      ) : null}
      <Card>
        <ClubHeader membership={membership} clubTheme={clubTheme} />
        {canChangeClub ? (
          <Button variant="secondary" label={t('club.switch')} onPress={onChangeClub} />
        ) : null}
      </Card>
      <Card>
        <AppText role="overline" tone="secondary" accessibilityRole="header">
          {t('account.appearance')}
        </AppText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            minHeight: theme.sizes.touchTarget,
          }}
        >
          <View style={{ flex: 1 }}>
            <AppText>{t('account.highContrast')}</AppText>
            <AppText role="bodySmall" tone="secondary">
              {t('account.highContrast.hint')}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={t('account.highContrast')}
            accessibilityHint={t('account.highContrast.hint')}
            value={variant === 'light-hc'}
            onValueChange={(on) => {
              setVariant(on ? 'light-hc' : 'dark');
            }}
            trackColor={{ true: theme.colors.brand.solid, false: theme.colors.border.strong }}
          />
        </View>
      </Card>
      {extra}
      {onOpenNotifications !== null ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('staff.notifications.title')}
          </AppText>
          <AppText role="bodySmall" tone="secondary">
            {t('staff.notifications.privacy')}
          </AppText>
          <Button
            variant="secondary"
            label={t('staff.notifications.open')}
            onPress={onOpenNotifications}
          />
        </Card>
      ) : null}
      {sync !== undefined ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('sync.title')}
          </AppText>
          {sync}
        </Card>
      ) : null}
      {offline ? (
        <StatusMessage level="warning">{t('account.signOut.offline')}</StatusMessage>
      ) : null}
      {confirmSignOut && pendingCount > 0 ? (
        <StatusMessage level="critical">
          {t('account.signOut.pending', { count: pendingCount })}
        </StatusMessage>
      ) : null}
      <Button
        variant="secondary"
        label={
          confirmSignOut && pendingCount > 0 ? t('account.signOut.confirm') : t('auth.signOut')
        }
        onPress={onSignOut}
        busy={signingOut}
      />
      <AppText role="caption" tone="muted">
        {t('account.version', { version })}
      </AppText>
    </ScreenBody>
  );
}

/** The blocking "Actualizá la app" screen (ADR 0045). */
export function UpdateRequiredScreen({
  prompt,
  onOpenStore,
}: {
  readonly prompt: UpdatePrompt;
  readonly onOpenStore: (url: string) => void;
}) {
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {prompt.title}
      </AppText>
      <StatusMessage level="critical">{prompt.body}</StatusMessage>
      {prompt.action !== null ? (
        <Button
          label={prompt.action.label}
          onPress={() => {
            if (prompt.action !== null) onOpenStore(prompt.action.url);
          }}
        />
      ) : null}
      {prompt.note !== null ? <AppText tone="secondary">{prompt.note}</AppText> : null}
    </ScreenBody>
  );
}

/** The notice of a newer version, or of an unsupported one while offline. */
export function UpdateBanner({
  prompt,
  onOpenStore,
  onDismiss,
}: {
  readonly prompt: UpdatePrompt;
  readonly onOpenStore: (url: string) => void;
  readonly onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.surfaceRaised,
        borderBottomWidth: theme.borderWidth.hairline,
        borderBottomColor: theme.colors.border.subtle,
      }}
    >
      <StatusMessage level={prompt.dismissLabel === null ? 'critical' : 'warning'}>
        {`${prompt.title}. ${prompt.body}`}
      </StatusMessage>
      {prompt.note !== null ? (
        <AppText role="bodySmall" tone="secondary">
          {prompt.note}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        {prompt.action !== null ? (
          <Button
            label={prompt.action.label}
            onPress={() => {
              if (prompt.action !== null) onOpenStore(prompt.action.url);
            }}
          />
        ) : null}
        {prompt.dismissLabel !== null ? (
          <Button variant="link" label={prompt.dismissLabel} onPress={onDismiss} />
        ) : null}
      </View>
    </View>
  );
}
