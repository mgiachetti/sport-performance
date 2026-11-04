import Tabs from 'expo-router/js-tabs';
import { useSession } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { useTheme } from '../../src/ui/theme.tsx';

/**
 * The signed-in app with a club: one tab per area. The player's day and
 * tests are B-503 ("Hoy" and "Mis tests", only for the `player` role); the
 * protocols of the tests are B-415; the player's consents open from Cuenta.
 */
export default function AppLayout() {
  const theme = useTheme();
  const { t } = useTranslator();
  const session = useSession();
  const isPlayer = session.status === 'signedIn' && session.activeMembership?.role === 'player';
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
      <Tabs.Screen name="protocols" options={{ title: t('nav.protocols') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
      {/* Opened from Inicio by the staff who records tests; not a tab of its own. */}
      <Tabs.Screen name="ift-3015" options={{ title: t('ift.title'), href: null }} />
      {/* The player's consents, opened from Cuenta. */}
      <Tabs.Screen name="consents" options={{ title: t('playerApp.consents.title'), href: null }} />
      <Tabs.Screen name="reaction" options={{ title: t('reaction.title'), href: null }} />
    </Tabs>
  );
}
