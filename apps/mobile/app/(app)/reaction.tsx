import { ruleFor } from '@sport-performance/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { canRunIft3015 } from '../../src/ift/roster.ts';
import {
  clubToday,
  loadReactionRoster,
  loadReactionSetup,
  protocolOf,
  readReactionHistory,
  refreshReactionRoster,
  refreshReactionSetup,
  registerThisDevice,
  type ReactionSetup,
} from '../../src/reaction/data.ts';
import {
  errorCountsOf,
  reactionResultInput,
  type ReactionHistoryItem,
} from '../../src/reaction/model.ts';
import { createReactionRunner } from '../../src/reaction/runner.ts';
import {
  ReactionIntroScreen,
  ReactionLoadFailedScreen,
  ReactionLoadingScreen,
  ReactionNotAllowedScreen,
  ReactionResultScreen,
  ReactionRunScreen,
  ReactionSetupScreen,
  type DeviceStatus,
} from '../../src/screens/reaction.tsx';
import { useApi, useServices, useSession } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';

/** A cached read: the API when there is signal, what the phone kept otherwise. */
async function readThrough<T>(
  offline: boolean,
  refresh: () => Promise<T>,
  load: () => Promise<{ data: T } | null>,
): Promise<{ data: T; fromCache: boolean }> {
  if (!offline) {
    try {
      return { data: await refresh(), fromCache: false };
    } catch (error) {
      const cached = await load();
      if (cached === null) throw error;
      return { data: cached.data, fromCache: true };
    }
  }
  const cached = await load();
  if (cached !== null) return { data: cached.data, fromCache: true };
  return { data: await refresh(), fromCache: false };
}

const now = () => performance.now();

/**
 * Reaction test (B-606, ADR 0076): this phone as a registered device of the
 * club, the staff picks the category and the player, the player runs a
 * simple and a go/no-go series on the phone, and the result goes through
 * the offline queue. The setup and the rosters are cached reads, so the test
 * runs without signal once the screen was opened with it.
 */
