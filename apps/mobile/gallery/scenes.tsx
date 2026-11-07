import {
  clubThemeSchema,
  membershipSchema,
  type ClubTheme,
  type MembershipSummary,
  type MyTestDay,
  type PlayerConsents,
  type PlayerPercentile,
} from '@sport-performance/contracts';
import { localDate, parseTimeZone } from '@sport-performance/domain';
import type { ReactElement } from 'react';
import type { SheetPlayer } from '../src/coach-session/view.ts';
import type { KioskPlayer } from '../src/kiosk/roster.ts';
import type { SyncStatus } from '../src/offline/engine.ts';
import type { RpeSession } from '../src/player/today.ts';
import { AccountScreen, HomeScreen } from '../src/screens/app.tsx';
import { NoClubScreen, SelectClubScreen } from '../src/screens/clubs.tsx';
import { CoachSessionSheetScreen } from '../src/screens/coach-session.tsx';
import {
  KioskExitScreen,
  KioskPickScreen,
  KioskSetupScreen,
  KioskTurn,
} from '../src/screens/kiosk.tsx';
import { PlayerConsentsScreen } from '../src/screens/player-consents.tsx';
import { PlayerTestsScreen } from '../src/screens/player-tests.tsx';
import {
  PlayerTodayScreen,
  type PlayerTodayActions,
  type PlayerTodayData,
} from '../src/screens/player-today.tsx';
import { PlayerAccessScreen, SignInScreen, VerifyCodeScreen } from '../src/screens/sign-in.tsx';
import { AlertDetailScreen, StaffBoardScreen } from '../src/screens/staff.tsx';
import { SyncIndicator } from '../src/screens/sync.tsx';
import { buildBoard } from '../src/staff/board.ts';
import {
  M15,
  M17,
  TODAY as STAFF_TODAY,
  alertDetail,
  panelAlert,
  panelPlayer,
  squad,
  weeklyPanel,
} from '../src/test/staff-fixtures.ts';

/**
 * Fixture props for each scene of `scene-list.ts`: the same shapes the routes
 * pass, so the gallery shows the real screens. Callbacks do nothing.
 */

