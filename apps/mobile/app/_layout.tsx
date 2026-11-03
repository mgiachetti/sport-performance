import * as Sentry from '@sentry/react-native';
import { focusManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Linking, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { runBackgroundSync } from '../src/offline/background.ts';
import { startSyncTriggers } from '../src/offline/triggers.ts';
import { sentryOptions } from '../src/observability/sentry-options.ts';
import {
  registerBackgroundSync,
  setBackgroundSyncRunner,
} from '../src/platform/background-sync.ts';
import { buildInfo, nativePlatform, runtimeConfig, sentryBuild } from '../src/platform/native.ts';
import { nativeSyncTriggerSources } from '../src/platform/sync-sources.ts';
import {
  AppProviders,
  useServices,
  useSession,
  useVersionGate,
} from '../src/state/app-context.tsx';
import { createAppServices } from '../src/state/services.ts';
import { UpdateBanner, UpdateRequiredScreen } from '../src/screens/app.tsx';
import { APP_FONTS } from '../src/ui/fonts.ts';
import { useTranslator } from '../src/ui/i18n.tsx';
import { useTheme } from '../src/ui/theme.tsx';
import { blocksApp, updatePrompt } from '../src/version/index.ts';

void SplashScreen.preventAutoHideAsync();

// Once per process, before the first render (ADR 0058). A malformed build
// config throws here: a broken build, caught on the first launch in QA.
const config = runtimeConfig();
const build = buildInfo();
const sentry = sentryOptions(config, sentryBuild(build));
if (sentry !== null) Sentry.init(sentry);
const services = createAppServices(nativePlatform(config, build));
void services.session.start();
void services.versionGate.check();
// Offline sync (B-502, ADR 0065): foreground, network back, every few minutes,
// and a periodic background task; writes ask for a sync on their own.
startSyncTriggers(services.sync, nativeSyncTriggerSources);
setBackgroundSyncRunner(() => runBackgroundSync(services));
registerBackgroundSync().catch(services.reportError);

function useForegroundRefresh(): void {
  const { session, versionGate, reportError } = useServices();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      const active = status === 'active';
      focusManager.setFocused(active);
      if (!active) return;
      versionGate.check().catch(reportError);
      if (session.getState().status !== 'signedOut') void session.refresh();
    });
    return () => {
      subscription.remove();
    };
  }, [session, versionGate, reportError]);
}

/** Back to an invitation opened while signed out, once the sign-in finishes. */
function usePendingInvitation(): void {
  const services = useServices();
  const state = useSession();
  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    if (!signedIn) return;
    const token = services.session.pendingInvitation.get();
    if (token !== null) router.push(`/invite/${token}`);
  }, [signedIn, services.session]);
}

function openStore(url: string): void {
  void Linking.openURL(url);
}

function RootNavigator({ fontsReady }: { readonly fontsReady: boolean }) {
  const services = useServices();
  const theme = useTheme();
  const translator = useTranslator();
  const state = useSession();
  const gate = useVersionGate();
  const splashHidden = useRef(false);
  useForegroundRefresh();
  usePendingInvitation();

  const ready = fontsReady && state.status !== 'starting';
  useEffect(() => {
    if (ready && !splashHidden.current) {
      splashHidden.current = true;
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  const prompt = updatePrompt(gate, build.nativeVersion, translator);
  const signedIn = state.status === 'signedIn';
  const hasClub = signedIn && state.activeMembership !== null;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {prompt !== null && blocksApp(gate) ? (
        <UpdateRequiredScreen prompt={prompt} onOpenStore={openStore} />
      ) : (
        <View style={{ flex: 1 }}>
          {prompt !== null ? (
            <UpdateBanner
              prompt={prompt}
              onOpenStore={openStore}
              onDismiss={() => {
                services.versionGate.dismiss().catch(services.reportError);
              }}
            />
          ) : null}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            {/* Dispatches by session state; the anchor every guard falls back to. */}
            <Stack.Screen name="index" />
            <Stack.Protected guard={state.status === 'signedOut'}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={signedIn && !hasClub}>
              <Stack.Screen name="select-club" />
            </Stack.Protected>
            <Stack.Protected guard={hasClub}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            {/* Links work in any state: each screen handles signed in and out. */}
            <Stack.Screen name="invite/[token]" />
            <Stack.Screen name="player-access/[token]" />
            <Stack.Screen name="+not-found" />
          </Stack>
        </View>
      )}
    </SafeAreaView>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  useEffect(() => {
    if (fontError !== null) services.reportError(fontError);
  }, [fontError]);
  return (
    <SafeAreaProvider>
      <AppProviders services={services}>
        {/* Without the fonts the app still works with the system ones. */}
        <RootNavigator fontsReady={fontsLoaded || fontError !== null} />
      </AppProviders>
    </SafeAreaProvider>
  );
}

export default sentry === null ? RootLayout : Sentry.wrap(RootLayout);

export const unstable_settings = { initialRouteName: 'index' };