export default function Reaction() {
  const services = useServices();
  const api = useApi();
  const queryClient = useQueryClient();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const offline = session.status === 'signedIn' && session.offline;
  const membershipId = membership?.id ?? null;
  const allowed = membership !== null && canRunIft3015(membership.role);
  const canManageDevice =
    membership !== null && ruleFor('device', 'manage', membership.role).effect === 'allow';
  const scope = useMemo(
    () => (membershipId === null || userId === null ? null : { membershipId, userId }),
    [membershipId, userId],
  );

  const [runner] = useState(() =>
    createReactionRunner({
      clock: { now },
      timers: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
      },
      random: Math.random,
    }),
  );
  const run = useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
  useEffect(
    () => () => {
      runner.dispose();
    },
    [runner],
  );

  const [installationId, setInstallationId] = useState<string | null>(null);
  useEffect(() => {
    services.measuringInstallation.id().then(setInstallationId).catch(services.reportError);
  }, [services]);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<Record<
    'simple' | 'go_no_go',
    ReactionHistoryItem[]
  > | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [notice, setNotice] = useState<{ level: 'ok' | 'warning'; text: string } | null>(null);
  const [deviceLabel, setDeviceLabel] = useState(services.hardware.model ?? '');
  const [registering, setRegistering] = useState(false);
  const [registerFailed, setRegisterFailed] = useState(false);

  // The app to the background mid-series: the waits were paused, the series starts again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') {
        const phase = runner.getState().phase;
        if (phase === 'waiting' || phase === 'stimulus' || phase === 'feedback') {
          runner.interrupt();
          setInterrupted(true);
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [runner]);

  const setupKey = [membershipId, 'reaction', 'setup', installationId] as const;
  const setupQuery = useQuery({
    queryKey: setupKey,
    enabled: allowed && scope !== null && installationId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (scope === null || installationId === null) throw new Error('reaction: no scope');
      return readThrough(
        offline,
        () => refreshReactionSetup(api, services.readCache, scope, installationId, signal),
        () => loadReactionSetup(services.readCache, scope.membershipId, installationId),
      );
    },
  });
  const setup: ReactionSetup | null = setupQuery.data?.data ?? null;

  const rosterQuery = useQuery({
    queryKey: [membershipId, 'reaction', 'roster', categoryId],
    enabled: allowed && scope !== null && categoryId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (scope === null || categoryId === null) throw new Error('reaction: no category');
      return readThrough(
        offline,
        () => refreshReactionRoster(api, services.readCache, scope, categoryId, signal),
        () => loadReactionRoster(services.readCache, scope.membershipId, categoryId),
      );
    },
  });

  const protocol = useMemo(() => (setup === null ? null : protocolOf(setup)), [setup]);
  const device = setup?.device ?? null;

  // The run ended: the player's own earlier times on this device, from the phone.
  const finished = run.phase === 'finished';
  useEffect(() => {
    if (!finished || player === null || device === null || membershipId === null) return;
    let cancelled = false;
    readReactionHistory({
      store: services.sync.store,
      membershipId,
      playerId: player.id,
      deviceId: device.id,
    })
      .then((items) => {
        if (!cancelled) setHistory(items);
      })
      .catch(services.reportError);
    return () => {
      cancelled = true;
    };
  }, [finished, player, device, membershipId, services]);

  const onTouch = useCallback(
    (at: number) => {
      runner.touch(at);
    },
    [runner],
  );
  const onStimulusShown = useCallback(
    (at: number) => {
      runner.stimulusShown(at);
    },
    [runner],
  );

  function forgetPlayer(): void {
    // Nothing of this player stays on screen for the next one.
    runner.reset();
    setPlayer(null);
    setHistory(null);
    setInterrupted(false);
    setSaveFailed(false);
  }

  if (membership === null || userId === null) return null;
  if (!allowed) return <ReactionNotAllowedScreen />;
  if (setupQuery.isError) {
    return (
      <ReactionLoadFailedScreen
        onRetry={() => {
          void setupQuery.refetch();
        }}
      />
    );
  }
  if (setup === null || protocol === null || scope === null || installationId === null) {
    return <ReactionLoadingScreen />;
  }

  if (player !== null && device !== null && setup.definition !== null) {
    const definition = setup.definition;
    switch (run.phase) {
      case 'intro':
        return (
          <ReactionIntroScreen
            playerName={player.name}
            task={run.task}
            taskIndex={run.taskIndex}
            taskCount={run.taskCount}
            protocol={protocol}
            interrupted={interrupted}
            onBegin={() => {
              setInterrupted(false);
              runner.begin();
            }}
            onCancel={forgetPlayer}
          />
        );
      case 'waiting':
        return (
          <ReactionRunScreen
            view={{ phase: 'waiting', progress: run.progress, trial: run.trial.index }}
            onTouch={onTouch}
            onStimulusShown={onStimulusShown}
            now={now}
          />
        );
      case 'stimulus':
        return (
          <ReactionRunScreen
            view={{
              phase: 'stimulus',
              stimulus: run.trial.stimulus,
              progress: run.progress,
              trial: run.trial.index,
            }}
            onTouch={onTouch}
            onStimulusShown={onStimulusShown}
            now={now}
          />
        );
      case 'feedback':
        return (
          <ReactionRunScreen
            view={{ phase: 'feedback', record: run.record, progress: run.progress }}
            onTouch={onTouch}
            onStimulusShown={onStimulusShown}
            now={now}
          />
        );
      case 'finished':
        return (
          <ReactionResultScreen
            playerName={player.name}
            summaries={run.summaries}
            history={history}
            validNeeded={protocol.validTrials}
            saving={saving}
            saveFailed={saveFailed}
            onSave={() => {
              const nowMs = Date.now();
              const notes = errorCountsOf(run.summaries)
                .map((counts) =>
                  t(`reaction.notes.${counts.task}`, {
                    anticipations: counts.anticipations,
                    lapses: counts.lapses,
                    commissions: counts.commissions,
                    noGo: counts.noGoTrials,
                  }),
                )
                .join(' ');
              const input = reactionResultInput({
                clientUuid: services.randomUUID(),
                playerId: player.id,
                testDefinitionId: definition.id,
                deviceId: device.id,
                measuredOn: clubToday(setup, nowMs),
                evaluatorId: userId,
                summaries: run.summaries,
                notes: notes === '' ? null : notes,
                randomUUID: services.randomUUID,
                recordedAt: new Date(nowMs).toISOString(),
              });
              if (input === null) return;
              setSaving(true);
              setSaveFailed(false);
              services.sync
                .enqueue('test_result.create', input)
                .then(() => {
                  forgetPlayer();
                  setNotice({ level: 'ok', text: t('reaction.saved') });
                })
                .catch((error: unknown) => {
                  services.reportError(error);
                  setSaveFailed(true);
                })
                .finally(() => {
                  setSaving(false);
                });
            }}
            onRepeat={() => {
              setHistory(null);
              setSaveFailed(false);
              runner.start(protocol);
            }}
            onDiscard={forgetPlayer}
          />
        );
      case 'idle':
        break;
    }
  }

  const deviceStatus: DeviceStatus =
    device === null
      ? { kind: 'unregistered' }
      : device.retiredAt !== null
        ? { kind: 'retired', label: device.label }
        : { kind: 'registered', label: device.label };
  const roster = rosterQuery.data?.data ?? [];

  return (
    <ReactionSetupScreen
      offline={offline}
      fromCache={setupQuery.data?.fromCache === true}
      hasDefinition={setup.definition !== null}
      device={deviceStatus}
      canManageDevice={canManageDevice}
      deviceLabel={deviceLabel}
      onChangeDeviceLabel={setDeviceLabel}
      registering={registering}
      registerFailed={registerFailed}
      onRegisterDevice={() => {
        setRegistering(true);
        setRegisterFailed(false);
        registerThisDevice(api, services.readCache, scope, {
          setup,
          installationId,
          label: deviceLabel.trim(),
          hardware: services.hardware,
          clientUuid: services.randomUUID(),
        })
          .then((next) => {
            queryClient.setQueryData(setupKey, { data: next, fromCache: false });
          })
          .catch((error: unknown) => {
            services.reportError(error);
            setRegisterFailed(true);
          })
          .finally(() => {
            setRegistering(false);
          });
      }}
      categories={setup.categories}
      categoryId={categoryId}
      onSelectCategory={(id) => {
        setNotice(null);
        setCategoryId(id);
      }}
      players={
        categoryId === null
          ? null
          : rosterQuery.isError
            ? { status: 'error', message: t('reaction.player.loadFailed') }
            : rosterQuery.data === undefined
              ? { status: 'loading' }
              : {
                  status: 'ready',
                  data: roster.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` })),
                }
      }
      onSelectPlayer={(playerId) => {
        const chosen = roster.find((p) => p.id === playerId);
        if (chosen === undefined) return;
        setNotice(null);
        setHistory(null);
        setInterrupted(false);
        setPlayer({ id: chosen.id, name: `${chosen.firstName} ${chosen.lastName}` });
        runner.start(protocol);
      }}
      notice={notice}
    />
  );
}