const noop = () => undefined;
const resolved = () => Promise.resolve();
const TZ = parseTimeZone('America/Argentina/Buenos_Aires');
const TODAY = localDate(2026, 11, 3);
const NOW = Date.UTC(2026, 10, 3, 21, 0, 0);
const CLUB = { id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', slug: 'orc', name: 'Olivos Rugby Club' };

function membership(
  id: string,
  role: MembershipSummary['role'],
  club: typeof CLUB = CLUB,
): MembershipSummary {
  return membershipSchema.parse({ id, role, club, startedAt: '2026-03-01T12:00:00.000Z' });
}

const COACH = membership('a1111111-1111-4111-8111-111111111111', 'coach');
const PLAYER = membership('a4444444-4444-4444-8444-444444444444', 'player');
const SC_OTHER = membership('a3333333-3333-4333-8333-333333333333', 'sc', {
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  slug: 'otro',
  name: 'Atlético Otro',
});

/** The ORC brand with the crest the demo club serves (the gallery serves the same PNG). */
export const ORC_THEME: ClubTheme = clubThemeSchema.parse({
  clubId: CLUB.id,
  slug: 'orc',
  name: CLUB.name,
  shortName: 'ORC',
  logoUrl: new URL('/escudo.png', location.href).href,
  colors: {
    primary: '#F1882A',
    onPrimary: '#050505',
    secondary: '#050505',
    onSecondary: '#F3EEE7',
  },
  updatedAt: '2026-10-01T12:00:00.000Z',
});

const idleSync: SyncStatus = {
  membershipId: COACH.id,
  phase: 'idle',
  pause: null,
  pendingCount: 0,
  issueCount: 0,
  lastSyncedAt: NOW - 5 * 60_000,
  nextAttemptAt: null,
};
const offlineSync: SyncStatus = {
  ...idleSync,
  phase: 'offline',
  pendingCount: 2,
  nextAttemptAt: NOW + 30_000,
};

const playerActions: PlayerTodayActions = {
  onSubmitWellness: resolved,
  onCorrectWellness: resolved,
  onSubmitRpe: resolved,
  onRetry: noop,
  onOpenPainReport: noop,
  onOpenExternalLoad: noop,
};

const rpeSession: RpeSession = {
  session: {
    id: 'c1111111-1111-4111-8111-111111111111' as RpeSession['session']['id'],
    sport: 'rugby',
    kind: 'training',
    categoryId: null,
    title: null,
    startsAt: '2026-11-03T22:00:00.000Z',
    localDate: TODAY,
    plannedDurationMin: 90,
    archivedAt: null,
  },
  closesAt: '2026-11-05T03:00:00.000Z',
  rpe: null,
  minutes: 90,
  pending: false,
  canSubmit: true,
};

const nextTestDay: MyTestDay = {
  id: 'e1111111-1111-4111-8111-111111111111' as MyTestDay['id'],
  scheduledOn: localDate(2026, 11, 10),
  status: 'scheduled',
  location: 'Cancha 2',
  testWindow: { id: 'f1111111-1111-4111-8111-111111111111' as never, number: 4, label: 'V4' },
  testCodes: ['sprint_40', 'cmj'],
};

function today(overrides: Partial<PlayerTodayData> = {}): PlayerTodayData {
  return {
    today: TODAY,
    timeZone: TZ,
    wellness: { kind: 'form', itemCount: 3, items: ['sleep', 'fatigue', 'soreness'], entry: null },
    rpe: { allowed: true, sessions: [rpeSession] },
    streak: { days: 11, includesToday: false },
    nextTestDay,
    ...overrides,
  };
}

const FIVE = ['sleep', 'fatigue', 'soreness', 'stress', 'mood'] as const;

const percentile: PlayerPercentile = {
  metricCode: 'cmj_height_cm',
  testCode: 'cmj',
  exercise: null,
  unit: 'cm',
  direction: 'higher_is_better',
  value: 38.5,
  measuredOn: localDate(2026, 10, 1),
  method: 'app',
  protocolVersion: 1,
  status: 'ok',
  percentile: 72,
  sampleSize: 18,
  grouping: { dimensions: ['sex', 'category'], seasonsAccumulated: 1 },
  seasonFrom: 2026,
  seasonTo: 2026,
  median: 36,
  mixedMethods: false,
};

const records = [
  {
    key: 'sprint_40_s:',
    metricCode: 'sprint_40_s',
    testCode: 'sprint_40',
    exercise: null,
    unit: 's',
    direction: 'lower_is_better',
    value: 5.42,
    measuredOn: localDate(2026, 9, 2),
    method: 'manual',
    resultCount: 3,
    mixedMethods: true,
  },
  {
    key: 'cmj_height_cm:',
    metricCode: 'cmj_height_cm',
    testCode: 'cmj',
    exercise: null,
    unit: 'cm',
    direction: 'higher_is_better',
    value: 38.5,
    measuredOn: localDate(2026, 10, 1),
    method: 'app',
    resultCount: 4,
    mixedMethods: false,
  },
] as const;

function consents(): PlayerConsents {
  const doc = (type: 'data' | 'image', title: string, id: string) => ({
    id,
    type,
    version: '2026-11',
    locale: 'es-AR',
    title,
    bodySha256: 'a'.repeat(64),
    publishedAt: '2026-11-01T12:00:00.000Z',
    current: true,
  });
  return {
    playerId: 'b1111111-1111-4111-8111-111111111111',
    playerOfAge: true,
    requiredSigner: 'player',
    guardianSignaturesLapseOn: localDate(2027, 1, 1),
    types: [
      {
        type: 'data',
        state: 'missing',
        consent: null,
        currentDocument: doc('data', 'Datos personales', 'a9999999-1111-4111-8111-111111111111'),
        actions: ['sign'],
      },
    ],
  } as PlayerConsents;
}

function board(cached = false) {
  const players = squad();
  return {
    board: buildBoard({
      panel: weeklyPanel([
        ...players,
        panelPlayer(9, {
          firstName: 'Mateo',
          lastName: 'Ferreyra',
          alerts: [
            panelAlert({
              severity: 'warning',
              kind: 'wellness_low',
              messageKey: 'alert.wellness_low.message',
              values: { meanScore: 3.1, thresholdScore: 3.3 },
            }),
          ],
        }),
      ]),
      today: STAFF_TODAY,
      categories: [M15, M17],
      categoryId: null,
      wellnessPlayerIds: new Set(),
    }),
    freshness: { fetchedAt: NOW - 5 * 60_000, fromCache: cached, nowMs: NOW },
  };
}

function kioskPlayer(overrides: Partial<KioskPlayer> = {}): KioskPlayer {
  return {
    id: 'p1',
    firstName: 'Juan',
    lastName: 'Pérez',
    displayName: 'Juan P.',
    categoryIds: ['m13'],
    canReport: true,
    wellness: { itemCount: 3, items: ['sleep', 'fatigue', 'soreness'] },
    wellnessDone: false,
    rpe: [],
    ...overrides,
  };
}

function sheetPlayer(
  overrides: Partial<SheetPlayer> & Pick<SheetPlayer, 'id' | 'name'>,
): SheetPlayer {
  return {
    calledUp: false,
    availability: { status: 'available', staffNotes: [] },
    readOnly: null,
    row: { status: 'full', minutes: '90', contacts: '6' },
    errors: [],
    edited: false,
    unsent: false,
    rpe: null,
    srpeAu: null,
    field: null,
    playsWhileUnavailable: false,
    ...overrides,
  };
}

/** A rugby roster: pending statuses, a medical note, a player without consent, an edited row. */
const SHEET_PLAYERS: readonly SheetPlayer[] = [
  sheetPlayer({ id: 'p1', name: 'Acosta, Juan', rpe: 7, srpeAu: 630 }),
  sheetPlayer({
    id: 'p2',
    name: 'Bianchi, Tomás',
    availability: { status: 'limited', staffNotes: ['Sin contacto'] },
    row: { status: 'partial', minutes: '40', contacts: '0' },
    edited: true,
  }),
  sheetPlayer({ id: 'p3', name: 'Castro, Mateo', row: { status: '', minutes: '', contacts: '' } }),
  sheetPlayer({
    id: 'p4',
    name: 'Díaz, Valentín',
    availability: { status: 'unavailable', staffNotes: [] },
    row: { status: 'unavailable', minutes: '', contacts: '' },
    unsent: true,
  }),
  sheetPlayer({
    id: 'p5',
    name: 'Ferreyra, Lucas',
    readOnly: 'noConsent',
    availability: null,
    row: { status: '', minutes: '', contacts: '' },
  }),
];

const sheetSummaryOf = {
  present: 2,
  absent: 0,
  unavailable: 1,
  pending: 2,
  minutes: 130,
  contacts: 6,
};

function coachSheet(
  overrides: Partial<Parameters<typeof CoachSessionSheetScreen>[0]> = {},
): ReactElement {
  return (
    <CoachSessionSheetScreen
      title="Entrenamiento M17"
      when="Entrenamiento · 03/11/2026 18:00"
      plannedMinutes={90}
      roster={{ status: 'ready', players: SHEET_PLAYERS, staleSince: null }}
      clock={{ status: 'off' }}
      summary={sheetSummaryOf}
      changeCount={1}
      needsReason={false}
      reason=""
      reasonMissing={false}
      saving={false}
      notice={null}
      confirmDiscard={false}
      onBack={noop}
      onRetryRoster={noop}
      onStatus={noop}
      onMinutes={noop}
      onContacts={noop}
      onContactsText={noop}
      onToggleField={noop}
      onStartClock={noop}
      onPauseClock={noop}
      onFinishClock={noop}
      onFillPresent={noop}
      onReason={noop}
      onSave={noop}
      onDiscard={noop}
      onCancelDiscard={noop}
      {...overrides}
    />
  );
}

const KIOSK_NAMES = ['Ana A.', 'Bruno C.', 'Juan P.', 'Lola M.', 'Tomás G.', 'Valentín R.'];

const alertForDetail = panelAlert();
const alertPlayer = panelPlayer(2, { firstName: 'Juan', lastName: 'Acosta' });

export interface Scene {
  /** The active club's brand for the theme (the sign-in has none yet). */
  readonly clubTheme: ClubTheme | null;
  readonly render: () => ReactElement;
}

const club = (render: () => ReactElement): Scene => ({ clubTheme: ORC_THEME, render });
/** Before choosing a club the app has the default brand and no crest. */
const noClub = (render: () => ReactElement): Scene => ({ clubTheme: null, render });

export const SCENE_RENDERERS: Readonly<Record<string, Scene>> = {
  'sign-in': noClub(() => (
    <SignInScreen
      notice={null}
      requestCode={() => Promise.resolve(600)}
      onCodeSent={noop}
      onPlayerAccess={noop}
    />
  )),
  'verify-code': noClub(() => (
    <VerifyCodeScreen
      email="ana@example.com"
      expiresInS={600}
      verify={resolved}
      resend={() => Promise.resolve(600)}
      onChangeEmail={noop}
    />
  )),
  'player-access': noClub(() => <PlayerAccessScreen redeem={resolved} onUseEmail={noop} />),
  'select-club': noClub(() => (
    <SelectClubScreen
      memberships={[COACH, PLAYER, SC_OTHER]}
      activeMembershipId={COACH.id}
      notice={null}
      onSelect={noop}
    />
  )),
  'select-club-none': noClub(() => <NoClubScreen offline onRetry={noop} onSignOut={noop} />),
  'player-today-faces': club(() => (
    <PlayerTodayScreen
      greeting="Hola, Tomás"
      state={{ status: 'ready', data: today() }}
      notice={null}
      sync={<SyncIndicator status={idleSync} nowMs={NOW} onSyncNow={noop} />}
      actions={playerActions}
    />
  )),
  'player-today-faces-filled': club(() => (
    <PlayerTodayScreen
      greeting="Hola, Tomás"
      state={{ status: 'ready', data: today() }}
      notice={null}
      actions={playerActions}
    />
  )),
  'player-today-scale': club(() => (
    <PlayerTodayScreen
      greeting="Hola, Valentina"
      state={{
        status: 'ready',
        data: today({ wellness: { kind: 'form', itemCount: 5, items: FIVE, entry: null } }),
      }}
      notice={null}
      actions={{ ...playerActions, onOpenMenstrualCycle: noop }}
    />
  )),
  'player-today-done': club(() => (
    <PlayerTodayScreen
      greeting="Hola, Tomás"
      state={{
        status: 'ready',
        data: today({
          wellness: {
            kind: 'form',
            itemCount: 5,
            items: FIVE,
            entry: {
              scores: { sleep: 4, fatigue: 3, soreness: 2, stress: 4, mood: 5 },
              target: { clientUuid: 'd2222222-2222-4222-8222-222222222222' },
              pending: false,
            },
          },
          rpe: { allowed: true, sessions: [{ ...rpeSession, rpe: 6 }] },
          streak: { days: 12, includesToday: true },
        }),
      }}
      notice={null}
      actions={playerActions}
    />
  )),
  'player-today-offline': club(() => (
    <PlayerTodayScreen
      greeting="Hola, Tomás"
      state={{
        status: 'ready',
        data: today({
          wellness: {
            kind: 'form',
            itemCount: 3,
            items: ['sleep', 'fatigue', 'soreness'],
            entry: {
              scores: { sleep: 4, fatigue: 3, soreness: 4 },
              target: { clientUuid: 'd3333333-3333-4333-8333-333333333333' },
              pending: true,
            },
          },
        }),
      }}
      notice="Sin señal: lo que ves es lo guardado en el teléfono el 03/11 a las 17:40."
      sync={<SyncIndicator status={offlineSync} nowMs={NOW} onSyncNow={noop} />}
      actions={playerActions}
    />
  )),
  'player-tests': club(() => (
    <PlayerTestsScreen
      notice={null}
      records={records}
      percentiles={{
        kind: 'ready',
        items: [
          percentile,
          {
            ...percentile,
            metricCode: 'sprint_40_s',
            testCode: 'sprint_40',
            unit: 's',
            value: 5.42,
            status: 'insufficient_sample',
            percentile: null,
            sampleSize: null,
          },
        ],
      }}
      history={[]}
      testDays={[nextTestDay]}
    />
  )),
  'player-tests-history': club(() => (
    <PlayerTestsScreen
      notice={null}
      records={records}
      percentiles={{ kind: 'ready', items: [percentile] }}
      history={[]}
      testDays={[nextTestDay]}
      initialTab="history"
    />
  )),
  'player-tests-upcoming': club(() => (
    <PlayerTestsScreen
      notice={null}
      records={records}
      percentiles={{ kind: 'ready', items: [percentile] }}
      history={[]}
      testDays={[nextTestDay]}
      initialTab="upcoming"
    />
  )),
  'coach-session-attendance': club(() => coachSheet()),
  'coach-session-minutes': club(() =>
    coachSheet({
      initialTab: 'minutes',
      clock: { status: 'running', elapsedS: 1520, onField: 2, periods: 0 },
      roster: {
        status: 'ready',
        staleSince: null,
        players: SHEET_PLAYERS.map((player) =>
          player.readOnly === null
            ? { ...player, field: { on: player.id !== 'p3', minutes: 25 } }
            : player,
        ),
      },
    }),
  ),
  'coach-session-contacts-error': club(() =>
    coachSheet({
      initialTab: 'attendance',
      roster: {
        status: 'ready',
        staleSince: null,
        players: SHEET_PLAYERS.map((player) =>
          player.id === 'p1'
            ? { ...player, row: { ...player.row, contacts: '999' }, errors: ['contacts'] }
            : player,
        ),
      },
    }),
  ),
  'coach-session-hockey': club(() =>
    coachSheet({
      initialTab: 'minutes',
      fieldRules: { contacts: false, byPeriod: true },
      clock: { status: 'paused', elapsedS: 1800, onField: 0, periods: 2 },
      summary: { ...sheetSummaryOf, contacts: 0 },
      roster: {
        status: 'ready',
        staleSince: null,
        players: SHEET_PLAYERS.map((player) => ({
          ...player,
          row: { ...player.row, contacts: '', periods: player.row.minutes === '' ? '' : '15,15' },
        })),
      },
    }),
  ),
  'player-tests-m13': club(() => (
    <PlayerTestsScreen
      notice={null}
      records={[]}
      percentiles={{ kind: 'hidden' }}
      history={[]}
      testDays={[]}
    />
  )),
  'player-consents': club(() => (
    <PlayerConsentsScreen
      state={{ status: 'ready', consents: consents(), timeZone: TZ }}
      document={null}
      offline={false}
      busy={false}
      notice={null}
      error={null}
      actions={{
        onRead: noop,
        onSign: noop,
        onRevoke: noop,
        onCloseDocument: noop,
        onBack: noop,
        onRetry: noop,
      }}
    />
  )),
  'staff-home': club(() => (
    <HomeScreen
      userName="Ana"
      membership={COACH}
      clubTheme={ORC_THEME}
      sync={<SyncIndicator status={idleSync} nowMs={NOW} onSyncNow={noop} />}
      onOpenIft3015={noop}
      onOpenReaction={noop}
      onOpenWeeklyCmj={noop}
      onOpenSprintVideo={noop}
      onOpenAnthropometry={noop}
      onOpenCmjVideo={noop}
      onOpenKiosk={noop}
      onOpenProtocols={noop}
    />
  )),
  'staff-board': club(() => {
    const { board: value, freshness } = board();
    return (
      <StaffBoardScreen
        board={value}
        loading={false}
        error={null}
        freshness={freshness}
        categories={[
          { id: M15.id, name: 'M15' },
          { id: M17.id, name: 'M17' },
        ]}
        categoryId={null}
        sessionFilter={null}
        push={{ status: 'needsPermission', busy: false }}
        onSelectCategory={noop}
        onOpenAlert={noop}
        onRetry={noop}
        onEnablePush={noop}
      />
    );
  }),
  'staff-board-cached': club(() => {
    const { board: value, freshness } = board(true);
    return (
      <StaffBoardScreen
        board={value}
        loading={false}
        error={null}
        freshness={freshness}
        categories={[
          { id: M15.id, name: 'M15' },
          { id: M17.id, name: 'M17' },
        ]}
        categoryId={M15.id}
        sessionFilter="Entrenamiento M15"
        push={{ status: 'registered', busy: false }}
        onSelectCategory={noop}
        onOpenAlert={noop}
        onRetry={noop}
        onEnablePush={noop}
      />
    );
  }),
  'staff-alert': club(() => (
    <AlertDetailScreen
      view={{ source: 'detail', alert: alertDetail(alertForDetail, alertPlayer) }}
      playerName="Juan Acosta"
      loading={false}
      error={null}
      freshness={{ fetchedAt: NOW - 60_000, fromCache: false, nowMs: NOW }}
      canReview
      online
      reviewing={false}
      notice={null}
      onReview={noop}
      onBack={noop}
    />
  )),
  'kiosk-setup': club(() => (
    <KioskSetupScreen
      categories={{
        status: 'ready',
        data: [
          { id: 'm13', name: 'M13' },
          { id: 'm14', name: 'M14' },
        ],
      }}
      starting={false}
      error={null}
      onStart={noop}
      onCancel={noop}
    />
  )),
  'kiosk-pick': club(() => (
    <KioskPickScreen
      title="Kiosco · M13"
      players={{
        status: 'ready',
        data: KIOSK_NAMES.map((name, index) =>
          kioskPlayer({ id: `p${String(index)}`, displayName: name }),
        ),
      }}
      keptAt={null}
      timeZone={TZ}
      sync={<SyncIndicator status={idleSync} nowMs={NOW} />}
      onPick={noop}
      onExit={noop}
    />
  )),
  'kiosk-turn-confirm': club(() => (
    <KioskTurn
      player={kioskPlayer({ rpe: [] })}
      timeZone={TZ}
      actions={{ onSubmitWellness: resolved, onSubmitRpe: resolved, onFinish: noop }}
    />
  )),
  'kiosk-turn-wellness': club(() => (
    <KioskTurn
      player={kioskPlayer()}
      timeZone={TZ}
      actions={{ onSubmitWellness: resolved, onSubmitRpe: resolved, onFinish: noop }}
    />
  )),
  'kiosk-exit': club(() => (
    <KioskExitScreen timeZone={TZ} onSubmit={() => Promise.resolve({ ok: true })} onCancel={noop} />
  )),
  account: club(() => (
    <AccountScreen
      email="ana@example.com"
      membership={COACH}
      clubTheme={ORC_THEME}
      canChangeClub
      version="1.0.0 (12)"
      offline={false}
      signingOut={false}
      sync={<SyncIndicator status={idleSync} nowMs={NOW} detailed onSyncNow={noop} />}
      onChangeClub={noop}
      onSignOut={noop}
      onOpenNotifications={noop}
    />
  )),
  'account-offline': club(() => (
    <AccountScreen
      email="ana@example.com"
      membership={COACH}
      clubTheme={ORC_THEME}
      canChangeClub
      version="1.0.0 (12)"
      offline
      signingOut={false}
      pendingCount={2}
      confirmSignOut
      sync={<SyncIndicator status={offlineSync} nowMs={NOW} detailed onSyncNow={noop} />}
      onChangeClub={noop}
      onSignOut={noop}
    />
  )),
};
