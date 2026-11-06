import type { MembershipRole } from '@sport-performance/domain';
import Tabs from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabVisibility } from '../../../src/navigation/tabs.ts';
import { useSession } from '../../../src/state/app-context.tsx';
import { useClubModules } from '../../../src/state/club-modules.ts';
import { useTranslator } from '../../../src/ui/i18n.tsx';
import { useTheme } from '../../../src/ui/theme.tsx';

/**
 * The tabs of the signed-in app (ADR 0100): at most five per role, so every
 * label reads whole. The player's day and tests are B-503 ("Hoy" and "Mis
 * tests"); the field test day is B-505 (the staff who read test days); the
 * coach's field sessions are B-509 (who records participation); the staff's
 * quick look before training is B-510. A tab the role does not have is
 * still a route (`href: null`) but never a destination: expo-router sends a
 * hidden tab to the first one. Everything opened from a tab (field tools,
 * a session, an alert, the protocols) is a screen of the stack around the
 * tabs (`../_layout.tsx`), never a hidden tab.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslator();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const role: MembershipRole | null =
    session.status === 'signedIn' ? (session.activeMembership?.role ?? null) : null;
  const isPlayer = role === 'player';
  // Which tabs the role sees, and the gym only while the club has the module on (issue #215).
  const tabs = tabVisibility(role, useClubModules());
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border.subtle,
          // A thumb target plus the system bar under it (gesture bar or the three buttons):
          // the bar sets its own height, so the label never ends under the system bar.
          height: theme.sizes.touchTarget + theme.spacing.md + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: theme.colors.brand.accent,
        tabBarInactiveTintColor: theme.colors.text.secondary,
        // The active tab also gets the brand tint behind its label: never told by color of text alone.
        tabBarActiveBackgroundColor: theme.colors.brand.subtle,
        // Condensed and in sentence case, as the buttons (ADR 0097); uppercase did not read as a tab.
        tabBarLabelStyle: theme.text.tableHeader,
        // Labels only, always visible: the tab is never told by its icon or color alone. Beside
        // a hidden icon the label is centered in the bar, with no empty icon slot above it.
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tabs.Screen name="home" options={{ title: isPlayer ? t('nav.today') : t('nav.home') }} />
      <Tabs.Screen
        name="tests"
        options={{ title: t('nav.myTests'), ...(tabs.tests ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="gym"
        options={{ title: t('nav.gym'), ...(tabs.gym ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="test-days"
        // Only the roles that read test days (`test_session:read`) see the tab.
        options={{ title: t('fieldTest.nav'), ...(tabs.testDays ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="sessions"
        options={{ title: t('coachSession.nav'), ...(tabs.sessions ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="staff"
        options={{ title: t('nav.staff'), ...(tabs.staff ? {} : { href: null }) }}
      />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
    </Tabs>
  );
}
