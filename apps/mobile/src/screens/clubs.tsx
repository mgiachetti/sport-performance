import type { MembershipSummary } from '@sport-performance/contracts';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ClubNotice } from '../state/session-controller.ts';
import { roleLabel, useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, ScreenBody, StatusMessage } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

function MembershipRow({
  membership,
  current,
  onPress,
}: {
  readonly membership: MembershipSummary;
  readonly current: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const translator = useTranslator();
  const [focused, setFocused] = useState(false);
  const role = roleLabel(membership.role, translator);
  const label = translator.t('club.select.asRole', { clubName: membership.club.name, role });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget + theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : current
            ? theme.colors.brand.accent
            : theme.colors.border.subtle,
        backgroundColor: pressed ? theme.colors.brand.subtle : theme.colors.surface,
        gap: theme.spacing.xxs,
      })}
    >
      <AppText role="heading">{membership.club.name}</AppText>
      <AppText tone="secondary">{role}</AppText>
      {current ? (
        <AppText role="overline" tone="accent">
          {translator.t('club.select.current')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function SelectClubScreen({
  memberships,
  activeMembershipId,
  notice,
  onSelect,
}: {
  readonly memberships: readonly MembershipSummary[];
  readonly activeMembershipId: string | null;
  readonly notice: ClubNotice | null;
  readonly onSelect: (membershipId: string) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('club.select.title')}
      </AppText>
      {notice === 'membershipLost' ? (
        <StatusMessage level="warning">{t('club.membershipLost')}</StatusMessage>
      ) : (
        <AppText tone="secondary">{t('club.select.body')}</AppText>
      )}
      <View style={{ gap: theme.spacing.md }} accessibilityRole="list">
        {memberships.map((membership) => (
          <MembershipRow
            key={membership.id}
            membership={membership}
            current={membership.id === activeMembershipId}
            onPress={() => {
              onSelect(membership.id);
            }}
          />
        ))}
      </View>
    </ScreenBody>
  );
}

export function NoClubScreen({
  offline,
  onRetry,
  onSignOut,
}: {
  readonly offline: boolean;
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('club.none.title')}
      </AppText>
      <AppText tone="secondary">{t('club.none.body')}</AppText>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      <Button variant="link" label={t('auth.signOut')} onPress={onSignOut} />
    </ScreenBody>
  );
}

export function UnavailableScreen({
  onRetry,
  onSignOut,
  retrying,
}: {
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
  readonly retrying: boolean;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('startup.unavailable.title')}
      </AppText>
      <StatusMessage level="warning">{t('startup.unavailable.body')}</StatusMessage>
      <Button label={t('common.retry')} onPress={onRetry} busy={retrying} />
      <Button variant="link" label={t('auth.signOut')} onPress={onSignOut} />
    </ScreenBody>
  );
}
