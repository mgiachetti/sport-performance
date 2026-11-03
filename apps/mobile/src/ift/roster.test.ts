import {
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  ROLES,
  ift3015Schedule,
  newIft3015PlayerMarks,
  recordIft3015Miss,
  stopIft3015Player,
} from '@sport-performance/domain';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { canRunIft3015, fetchAllPages, resultRows, runRows } from './roster.ts';

const translator = createTranslator();
const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;

describe('IFT roster', () => {
  it('lets only who records test results run the test', () => {
    const allowed = ROLES.filter((role) => canRunIft3015(role));
    expect(allowed.sort()).toEqual(['admin', 'sc', 'superadmin']);
  });

  it('reads every page of the roster', async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
      start: { items: [1, 2], nextCursor: 'c2' },
      c2: { items: [3], nextCursor: null },
    };
    const cursors: (string | undefined)[] = [];
    const items = await fetchAllPages((cursor) => {
      cursors.push(cursor);
      return Promise.resolve(pages[cursor ?? 'start'] ?? { items: [], nextCursor: null });
    });
    expect(items).toEqual([1, 2, 3]);
    expect(cursors).toEqual([undefined, 'c2']);
    // A cursor that never ends is bounded.
    const endless = await fetchAllPages(() => Promise.resolve({ items: [0], nextCursor: 'x' }), 3);
    expect(endless).toHaveLength(3);
  });

  it('builds the rows of the run and of the results', () => {
    const schedule = ift3015Schedule(P);
    const names = new Map([['a', 'Juan Pérez']]);
    const missed = recordIft3015Miss(newIft3015PlayerMarks('a'), schedule, P, 9_100);
    const rows = runRows([missed, newIft3015PlayerMarks('b')], schedule, 9_500, names, translator);
    expect(rows.map((row) => [row.player.name, row.streak])).toEqual([
      ['Juan Pérez', 1],
      [translator.t('ift.player.unknown', { number: 2 }), 0],
    ]);
    const stopped = stopIft3015Player(missed, P, 50_000);
    const players = [stopped, newIft3015PlayerMarks('b')];
    const results = resultRows(
      { players, protocol: P, endedAtMs: null, endedBy: null },
      names,
      translator,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.result).toMatchObject({ lastCompletedStage: 1, viftKmh: 8 });
    expect(results[0]?.cutShort).toBe(false);
  });

  it('flags the players who were still running when an interrupted run was ended', () => {
    const early = stopIft3015Player(newIft3015PlayerMarks('a'), P, 50_000);
    const cut = stopIft3015Player(newIft3015PlayerMarks('b'), P, 100_000);
    const rows = (endedBy: 'interrupted' | 'staff') =>
      resultRows(
        { players: [early, cut], protocol: P, endedAtMs: 100_000, endedBy },
        new Map(),
        translator,
      ).map((row) => row.cutShort);
    expect(rows('interrupted')).toEqual([false, true]);
    expect(rows('staff')).toEqual([false, false]);
  });
});
