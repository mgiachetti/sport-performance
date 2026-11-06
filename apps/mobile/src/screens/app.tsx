import type { MembershipSummary } from '@sport-performance/contracts';
import type { ClubTheme } from '@sport-performance/contracts';
import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';
import type { UpdatePrompt } from '../version/index.ts';
import { ListRow } from '../ui/blocks.tsx';
import { roleLabel, useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  ClubBadge,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
} from '../ui/primitives.tsx';
import { useTheme, useThemeVariant, type ClubMark } from '../ui/theme.tsx';

/** The crest and names of the club a screen shows (its theme, or the membership without one). */
function clubMarkOf(membership: MembershipSummary, clubTheme: ClubTheme | null): ClubMark {
  return {
    name: membership.club.name,
    shortName: clubTheme?.shortName ?? membership.club.name.slice(0, 3).toUpperCase(),
    logoUrl: clubTheme?.logoUrl ?? null,
  };
}

function ClubHeader({
  membership,
  clubTheme,
}: {
  readonly membership: MembershipSummary;
  readonly clubTheme: ClubTheme | null;
}) {
  const theme = useTheme();
  const translator = useTranslator();
  const club = clubMarkOf(membership, clubTheme);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <ClubBadge
        name={club.name}
        shortName={club.shortName}
        logoUrl={club.logoUrl}
        size={theme.sizes.clubMark}
      />
      <View style={{ flex: 1 }}>
        <AppText role="cardTitle">{membership.club.name}</AppText>
        <AppText role="bodySmall" tone="secondary">
          {roleLabel(membership.role, translator)}
        </AppText>
      </View>
    </View>
  );
}

/** A field tool of the staff's home: the whole row opens it. */
interface HomeTool {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly onPress: () => void;
}

export function HomeScreen({
  userName,
  membership,
  clubTheme,
  sync,
  onOpenIft3015 = null,
  onOpenReaction = null,
  onOpenWeeklyCmj = null,
  onOpenSprintVideo = null,
  onOpenAnthropometry = null,
  onOpenCmjVideo = null,
  onOpenKiosk = null,
  onOpenProtocols = null,
}: {
  readonly userName: string;
  readonly membership: MembershipSummary;
  readonly clubTheme: ClubTheme | null;
  /** The sync indicator (`SyncIndicator`). */
  readonly sync?: ReactNode;
  /** Field tools of the staff who records tests (B-507); `null` hides them. */
  readonly onOpenIft3015?: (() => void) | null;
  /** The reaction test on this phone (B-606); `null` hides it. */
  readonly onOpenReaction?: (() => void) | null;
  /** The weekly CMJ of M17/M19 (B-506); `null` hides it. */
  readonly onOpenWeeklyCmj?: (() => void) | null;
  /** The sprint by video (B-605); `null` hides it. */
  readonly onOpenSprintVideo?: (() => void) | null;
  /** The field anthropometry sheet (B-508), for whoever records measurements; `null` hides it. */
  readonly onOpenAnthropometry?: (() => void) | null;
  /** CMJ by video (B-604) for who films it; `null` hides it. */
  readonly onOpenCmjVideo?: (() => void) | null;
  /** The club's kiosk mode (B-504), for whoever loads on it; `null` hides it. */
  readonly onOpenKiosk?: (() => void) | null;
  /** How each test is done (B-415); `null` hides it. */
  readonly onOpenProtocols?: (() => void) | null;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const name = userName.trim();
  const offered: {
    readonly key: string;
    readonly label: string;
    readonly hint: string;
    readonly onPress: (() => void) | null;
  }[] = [
    { key: 'ift', label: t('ift.open'), hint: t('ift.open.hint'), onPress: onOpenIft3015 },
    {
      key: 'reaction',
      label: t('reaction.open'),
      hint: t('reaction.open.hint'),
      onPress: onOpenReaction,
    },
    {
      key: 'weeklyCmj',
      label: t('weeklyCmj.open'),
      hint: t('weeklyCmj.open.hint'),
      onPress: onOpenWeeklyCmj,
    },
    {
      key: 'sprintVideo',
      label: t('sprintVideo.open'),
      hint: t('sprintVideo.open.hint'),
      onPress: onOpenSprintVideo,
    },
    {
      key: 'anthropometry',
      label: t('anthropometry.field.open'),
      hint: t('anthropometry.field.subtitle'),
      onPress: onOpenAnthropometry,
    },
    {
      key: 'cmjVideo',
      label: t('cmjVideo.open'),
      hint: t('cmjVideo.open.hint'),
      onPress: onOpenCmjVideo,
    },
    {
      key: 'protocols',
      label: t('protocols.open'),
      hint: t('protocols.open.hint'),
      onPress: onOpenProtocols,
    },
  ];
  const tools: HomeTool[] = offered.flatMap(({ onPress, ...tool }) =>
    onPress === null ? [] : [{ ...tool, onPress }],
  );
  return (
    <ScreenBody
      header={
        <ScreenHeader
          eyebrow={membership.club.name}
          title={name === '' ? t('home.greetingAnonymous') : t('home.greeting', { name })}
          subtitle={roleLabel(membership.role, translator)}
          club={clubMarkOf(membership, clubTheme)}
        />
      }
    >
      {sync}
      {tools.length > 0 ? (
        <Card title={t('home.tools')}>
          <View>
            {tools.map((tool, index) => (
              <ListRow
                key={tool.key}
                first={index === 0}
                title={tool.label}
                subtitle={tool.hint}
                onPress={tool.onPress}
              />
            ))}
          </View>
        </Card>
      ) : null}
      {onOpenKiosk === null ? null : (
        <Card title={t('home.kiosk')} subtitle={t('kiosk.open.hint')}>
          <Button variant="secondary" label={t('kiosk.open')} onPress={onOpenKiosk} />
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
  const confirming = confirmSignOut && pendingCount > 0;
  return (
    <ScreenBody
      header={
        <ScreenHeader
          title={t('account.title')}
          subtitle={email !== null ? t('account.signedInAs', { email }) : null}
          crest={false}
        />
      }
    >
      <Card>
        <ClubHeader membership={membership} clubTheme={clubTheme} />
        {canChangeClub ? (
          <Button variant="secondary" label={t('club.switch')} onPress={onChangeClub} />
        ) : null}
      </Card>
      <Card title={t('account.appearance')}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            minHeight: theme.sizes.touchTarget,
          }}
        >
          <View style={{ flex: 1 }}>
            <AppText role="bodyStrong">{t('account.highContrast')}</AppText>
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
            thumbColor={theme.colors.text.primary}
          />
        </View>
      </Card>
      {extra}
      {onOpenNotifications !== null ? (
        <Card title={t('staff.notifications.title')} subtitle={t('staff.notifications.privacy')}>
          <Button
            variant="secondary"
            label={t('staff.notifications.open')}
            onPress={onOpenNotifications}
          />
        </Card>
      ) : null}
      {sync !== undefined ? <Card title={t('sync.title')}>{sync}</Card> : null}
      {offline ? (
        <StatusMessage level="warning">{t('account.signOut.offline')}</StatusMessage>
      ) : null}
      {confirming ? (
        <StatusMessage level="critical">
          {t('account.signOut.pending', { count: pendingCount })}
        </StatusMessage>
      ) : null}
      <Button
        variant={confirming ? 'danger' : 'secondary'}
        label={confirming ? t('account.signOut.confirm') : t('auth.signOut')}
        onPress={onSignOut}
        busy={signingOut}
      />
      <AppText role="caption" tone="muted" align="center">
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
    <ScreenBody header={<ScreenHeader title={prompt.title} />}>
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
