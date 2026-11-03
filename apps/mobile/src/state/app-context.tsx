import type { ApiClient, ClubTheme } from '@sport-performance/contracts';
import type { ThemeVariant } from '@sport-performance/ui-tokens';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { nativeThemeFor } from '../branding/club-branding.ts';
import type { SyncIssue, SyncStatus } from '../offline/engine.ts';
import { TranslatorProvider } from '../ui/i18n.tsx';
import { ThemeProvider } from '../ui/theme.tsx';
import type { UpdateGate } from '../version/index.ts';
import type { AppServices } from './services.ts';
import type { SessionState } from './session-controller.ts';

const ServicesContext = createContext<AppServices | null>(null);
const ClubThemeContext = createContext<ClubTheme | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices() outside <AppProviders>');
  return services;
}

/** The typed contracts client with the session and club of the device. */
export function useApi(): ApiClient {
  return useServices().api.client;
}

export function useSession(): SessionState {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

/** The sync indicator's state (B-502): pending, signal, last sync, issues. */
export function useSyncStatus(): SyncStatus {
  const { sync } = useServices();
  return useSyncExternalStore(sync.subscribe, sync.getStatus, sync.getStatus);
}

/**
 * The issues of the queue of the active membership, re-read whenever the
 * engine says they changed (`issuesVersion`), also when their count stays.
 */
export function useSyncIssues(): readonly SyncIssue[] {
  const { sync, reportError } = useServices();
  const { membershipId, issueCount, issuesVersion } = useSyncStatus();
  const [issues, setIssues] = useState<readonly SyncIssue[]>([]);
  useEffect(() => {
    let active = true;
    sync
      .issues()
      .then((next) => {
        if (active) setIssues(next);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [sync, reportError, membershipId, issueCount, issuesVersion]);
  return issues;
}

/** The current time, refreshed every `intervalMs` (relative times like "hace 5 minutos"). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(handle);
    };
  }, [intervalMs]);
  return now;
}

export function useVersionGate(): UpdateGate {
  const { versionGate } = useServices();
  return useSyncExternalStore(versionGate.subscribe, versionGate.getState, versionGate.getState);
}

/** The brand of the active club, as the API last served it; `null` before choosing one. */
export function useClubTheme(): ClubTheme | null {
  return useContext(ClubThemeContext);
}

/** Query key of a club theme; public data, the same for every user. */
export function clubThemeQueryKey(clubSlug: string): readonly unknown[] {
  return ['public', 'clubTheme', clubSlug];
}

/**
 * Applies the brand of the club the app acts in (ADR 0014): the cached
 * theme first, so it opens with its colors without signal, then the
 * API's, which is cached for next time. Without a club, the default brand.
 */
function BrandingProvider({ children }: { readonly children: ReactNode }) {
  const services = useServices();
  const session = useSession();
  const slug = session.status === 'signedIn' ? (session.activeMembership?.club.slug ?? null) : null;
  const [variant, setVariantState] = useState<ThemeVariant>('dark');
  const [cached, setCached] = useState<{ slug: string; theme: ClubTheme | null } | null>(null);

  useEffect(() => {
    let active = true;
    void services.branding.getVariant().then((stored) => {
      if (active) setVariantState(stored);
    });
    return () => {
      active = false;
    };
  }, [services.branding]);

  useEffect(() => {
    let active = true;
    if (slug !== null) {
      void services.branding.getClubTheme(slug).then((theme) => {
        if (active) setCached({ slug, theme });
      });
    }
    return () => {
      active = false;
    };
  }, [services.branding, slug]);

  const query = useQuery({
    queryKey: clubThemeQueryKey(slug ?? ''),
    enabled: slug !== null,
    staleTime: 60 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const theme = await services.api.client.getClubTheme(
        { params: { clubSlug: slug ?? '' } },
        { signal },
      );
      await services.branding.saveClubTheme(theme);
      return theme;
    },
  });

  const cachedTheme = cached !== null && cached.slug === slug ? cached.theme : null;
  const clubTheme = slug === null ? null : (query.data ?? cachedTheme);
  const value = useMemo(
    () => ({
      theme: nativeThemeFor(clubTheme, variant),
      variant,
      setVariant: (next: ThemeVariant) => {
        setVariantState(next);
        void services.branding.setVariant(next);
      },
    }),
    [clubTheme, variant, services.branding],
  );

  return (
    <ClubThemeContext value={clubTheme}>
      <ThemeProvider value={value}>{children}</ThemeProvider>
    </ClubThemeContext>
  );
}

export function AppProviders({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  return (
    <ServicesContext value={services}>
      <TranslatorProvider translator={services.translator}>
        <QueryClientProvider client={services.queryClient}>
          <BrandingProvider>{children}</BrandingProvider>
        </QueryClientProvider>
      </TranslatorProvider>
    </ServicesContext>
  );
}
