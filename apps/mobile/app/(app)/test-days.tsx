import {
  ApiError,
  ApiNetworkError,
  type MembershipSummary,
  type TestDaySheet,
  type TestSession,
} from '@sport-performance/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import { SyncIndicator } from '../../src/screens/sync.tsx';
import {
  StationScreen,
  TestDayListScreen,
  TestDayScreen,
  type TestDayListState,
  type TestDayState,
} from '../../src/screens/test-day.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { createTestDayController } from '../../src/test-day/controller.ts';
import { canRunIft3015 } from '../../src/ift/roster.ts';
import { iftRunForDay } from '../../src/test-day/ift.ts';
import {
  SHEET_FRESH_MS,
  clubTimeZone,
  testDayLists,
  today,
  type ClubContext,
} from '../../src/test-day/data.ts';
import type { FieldResult, StationSettings } from '../../src/test-day/model.ts';
import type { StationView } from '../../src/test-day/controller.ts';
import { useTranslator } from '../../src/ui/i18n.tsx';

/** Field test day tab (B-505): days, stations and loading, from the local database. */
export default function TestDays() {
  const state = useSession();
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return (
    <TestDaysOf
      key={state.activeMembership.id}
      membership={state.activeMembership}
      user={state.user}
      offline={state.offline}
    />
  );
}

