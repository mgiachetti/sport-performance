import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackBar } from '../../src/navigation/back-bar.tsx';
import { useTheme } from '../../src/ui/theme.tsx';

/**
 * The signed-in app with a club (ADR 0100): the tabs, and on top of them
 * every screen opened from a tab, with a bar to go back to the tab it came
 * from (and the system back). The screen's own header keeps its title.
 * Screens that already have their own way back, with its own checks (the
 * session asks before discarding a draft), have no bar.
 */
export default function AppLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{
        // Without the tab bar below, the screen keeps clear of the system bar itself.
        contentStyle: { backgroundColor: theme.colors.background, paddingBottom: insets.bottom },
        header: ({ navigation }) => (
          <BackBar
            onBack={() => {
              navigation.goBack();
            }}
          />
        ),
      }}
    >
      <Stack.Screen
        name="(tabs)"
        options={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}
      />
      {/* Opened from Inicio by the staff who records tests. */}
      <Stack.Screen name="ift-3015" />
      <Stack.Screen name="reaction" />
      <Stack.Screen name="weekly-cmj" />
      <Stack.Screen name="sprint-video" />
      <Stack.Screen name="anthropometry" />
      <Stack.Screen name="cmj-video" />
      {/* The staff opens the kiosk mode from Inicio (B-504). */}
      <Stack.Screen name="kiosk-setup" />
      {/* How each test is done (B-415): from Inicio (staff) and from "Mis tests" (player). */}
      <Stack.Screen name="protocols" />
      {/* The player's steps from Hoy: pain (B-609), the cycle (B-806), other activity (B-511). */}
      <Stack.Screen name="pain-report" />
      <Stack.Screen name="menstrual-cycle" />
      <Stack.Screen name="external-load" />
      {/* Opened from Cuenta. */}
      <Stack.Screen name="notifications" />
      {/* Their own "Volver" goes back: the session's asks before discarding a draft, so no swipe either. */}
      <Stack.Screen name="session" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="alerts/[alertId]" options={{ headerShown: false }} />
      <Stack.Screen name="consents" options={{ headerShown: false }} />
    </Stack>
  );
}

// A screen of the stack opened cold (a link, a push) keeps the tabs under it.
export const unstable_settings = { initialRouteName: '(tabs)' };
