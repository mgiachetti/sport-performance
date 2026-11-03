import { ift3015Schedule, ift3015SignalProtocol } from '@sport-performance/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { errorMessage } from '../../src/api/error-message.ts';
import {
  ROSTER_PAGE_LIMIT,
  canRunIft3015,
  fetchAllPages,
  resultRows,
  rosterOf,
  runRows,
} from '../../src/ift/roster.ts';
import {
  IftInterruptedScreen,
  IftPreparingScreen,
  IftResultsScreen,
  IftRunScreen,
  IftSetupScreen,
  type LoadState,
} from '../../src/screens/ift-3015.tsx';
import { useApi, useServices, useSession } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { AppText, ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';

function loadState<T>(
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined },
  message: (error: unknown) => string,
): LoadState<T> {
  if (query.isError) return { status: 'error', message: message(query.error) };
  if (query.isPending || query.data === undefined) return { status: 'loading' };
  return { status: 'ready', data: query.data };
}

/**
 * 30-15 IFT signals (B-507, ADR 0070): the staff picks the category and the
 * players, the app plays the signals and the staff marks each player. The
 * runner lives in the app services, outside the screen; this route only
 * wires it to the roster. Protocol: the standard one for now. Deferred to
 * B-505: the field test day passes the `parameters` of the protocol version
 * of its test definition to `ift3015SignalProtocol`, which already reads them.
 */
export default function Ift3015() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const runner = services.iftRunner;
  const state = useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const membershipId = membership?.id ?? null;
  const allowed = membership !== null && canRunIft3015(membership.role);

  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [audioError, setAudioError] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (userId === null || membershipId === null || !allowed) return;
    runner.restore({ userId, membershipId }).catch(services.reportError);
  }, [runner, userId, membershipId, allowed, services.reportError]);

  useEffect(() => {
    // Back from the background (or a call): check the clock now, take the session back.
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') runner.wake();
    });
    return () => {
      subscription.remove();
    };
  }, [runner]);

  const run = 'run' in state ? state.run : null;
  const categoryId = run?.categoryId ?? chosenCategoryId;
  const message = (error: unknown) => errorMessage(error, 'generic', translator);

  const categories = useQuery({
    queryKey: [membershipId, 'categories', 'active'],
    enabled: allowed,
    queryFn: ({ signal }) =>
      fetchAllPages((cursor) =>
        api.listCategories(
          {
            query: {
              status: 'active',
              limit: ROSTER_PAGE_LIMIT,
              ...(cursor === undefined ? {} : { cursor }),
            },
          },
          { signal },
        ),
      ),
  });
  const players = useQuery({
    queryKey: [membershipId, 'players', 'category', categoryId],
    enabled: allowed && categoryId !== null,
    queryFn: async ({ signal }) =>
      rosterOf(
        await fetchAllPages((cursor) =>
          api.listPlayers(
            {
              query: {
                categoryId: categoryId ?? '',
                limit: ROSTER_PAGE_LIMIT,
                ...(cursor === undefined ? {} : { cursor }),
              },
            },
            { signal },
          ),
        ),
      ),
  });

  const names = useMemo(
    () => new Map((players.data ?? []).map((player) => [player.id, player.name])),
    [players.data],
  );
  const setupProtocol = useMemo(() => ift3015SignalProtocol(null), []);
  const protocol = run?.protocol ?? setupProtocol;
  const schedule = useMemo(() => ift3015Schedule(protocol), [protocol]);

  if (membership === null || userId === null) return null;
  if (!allowed) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('ift.title')}
        </AppText>
        <StatusMessage level="warning">{t('ift.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }

  if (run !== null && (run.scope.userId !== userId || run.scope.membershipId !== membership.id)) {
    // Another user's or club's run, until `restore` drops it: never shown.
    return <IftPreparingScreen />;
  }

  switch (state.status) {
    case 'preparing':
      return <IftPreparingScreen />;
    case 'running':
      return (
        <IftRunScreen
          moment={state.moment}
          protocol={protocol}
          rows={runRows(state.run.players, schedule, state.elapsedMs, names, translator)}
          skippedCues={state.skippedCues}
          allOut={state.allOut}
          onMiss={runner.miss}
          onStop={runner.stop}
          onUndo={runner.undo}
          onFinish={runner.finish}
        />
      );
    case 'interrupted':
      return (
        <IftInterruptedScreen
          moment={state.moment}
          resumable={state.resumable}
          resuming={resuming}
          audioError={audioError}
          onResume={() => {
            setResuming(true);
            setAudioError(false);
            runner
              .resume()
              .catch(() => {
                setAudioError(true);
              })
              .finally(() => {
                setResuming(false);
              });
          }}
          onFinish={runner.finish}
        />
      );
    case 'finished':
      return (
        <IftResultsScreen
          protocol={protocol}
          rows={resultRows(state.run, names, translator)}
          interrupted={state.run.endedBy === 'interrupted'}
          onAdjust={runner.adjust}
          onDiscard={() => {
            setSelected(new Set());
            runner.discard().catch(services.reportError);
          }}
        />
      );
    case 'idle': {
      const roster = players.data ?? [];
      return (
        <IftSetupScreen
          protocol={setupProtocol}
          categories={loadState(
            {
              ...categories,
              data: categories.data?.map((category) => ({ id: category.id, name: category.name })),
            },
            message,
          )}
          categoryId={chosenCategoryId}
          onSelectCategory={(id) => {
            setChosenCategoryId(id);
            setSelected(new Set());
          }}
          players={chosenCategoryId === null ? null : loadState(players, message)}
          selected={selected}
          onToggle={(playerId) => {
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(playerId)) next.delete(playerId);
              else next.add(playerId);
              return next;
            });
          }}
          onSelectAll={() => {
            setSelected(new Set(roster.map((player) => player.id)));
          }}
          onSelectNone={() => {
            setSelected(new Set());
          }}
          preparing={false}
          audioError={audioError}
          offline={session.status === 'signedIn' && session.offline}
          onStart={() => {
            setAudioError(false);
            runner
              .start({
                scope: { userId, membershipId: membership.id },
                protocol: setupProtocol,
                // In roster order: the order the staff sees on the field.
                playerIds: roster.filter((p) => selected.has(p.id)).map((p) => p.id),
                categoryId: chosenCategoryId,
              })
              .catch(() => {
                setAudioError(true);
              });
          }}
        />
      );
    }
  }
}
