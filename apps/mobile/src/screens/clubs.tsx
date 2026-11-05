import type { MembershipSummary } from '@sport-performance/contracts';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ClubNotice } from '../state/session-controller.ts';
import { roleLabel, useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, ScreenBody, ScreenHeader, StatusMessage } from '../ui/primitives.tsx';
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: theme.sizes.touchTarget + theme.spacing.xl,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : current
            ? theme.colors.brand.border
            : theme.colors.border.subtle,
        backgroundColor: pressed || current ? theme.colors.brand.subtle : theme.colors.surface,
      })}
    >
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText role="cardTitle">{membership.club.name}</AppText>
        <AppText role="bodySmall" tone="secondary">
          {role}
        </AppText>
        {current ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
            <Text
              accessible={false}
              importantForAccessibility="no"
              style={[theme.text.tableHeader, { color: theme.colors.brand.accent }]}
            >
              ✓
            </Text>
            <AppText role="tableHeader" tone="accent">
              {translator.t('club.select.current')}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText role="title" tone="muted">
        ›
      </AppText>
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
    <ScreenBody
      header={
        <ScreenHeader
          title={t('club.select.title')}
          subtitle={notice === 'membershipLost' ? null : t('club.select.body')}
          crest={false}
        />
      }
    >
      {notice === 'membershipLost' ? (
        <StatusMessage level="warning">{t('club.membershipLost')}</StatusMessage>
      ) : null}
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
    <ScreenBody
      header={<ScreenHeader title={t('club.none.title')} subtitle={t('club.none.body')} />}
    >
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
    <ScreenBody header={<ScreenHeader title={t('startup.unavailable.title')} />}>
      <StatusMessage level="warning">{t('startup.unavailable.body')}</StatusMessage>
      <Button label={t('common.retry')} onPress={onRetry} busy={retrying} />
      <Button variant="link" label={t('auth.signOut')} onPress={onSignOut} />
    </ScreenBody>
  );
}
