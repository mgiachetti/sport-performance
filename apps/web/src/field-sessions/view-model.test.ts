import { describe, expect, it } from 'vitest';
import * as fs from '../test/field-session-fixtures';
import {
  mixedSources,
  playerBars,
  referenceOf,
  sessionKpis,
  sourcesOf,
  splitByLine,
  valueOf,
  viewColumns,
} from './view-model';

describe('field session view model', () => {
  it('flags a metric measured by several sources and names them', () => {
    const columns = viewColumns({
      columns: [
        { metricCode: 'dist_m', source: 'catapult', unit: 'm', direction: 'higher_is_better' },
        { metricCode: 'dist_m', source: 'pod', unit: 'm', direction: 'higher_is_better' },
        { metricCode: 'hr_avg', source: 'hr_band', unit: 'bpm', direction: 'neutral' },
      ] as never,
    });
    expect(columns.map((c) => [c.key, c.sharedMetric])).toEqual([
      ['dist_m:catapult', true],
      ['dist_m:pod', true],
      ['hr_avg:hr_band', false],
    ]);
    expect(mixedSources(columns)).toEqual({
      metricCodes: ['dist_m'],
      sources: ['catapult', 'pod'],
    });
    expect(sourcesOf(columns)).toEqual(['catapult', 'pod', 'hr_band']);
    expect(mixedSources(columns.slice(2))).toBeNull();
  });

  it('reads one value per metric and source, never another source', () => {
    const player = { values: fs.values(['dist_m', 'pod', 5090]) };
    expect(valueOf(player, { metricCode: 'dist_m', source: 'pod' })).toBe(5090);
    expect(valueOf(player, { metricCode: 'dist_m', source: 'catapult' })).toBeNull();
  });

  it('summarises the mean distance and HSR, the top Vmax and the total contacts', () => {
    const view = fs.fieldSession();
    const kpis = sessionKpis(view, viewColumns(view));
    expect(kpis.map((k) => [k.metricCode, k.value, k.count])).toEqual([
      ['dist_m', 5675, 2],
      ['hsr_abs_m', 415, 2],
      ['vmax_ms', 8.61, 2],
      ['contacts_n', 24, 2],
    ]);
    expect(kpis[2]?.leader?.lastName).toBe('Bianchi');
    expect(kpis[0]?.leader).toBeNull();
  });

  it('skips the cards of metrics the session does not have', () => {
    const view = fs.fieldSession({ columns: [], players: [fs.CASTRO] });
    expect(sessionKpis(view, viewColumns(view))).toEqual([]);
  });

  it('sorts the bars highest first and splits them by line only when every player has one', () => {
    const view = fs.fieldSession();
    const bars = playerBars(view, { metricCode: 'dist_m', source: 'catapult' });
    expect(bars.map((b) => [b.player.lastName, b.value, b.line])).toEqual([
      ['Bianchi', 6230, 'backs'],
      ['Álvarez', 5120, 'forwards'],
    ]);
    expect(splitByLine(bars)).toBe(true);
    const unpositioned = playerBars(
      {
        players: [...view.players, { ...fs.CASTRO, values: fs.values(['dist_m', 'catapult', 1]) }],
      },
      { metricCode: 'dist_m', source: 'catapult' },
    );
    expect(splitByLine(unpositioned)).toBe(false);
    expect(splitByLine([])).toBe(false);
  });

  it('finds the first-team reference of a metric', () => {
    const view = fs.fieldSession();
    expect(referenceOf(view, 'dist_m')?.value).toBe(6000);
    expect(referenceOf(view, 'vmax_ms')).toBeNull();
  });
});
