// @vitest-environment jsdom
import { MEMBERSHIP_HEADER } from '@sport-performance/contracts';
import { DEFAULT_CLUB_MODULES } from '@sport-performance/domain';
import { render, screen, waitFor } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN_KEY } from '../auth/session-store.ts';
import { CLUB_MODULES_READ, keptClubModules } from '../clubs/modules.ts';
import { tabVisibility } from '../navigation/tabs.ts';
import {
  COACH_AT_ORC,
  SESSION_TOKEN,
  USER,
  signedInRoutes,
  testServices,
} from '../test/fixtures.ts';
import { AppProviders, useSession } from './app-context.tsx';
import { useClubModules } from './club-modules.ts';

const VERSION = '1793586338688123';

/**
 * What the tab bar decides with the hook, as `app/(app)/(tabs)/_layout.tsx` does, for a
 * player (the role with the tab) while signed in as a member of the club.
 */
function GymTab() {
  const session = useSession();
  const role = session.status === 'signedIn' && session.activeMembership !== null ? 'player' : null;
  const { gym } = tabVisibility(role, useClubModules());
  return <Text>{gym ? 'gym-tab:shown' : 'gym-tab:hidden'}</Text>;
}

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

async function signedIn(modules: typeof DEFAULT_CLUB_MODULES | null) {
  const setup = testServices({ secure: { [SESSION_TOKEN_KEY]: SESSION_TOKEN } });
  signedInRoutes(setup.api, [COACH_AT_ORC]);
  if (modules !== null) {
    setup.api.on('GET /v1/configuration/modules', {
      status: 200,
      body: { modules, version: VERSION },
    });
  }
  disposals.push(() => {
    setup.services.dispose();
  });
  await setup.services.session.start();
  return setup;
}

describe('the gym tab and the club modules', () => {
  it('hides the tab when the club turned the gym off, keeps the answer and syncs again', async () => {
    const { services, api } = await signedIn({ ...DEFAULT_CLUB_MODULES, gym: false });
    const requestSync = vi.spyOn(services.sync, 'requestSync');
    render(
      <AppProviders services={services}>
        <GymTab />
      </AppProviders>,
    );
    expect(await screen.findByText('gym-tab:hidden')).toBeDefined();
    expect(api.last('GET /v1/configuration/modules')?.headers[MEMBERSHIP_HEADER]).toBe(
      COACH_AT_ORC.id,
    );
    // Kept by membership, where the sync engine reads what to pull.
    await waitFor(async () => {
      expect((await keptClubModules(services.readCache, COACH_AT_ORC.id))?.gym).toBe(false);
    });
    expect(requestSync).toHaveBeenCalled();
  });

  it('shows the tab while the module is on', async () => {
    const { services, api } = await signedIn(DEFAULT_CLUB_MODULES);
    render(
      <AppProviders services={services}>
        <GymTab />
      </AppProviders>,
    );
    await waitFor(() => {
      expect(api.last('GET /v1/configuration/modules')).toBeDefined();
    });
    expect(await screen.findByText('gym-tab:shown')).toBeDefined();
  });

  it('without signal, hides it with the kept answer, and shows it by default before any', async () => {
    const { services } = await signedIn(null);
    const first = render(
      <AppProviders services={services}>
        <GymTab />
      </AppProviders>,
    );
    // Never read: the defaults of the domain (the gym on).
    expect(await screen.findByText('gym-tab:shown')).toBeDefined();
    await services.readCache.put(
      { membershipId: COACH_AT_ORC.id, userId: USER.id },
      CLUB_MODULES_READ,
      { modules: { ...DEFAULT_CLUB_MODULES, gym: false }, version: VERSION },
    );
    first.unmount();
    services.queryClient.clear();
    render(
      <AppProviders services={services}>
        <GymTab />
      </AppProviders>,
    );
    expect(await screen.findByText('gym-tab:hidden')).toBeDefined();
  });
});
