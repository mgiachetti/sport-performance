import { expect, test, type Page } from '@playwright/test';
import { DEMO_INJURY_DIAGNOSIS_PREFIX, type DemoPlayer } from '@sport-performance/db/seeds';
import {
  activePlayers,
  coachRugbySeniorScope,
  recentlyHeldPlayers,
  rosterName,
} from '../src/harness/index.ts';
import { dataset, pageTitle, runState, sessionFile, t } from './support.ts';

/**
 * The rugby coach of M17 and M19 in the demo (`entrenador.rugby`, assigned
 * by `staff_assignment`): sees only their categories, sees "no disponible"
 * of an injured player and never the diagnosis (CLAUDE.md, roles; ADR 0008).
 */
test.use({ storageState: sessionFile('coachRugbySenior') });

const inScope = () => activePlayers(dataset(), coachRugbySeniorScope);

/**
 * Searches the roster by last name and waits until the list is the answer to
 * that search (deferred and server-side): either "no players" or only rows
 * that match it. Only then does "the player is not there" mean something.
 */
async function search(page: Page, player: DemoPlayer) {
  const term = player.lastName.toLowerCase();
  await page.getByLabel(t('players.search')).fill(player.lastName);
  const rows = page.getByRole('table').getByRole('rowheader');
  await expect
    .poll(async () => {
      if (await page.getByText(t('players.empty')).isVisible()) return true;
      const names = await rows.allInnerTexts();
      return names.length > 0 && names.every((name) => name.toLowerCase().includes(term));
    })
    .toBe(true);
}

test('the roster shows the assigned categories and nothing else', async ({ page }) => {
  const mine = inScope();
  const mineNames = new Set(mine.map(rosterName));
  const others = activePlayers(dataset(), (c) => !coachRugbySeniorScope(c)).filter(
    (p) => !mineNames.has(rosterName(p)),
  );
  const own = mine[0];
  const juniorRugby = others.find((p) => p.sport === 'rugby');
  const hockey = others.find((p) => p.sport === 'hockey');
  if (own === undefined || juniorRugby === undefined || hockey === undefined) {
    throw new Error('The demo dataset lacks the players this scenario needs.');
  }

  await page.goto('/players');
  await expect(pageTitle(page, t('players.title'))).toBeVisible();

  await search(page, own);
  await expect(page.getByRole('link', { name: rosterName(own), exact: true })).toBeVisible();

  for (const player of [juniorRugby, hockey]) {
    await search(page, player);
    await expect(page.getByRole('link', { name: rosterName(player), exact: true })).toHaveCount(0);
  }
});

test('an injured player is "no disponible", without the diagnosis', async ({ page }) => {
  // The stack's injury of the run (open today, every day of the year: `fixtures.ts`).
  const fixture = runState().injuryFixture;
  const player = inScope().find((p) => p.id === fixture.playerId);
  if (player === undefined) {
    throw new Error('The injury fixture of the stack is not on a player of these categories.');
  }

  await page.goto('/players');
  await search(page, player);
  await page.getByRole('link', { name: rosterName(player), exact: true }).click();
  // The availability card of the profile: a region named by its title.
  const availability = page.getByRole('region', {
    name: t('player.availability.title'),
    exact: true,
  });
  await expect(availability).toBeVisible();
  await expect(
    availability.getByText(t('player.availability.status.unavailable')).first(),
  ).toBeVisible();

  // Nothing of the medical record reaches the coach: not the diagnosis of the fixture, not
  // those of the demo's recent injuries of this player, not even how the demo's diagnoses start.
  const text = await page.locator('main').innerText();
  const diagnoses = [
    fixture.diagnosis,
    ...recentlyHeldPlayers(dataset(), [player]).flatMap(({ injuries }) =>
      injuries.map((i) => i.diagnosis),
    ),
  ];
  for (const diagnosis of diagnoses) {
    expect(text).not.toContain(diagnosis);
  }
  expect(text).not.toContain(DEMO_INJURY_DIAGNOSIS_PREFIX);
});