function TestDaysOf({
  membership,
  user,
  offline,
}: {
  readonly membership: MembershipSummary;
  readonly user: { readonly id: string };
  readonly offline: boolean;
}) {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const syncStatus = useSyncStatus();
  const now = useNow(60_000);
  const iftState = useSyncExternalStore(
    services.iftRunner.subscribe,
    services.iftRunner.getState,
    services.iftRunner.getState,
  );
  const { reportError } = services;
  const controller = useMemo(
    () =>
      createTestDayController({
        sync: services.sync,
        cache: services.readCache,
        api,
        scope: { membershipId: membership.id, userId: user.id },
        role: membership.role,
        randomUUID: services.randomUUID,
      }),
    [
      services.sync,
      services.readCache,
      services.randomUUID,
      api,
      membership.id,
      membership.role,
      user.id,
    ],
  );
  const report = useCallback(
    (error: unknown) => {
      // Without signal or with an answer of the server, the phone goes on with what it has;
      // an off-contract answer or anything else is a bug.
      if (error instanceof ApiNetworkError || error instanceof ApiError) return;
      reportError(error);
    },
    [reportError],
  );

  // Local re-reads: after each sync cycle, each queued write and each download.
  const [localVersion, setLocalVersion] = useState(0);
  const bump = useCallback(() => {
    setLocalVersion((v) => v + 1);
  }, []);
  const reloadKey = `${String(syncStatus.lastSyncedAt)}:${String(syncStatus.pendingCount)}:${String(localVersion)}`;

  const [context, setContext] = useState<ClubContext | null>(null);
  useEffect(() => {
    let active = true;
    void controller.clubContext().then((cached) => {
      if (active && cached !== null) setContext(cached);
    });
    controller
      .refreshClubContext()
      .then((fresh) => {
        if (active) setContext(fresh);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [controller, report]);
  const timeZone = clubTimeZone(context);
  const day = today(context, now);
  const categoryName = useCallback(
    (categoryId: string | null) =>
      categoryId === null
        ? translator.t('testDay.titleNoCategory')
        : (context?.categories.find((c) => c.id === categoryId)?.name ?? '—'),
    [context, translator],
  );
  const windowName = useCallback(
    (testWindowId: string | null) =>
      testWindowId === null
        ? translator.t('testDay.window.none')
        : (context?.testWindows.find((w) => w.id === testWindowId)?.label ?? '—'),
    [context, translator],
  );

  const [days, setDays] = useState<readonly TestSession[] | null>(null);
  const [saved, setSaved] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let active = true;
    void Promise.all([controller.days(day), controller.savedSheets()])
      .then(([sessions, sheets]) => {
        if (!active) return;
        setDays(sessions);
        setSaved(sheets);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [controller, day, reloadKey, reportError]);

  // Downloads the sheets of the coming days while there is signal, again when
  // the days change and every time a saved sheet gets old.
  const prefetchKey = days?.map((d) => `${d.id}:${d.version}`).join(',') ?? '';
  const freshnessSlot = Math.floor(now / SHEET_FRESH_MS);
  useEffect(() => {
    if (days === null || offline) return;
    const abort = new AbortController();
    controller
      .prefetch(days, day, abort.signal)
      .then((count) => {
        if (count > 0) bump();
      })
      .catch(report);
    return () => {
      abort.abort();
    };
    // `days` itself changes on every re-read; its ids and versions decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, prefetchKey, freshnessSlot, day, offline, bump, report]);

  const [dayId, setDayId] = useState<string | null>(null);
  const [stationCode, setStationCode] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ value: TestDaySheet; fetchedAt: number } | null>(null);
  const [sheetState, setSheetState] = useState<
    'loading' | 'ready' | 'unavailable' | 'refreshing' | 'refreshFailed'
  >('loading');
  const [unavailableMessage, setUnavailableMessage] = useState('');

  const loadSheet = useCallback(
    async (id: string, refresh: boolean, active: () => boolean) => {
      const cached = await controller.sheet(id);
      if (!active()) return;
      if (cached !== null) {
        setSheet(cached);
        setSheetState(refresh ? 'refreshing' : 'ready');
      }
      if (!refresh) return;
      try {
        await controller.refreshSheet(id);
        const fresh = await controller.sheet(id);
        if (!active()) return;
        setSheet(fresh);
        setSheetState('ready');
        bump();
      } catch (error) {
        report(error);
        if (!active()) return;
        if (cached === null) {
          setUnavailableMessage(
            offline || error instanceof ApiNetworkError
              ? translator.t('fieldTest.day.unavailableOffline')
              : errorMessage(error, 'generic', translator),
          );
          setSheetState('unavailable');
        } else {
          setSheetState('refreshFailed');
        }
      }
    },
    [controller, bump, report, offline, translator],
  );

  // Opening a day reads it (saved first, then downloaded); the refresh button reads it again.
  // A read that answers after the user left the day is dropped.
  const openDay = useRef<string | null>(null);
  const readDay = (id: string, refresh: boolean) => {
    void loadSheet(id, refresh, () => openDay.current === id).catch(reportError);
  };

  // The synced day (status, version) may change under an open sheet.
  useEffect(() => {
    if (dayId === null || sheet === null) return;
    let active = true;
    void controller.sheet(dayId).then((read) => {
      if (
        active &&
        read !== null &&
        read.value.testSession.version !== sheet.value.testSession.version
      ) {
        setSheet(read);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const [results, setResults] = useState<readonly FieldResult[]>([]);
  useEffect(() => {
    if (sheet === null) return;
    let active = true;
    controller
      .results(sheet.value)
      .then((next) => {
        if (active) setResults(next);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [controller, sheet, reloadKey, reportError]);

  const station = sheet?.value.stations.find((s) => s.testCode === stationCode) ?? null;
  // Tagged with its station: the view of the previous one never shows under another.
  const [loadedView, setLoadedView] = useState<{ code: string; view: StationView } | null>(null);
  const stationView = loadedView?.code === stationCode ? loadedView.view : null;
  useEffect(() => {
    if (sheet === null || station === null) return;
    let active = true;
    controller
      .station(sheet.value, station, results)
      .then((view) => {
        if (active) setLoadedView({ code: station.testCode, view });
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [controller, sheet, station, results, reportError, localVersion]);

  const sync = (
    <SyncIndicator
      status={syncStatus}
      nowMs={now}
      onSyncNow={() => {
        services.sync.requestSync({ force: true });
      }}
    />
  );

  if (dayId === null) {
    const listState: TestDayListState =
      days === null ? { status: 'loading' } : { status: 'ready', ...testDayLists(days, day) };
    return (
      <TestDayListScreen
        state={listState}
        categoryName={categoryName}
        windowName={windowName}
        savedSheets={saved}
        timeZone={timeZone}
        offline={offline && syncStatus.phase !== 'offline'}
        sync={sync}
        onOpen={(id) => {
          setStationCode(null);
          setSheet(null);
          setSheetState('loading');
          setDayId(id);
          openDay.current = id;
          readDay(id, !offline);
        }}
      />
    );
  }

  if (sheet !== null && station !== null && stationView !== null) {
    return (
      <StationScreen
        sheet={sheet.value}
        station={station}
        rows={stationView.rows}
        settings={stationView.settings}
        viewer={membership.role}
        sync={sync}
        writeContext={() => controller.writeContext(sheet.value, station, stationView.settings)}
        onSubmit={async (writes) => {
          await controller.submit(writes);
          // Rows read again before the form is free: a quick second attempt
          // goes onto the result just queued, never into a second result.
          const code = station.testCode;
          const fresh = await controller.results(sheet.value);
          const view = await controller.station(sheet.value, station, fresh);
          setResults(fresh);
          setLoadedView((current) => ({
            code,
            view: {
              ...view,
              settings: current?.code === code ? current.view.settings : view.settings,
            },
          }));
          bump();
        }}
        onChangeSettings={(next: StationSettings) => {
          setLoadedView({ code: station.testCode, view: { ...stationView, settings: next } });
          void controller.saveSettings(sheet.value, station, next).catch(reportError);
        }}
        onBack={() => {
          setStationCode(null);
        }}
        {...(station.testCode === 'ift_3015' && canRunIft3015(membership.role)
          ? {
              ift: {
                run: iftRunForDay(
                  iftState,
                  { membershipId: membership.id, userId: user.id },
                  sheet.value,
                ),
                onOpenRunner: () => {
                  router.push({
                    pathname: '/ift-3015',
                    params: { testSessionId: sheet.value.testSession.id },
                  });
                },
                onMarkSaved: services.iftRunner.markSaved,
                onDiscard: services.iftRunner.discard,
              },
            }
          : {})}
      />
    );
  }

  let dayState: TestDayState;
  if (sheet === null) {
    dayState =
      sheetState === 'unavailable'
        ? { status: 'unavailable', message: unavailableMessage }
        : { status: 'loading' };
  } else {
    dayState = {
      status: 'ready',
      sheet: sheet.value,
      savedAt: sheet.fetchedAt,
      refreshing: sheetState === 'refreshing',
      refreshFailed: sheetState === 'refreshFailed',
      progress: controller.progress(sheet.value, results),
    };
  }
  return (
    <TestDayScreen
      state={dayState}
      categoryName={categoryName}
      timeZone={timeZone}
      sync={sync}
      onBack={() => {
        setDayId(null);
        openDay.current = null;
      }}
      onRefresh={() => {
        readDay(dayId, true);
      }}
      onOpenStation={setStationCode}
    />
  );
}
