// First: the Intl polyfills Hermes needs, before any module that formats.
import '../src/platform/intl-native.ts';
import * as Sentry from '@sentry/react-native';
import { focusManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { withTap, type AppRoute } from '../src/notifications/routing.ts';
import { createPushTapHandler } from '../src/notifications/taps.ts';
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
  useKiosk,
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
// Offline sync (B-502, ADR 0069): foreground, network back, every few minutes,
// and a periodic background task; writes ask for a sync on their own.
startSyncTriggers(services.sync, nativeSyncTriggerSources);
setBackgroundSyncRunner(() => runBackgroundSync(services));
registerBackgroundSync().catch(services.reportError);
// The push token of this phone (B-510): registered for the session once it is read.
services.push.refresh().catch(services.reportError);

function useForegroundRefresh(): void {
  const { session, versionGate, push, reportError } = useServices();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      const active = status === 'active';
      focusManager.setFocused(active);
      if (!active) return;
      versionGate.check().catch(reportError);
      if (session.getState().status !== 'signedOut') void session.refresh();
      // The permission may have changed in the phone's settings meanwhile.
      push.refresh().catch(reportError);
    });
    return () => {
      subscription.remove();
    };
  }, [session, versionGate, push, reportError]);
}

/**
 * A tap on a push opens what it points at (B-510, ADR 0081), also the tap
 * that launched the app from closed; it waits for the session if it has to.
 */
function usePushTaps(): void {
  const { session, pushDevice, reportError } = useServices();
  const state = useSession();
  // The route of the last tap, until the session acts in its membership.
  const opening = useRef<{ readonly route: AppRoute; readonly membershipId: string } | null>(null);
  const [taps, setTaps] = useState(0);
  useEffect(() => {
    const handler = createPushTapHandler({
      session,
      navigate: (route, membershipId) => {
        opening.current = { route, membershipId };
        setTaps((count) => count + 1);
      },
      reportError,
    });
    const stop = pushDevice.onResponse((data) => {
      handler.handle(data);
    });
    pushDevice
      .takeLaunchResponse()
      .then((data) => {
        if (data !== null) handler.handle(data);
      })
      .catch(reportError);
    return () => {
      stop();
      handler.dispose();
    };
  }, [session, pushDevice, reportError]);
  // Navigate only once the rendered session acts in the push's membership:
  // this effect runs after the commit where the stack's guards let the
  // club's screens in, so the route exists when it is opened.
  const activeId = state.status === 'signedIn' ? (state.activeMembership?.id ?? null) : null;
  useEffect(() => {
    const next = opening.current;
    if (next === null || activeId === null || next.membershipId !== activeId) return;
    opening.current = null;
    router.navigate(withTap(next.route, taps));
  }, [taps, activeId]);
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
  usePushTaps();

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
  // The club's kiosk (B-504): while it is on, it is the only route of the app.
  const kiosk = useKiosk();
  const kioskOn = hasClub && kiosk.status === 'on';

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
            <Stack.Protected guard={hasClub && kiosk.status === 'off'}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={kioskOn}>
              <Stack.Screen name="kiosk" options={{ gestureEnabled: false }} />
            </Stack.Protected>
            {/* Links work in any state but the kiosk: each screen handles signed in and out. */}
            <Stack.Protected guard={!kioskOn}>
              <Stack.Screen name="invite/[token]" />
              <Stack.Screen name="player-access/[token]" />
            </Stack.Protected>
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
