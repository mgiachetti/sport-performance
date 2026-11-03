import Tabs from 'expo-router/js-tabs';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { useTheme } from '../../src/ui/theme.tsx';

/**
 * The signed-in app with a club: one tab per area. B-503 and the following
 * issues add their screens here (wellness, tests, field test day); the
 * protocols of the tests are B-415.
 */
export default function AppLayout() {
  const theme = useTheme();
  const { t } = useTranslator();
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
      <Tabs.Screen name="home" options={{ title: t('nav.home') }} />
      <Tabs.Screen name="protocols" options={{ title: t('nav.protocols') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
      {/* Opened from Inicio by the staff who records tests; not a tab of its own. */}
      <Tabs.Screen name="ift-3015" options={{ title: t('ift.title'), href: null }} />
    </Tabs>
  );
}
