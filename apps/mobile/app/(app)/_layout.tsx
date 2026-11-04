import type { Role } from '@sport-performance/domain';
import Tabs from 'expo-router/js-tabs';
import { canRecordParticipation } from '../../src/coach-session/model.ts';
import { useSession } from '../../src/state/app-context.tsx';
import { canSeeStaffBoard } from '../../src/staff/board.ts';
import { canSeeTestDays } from '../../src/test-day/data.ts';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { useTheme } from '../../src/ui/theme.tsx';

/**
 * The signed-in app with a club: one tab per area. The player's day and
 * tests are B-503 ("Hoy" and "Mis tests", only for the `player` role); the
 * field test day is B-505 (the staff who read test days); the protocols of
 * the tests are B-415; the coach's field sessions are B-509 (who records
 * participation); the staff's quick look before training is B-510; the
 * player's consents open from Cuenta.
 */
export default function AppLayout() {
  const theme = useTheme();
  const { t } = useTranslator();
  const session = useSession();
  const role: Role | null =
    session.status === 'signedIn' ? (session.activeMembership?.role ?? null) : null;
  const isPlayer = role === 'player';
  const showTestDays = role !== null && canSeeTestDays(role);
  // Only who records participation (B-509: the coach, the administration) sees the tab.
  const showSessions = role !== null && canRecordParticipation(role);
  // The quick look before training is a tab for the staff who reads the panel (B-510).
  const staff = role !== null && canSeeStaffBoard(role);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border.subtle,
          minHeight: theme.sizes.touchTarget + theme.spacing.lg,
        },
        tabBarActiveTintColor: theme.colors.brand.accent,
        tabBarInactiveTintColor: theme.colors.text.secondary,
        tabBarLabelStyle: theme.text.overline,
        // Labels always visible: the tab is never told by its icon or color alone.
        tabBarIcon: () => null,
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tabs.Screen name="home" options={{ title: isPlayer ? t('nav.today') : t('nav.home') }} />
      <Tabs.Screen
        name="tests"
        options={{ title: t('nav.myTests'), ...(isPlayer ? {} : { href: null }) }}
      />
      <Tabs.Screen name="gym" options={{ title: t('nav.gym') }} />
      <Tabs.Screen
        name="test-days"
        // Only the roles that read test days (`test_session:read`) see the tab.
        options={{ title: t('fieldTest.nav'), ...(showTestDays ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="sessions"
        options={{ title: t('coachSession.nav'), ...(showSessions ? {} : { href: null }) }}
      />
      <Tabs.Screen
        name="staff"
        options={{ title: t('nav.staff'), ...(staff ? {} : { href: null }) }}
      />
      <Tabs.Screen name="protocols" options={{ title: t('nav.protocols') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
      {/* Opened from Inicio by the staff who records tests; not a tab of its own. */}
      <Tabs.Screen name="ift-3015" options={{ title: t('ift.title'), href: null }} />
      {/* The player's consents, opened from Cuenta. */}
      <Tabs.Screen name="consents" options={{ title: t('playerApp.consents.title'), href: null }} />
      <Tabs.Screen name="reaction" options={{ title: t('reaction.title'), href: null }} />
      {/* A step of the player's wellness (B-609), opened from Inicio and after the check-in. */}
      <Tabs.Screen name="pain-report" options={{ title: t('pain.title'), href: null }} />
      <Tabs.Screen name="weekly-cmj" options={{ title: t('weeklyCmj.title'), href: null }} />
      {/* The sheet of one session, opened from Sesiones. */}
      <Tabs.Screen name="session" options={{ title: t('coachSession.nav'), href: null }} />
      {/* Opened from the board and from a critical push (B-510). */}
      <Tabs.Screen
        name="alerts/[alertId]"
        options={{ title: t('staff.alert.title'), href: null }}
      />
      {/* Opened from Cuenta. */}
      <Tabs.Screen
        name="notifications"
        options={{ title: t('staff.notifications.title'), href: null }}
      />
      <Tabs.Screen name="sprint-video" options={{ title: t('sprintVideo.title'), href: null }} />
      <Tabs.Screen
        name="anthropometry"
        options={{ title: t('anthropometry.field.open'), href: null }}
      />
      {/* Opened from Inicio by the player (B-511); not a tab of its own. */}
      <Tabs.Screen name="external-load" options={{ title: t('externalLoad.title'), href: null }} />
      <Tabs.Screen name="cmj-video" options={{ title: t('cmjVideo.title'), href: null }} />
    </Tabs>
  );
}
