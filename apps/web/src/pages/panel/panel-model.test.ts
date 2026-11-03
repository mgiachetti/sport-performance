import { describe, expect, it } from 'vitest';
import { M15_RUGBY, M17_RUGBY } from '../../test/fixtures';
import { panelPlayer, squad, weeklyPanel } from './panel-fixtures';
import {
  isCurrentWeek,
  panelGroups,
  panelSummary,
  playersNeedingAttention,
  weeklyLoadSeries,
  worstSeverity,
} from './panel-model';
import { parsePanelSearch } from './panel-search';

describe('panel groups', () => {
  it('groups by category in the club order, leaving empty categories out', () => {
    const groups = panelGroups(squad(), 'category', [M17_RUGBY, M15_RUGBY]);
    expect(groups.map((g) => [g.label, g.players.map((p) => p.lastName)])).toEqual([
      [{ kind: 'category', name: 'M17' }, ['Roldán']],
      [{ kind: 'category', name: 'M15' }, ['Bianchi', 'Paz']],
    ]);
  });

  it('bio-bands by the offset projected to the reference day, the rest apart', () => {
    const groups = panelGroups(squad(), 'phv_offset', [M15_RUGBY, M17_RUGBY]);
    expect(groups.map((g) => [g.key, g.players.map((p) => p.lastName)])).toEqual([
      ['circa_phv', ['Bianchi']],
      ['post_phv', ['Paz']],
      ['unbanded', ['Roldán']],
    ]);
  });

  it('bio-bands by % of adult height with its own scheme', () => {
    const groups = panelGroups(squad(), 'pct_adult_height', [M15_RUGBY]);
    expect(groups.map((g) => [g.key, g.players.length])).toEqual([
      ['mid_pubertal', 1],
      ['unbanded', 2],
    ]);
  });
});

describe('panel summary', () => {
  it('counts who answered today in the current week, and in the week otherwise', () => {
    expect(panelSummary(squad(), true)).toEqual({
      players: 3,
      wellnessResponded: 1,
      wellnessMeanScore: 3.5,
      wellnessPlayers: 2,
      loadMeanAu: 1000,
      loadPlayers: 2,
      withAlerts: 2,
      critical: 1,
    });
    expect(panelSummary(squad(), false).wellnessResponded).toBe(2);
    expect(panelSummary([], true)).toMatchObject({ wellnessMeanScore: null, loadMeanAu: null });
  });

  it('knows the current week', () => {
    const panel = weeklyPanel([]);
    expect(isCurrentWeek(panel)).toBe(true);
    expect(isCurrentWeek({ ...panel, today: panel.week.to, week: { ...panel.week } })).toBe(true);
    expect(isCurrentWeek(weeklyPanel([], panel.weeks[0]?.from))).toBe(false);
  });
});

describe('weekly load series', () => {
  it('averages the players with load each week, and the chronic of those with history', () => {
    const players = squad();
    const series = weeklyLoadSeries(weeklyPanel(players).weeks, players);
    expect(series.map((p) => [p.meanLoadAu, p.meanChronicWeeklyAu])).toEqual([
      [1200, 1200],
      [1300, 1225],
      [1400, 1275],
      [1000, 1325],
    ]);
    expect(weeklyLoadSeries(weeklyPanel([]).weeks, [panelPlayer(9)])[0]).toMatchObject({
      meanLoadAu: null,
      meanChronicWeeklyAu: null,
    });
  });
});

describe('attention', () => {
  it('puts critical first and keeps the roster order otherwise', () => {
    const [bianchi, paz, roldan] = squad();
    expect(bianchi && worstSeverity(bianchi)).toBe('critical');
    expect(paz && worstSeverity(paz)).toBeNull();
    expect(roldan && worstSeverity(roldan)).toBe('warning');
    const order = playersNeedingAttention([roldan, paz, bianchi].filter((p) => p !== undefined));
    expect(order.map((p) => p.lastName)).toEqual(['Bianchi', 'Roldán']);
  });
});

describe('panel search', () => {
  it('keeps a valid week and maturity grouping, drops the rest', () => {
    expect(parsePanelSearch({ week: '2026-10-28', group: 'phv_offset' })).toEqual({
      week: '2026-10-28',
      group: 'phv_offset',
    });
    expect(parsePanelSearch({ week: '28/10/2026', group: 'category' })).toEqual({});
    expect(parsePanelSearch({ group: 'age' })).toEqual({});
  });
});
