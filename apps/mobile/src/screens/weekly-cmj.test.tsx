// @vitest-environment jsdom
import { parseAlertRule, parseLocalDate } from '@sport-performance/domain';
import { formatUnit } from '@sport-performance/i18n';
import { fireEvent, getDefaultNormalizer, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LocalRow } from '../offline/local-store.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { ANA_ID, BRUNO_ID, M17_ID, cmjResultDto } from '../test/weekly-cmj-fixtures.ts';
import {
  cmjResults,
  weeklyCmjRows,
  type ResultTarget,
  type WeeklyCmjPlayer,
  type WeeklyCmjRow,
  type WeeklyCmjSettings,
} from '../weekly-cmj/model.ts';
import { HomeScreen } from './app.tsx';
import { WeeklyCmjScreen, type WeeklyCmjSetupState } from './weekly-cmj.tsx';

const { t } = translator;
const cm = (value: number) => formatUnit(value, 'cm', { decimals: 1 });
/** Keeps the no-break space between a number and its unit. */
const normalizer = getDefaultNormalizer({ collapseWhitespace: false });
const TODAY = parseLocalDate('2026-11-03');
const RULE = parseAlertRule({
  code: 'cmj_drop',
  kind: 'cmj_drop',
  enabled: true,
  params: {
    warningDropPct: 7,
    criticalDropPct: null,
    baselineWindowDays: 42,
    minBaselineSamples: 3,
    maxMeasurementAgeDays: 7,
  },
});
const SETUP: WeeklyCmjSetupState = {
  status: 'ready',
  protocol: { version: 2, attemptCount: 3, aggregation: 'best' },
  categories: [{ id: M17_ID, name: 'M17' }],
};
const SETTINGS: WeeklyCmjSettings = { method: 'app', mode: 'height_cm', categoryId: M17_ID };

function player(
  playerId: string,
  firstName: string,
  overrides: Partial<WeeklyCmjPlayer> = {},
): WeeklyCmjPlayer {
  return {
    playerId,
    firstName,
    lastName: 'Pérez',
    sex: 'male',
    sport: 'rugby',
    stage: 'performance',
    availability: 'available',
    ...overrides,
  };
}

function rows(todayHeights: readonly number[] = []) {
  const served = [
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-13', heightsCm: [40] }),
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-20', heightsCm: [41] }),
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [42] }),
    ...(todayHeights.length === 0
      ? []
      : [cmjResultDto({ playerId: ANA_ID, measuredOn: TODAY, heightsCm: todayHeights })]),
  ].map((data): LocalRow<'test_result'> => ({
    id: data.id,
    clientUuid: null,
    data,
    pending: false,
  }));
  return weeklyCmjRows({
    players: [player(ANA_ID, 'Ana'), player(BRUNO_ID, 'Bruno', { availability: 'unavailable' })],
    results: cmjResults(served, [], 'best'),
    rules: [RULE],
    today: TODAY,
    method: 'app',
  });
}

function renderReady(
  overrides: Partial<Parameters<typeof WeeklyCmjScreen>[0]> = {},
  todayHeights: readonly number[] = [],
) {
  const onRecord = vi.fn<(row: WeeklyCmjRow, values: readonly number[]) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const onVoid = vi.fn<(target: ResultTarget, entryId: string, reason: string) => Promise<void>>(
    () => Promise.resolve(),
  );
  const props = {
    setup: SETUP,
    roster: {
      status: 'ready',
      rows: rows(todayHeights),
      otherStages: 1,
      savedAt: '03/11/2026 09:00',
    } as const,
    settings: SETTINGS,
    offline: true,
    refreshing: false,
    refreshFailed: false,
    onRefresh: vi.fn(),
    onChangeSettings: vi.fn(),
    onRecord,
    onVoid,
    ...overrides,
  };
  renderScreen(<WeeklyCmjScreen {...props} />);
  return { ...props, onRecord, onVoid };
}

describe('HomeScreen', () => {
  it('opens the weekly CMJ only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenWeeklyCmj={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('weeklyCmj.open') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('weeklyCmj.open') })).toBeNull();
  });
});

describe('WeeklyCmjScreen', () => {
  it('asks to open it once with signal when nothing is on the phone', () => {
    renderReady({ setup: { status: 'missing' }, roster: null });
    expect(screen.getByText(t('weeklyCmj.setup.missing'))).toBeTruthy();
    expect(screen.getByText(t('sync.offline'))).toBeTruthy();
  });

  it('shows the protocol, who is left out, the baseline and who is not available', () => {
    renderReady();
    expect(
      screen.getByText(t('weeklyCmj.protocol', { version: 2, count: 3, aggregation: 'best' })),
    ).toBeTruthy();
    expect(screen.getByText(t('weeklyCmj.roster.otherStages', { count: 1 }))).toBeTruthy();
    expect(
      screen.getByText(t('weeklyCmj.baseline', { height: cm(41), count: 3, weeks: 6 }), {
        normalizer,
      }),
    ).toBeTruthy();
    expect(screen.getByText(t('weeklyCmj.baseline.none', { samples: 0, min: 3 }))).toBeTruthy();
    expect(screen.getByText(t('weeklyCmj.player.unavailable'))).toBeTruthy();
    expect(screen.getByText(t('weeklyCmj.progress', { done: 0, total: 2 }))).toBeTruthy();
  });

  it('records the typed attempts of a player in es-AR', async () => {
    const props = renderReady();
    fireEvent.click(
      screen.getByRole('button', { name: t('weeklyCmj.player.record', { name: 'Ana Pérez' }) }),
    );
    const first = screen.getByLabelText(
      `${t('weeklyCmj.attempt.label', { number: 1 })} · ${t('weeklyCmj.mode.height_cm')}`,
    );
    fireEvent.change(first, { target: { value: '38,5' } });
    fireEvent.change(
      screen.getByLabelText(
        `${t('weeklyCmj.attempt.label', { number: 2 })} · ${t('weeklyCmj.mode.height_cm')}`,
      ),
      { target: { value: '39' } },
    );
    fireEvent.click(screen.getByRole('button', { name: `${t('weeklyCmj.save')}: Ana Pérez` }));
    await waitFor(() => {
      expect(props.onRecord).toHaveBeenCalled();
    });
    expect(props.onRecord.mock.calls[0]?.[1]).toEqual([38.5, 39]);
  });

  it('refuses a malformed attempt and asks before saving an implausible one', async () => {
    const props = renderReady();
    fireEvent.click(
      screen.getByRole('button', { name: t('weeklyCmj.player.record', { name: 'Ana Pérez' }) }),
    );
    const label = `${t('weeklyCmj.attempt.label', { number: 1 })} · ${t('weeklyCmj.mode.height_cm')}`;
    fireEvent.change(screen.getByLabelText(label), { target: { value: '38.5' } });
    const save = screen.getByRole('button', { name: `${t('weeklyCmj.save')}: Ana Pérez` });
    fireEvent.click(save);
    expect(screen.getByText(t('weeklyCmj.attempt.invalid'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(label), { target: { value: '95' } });
    fireEvent.click(save);
    expect(props.onRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('weeklyCmj.attempt.saveAnyway') }));
    fireEvent.click(save);
    await waitFor(() => {
      expect(props.onRecord).toHaveBeenCalled();
    });
  });

  it('shows today against the baseline with an icon and text, and voids with a reason', async () => {
    const props = renderReady({}, [37, 38]);
    expect(
      screen.getByText(t('weeklyCmj.today', { height: cm(38) }), { exact: false, normalizer }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `${t('status.warning')}: ${t('weeklyCmj.verdict.warning', { pct: formatUnit(-(3 / 41) * 100, 'pct', { decimals: 1, sign: 'always' }), baseline: cm(41) })}`,
        { exact: false, normalizer },
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: t('weeklyCmj.player.addAttempt', { name: 'Ana Pérez' }) }),
    );
    // The attempt after the two of today is the third.
    expect(
      screen.getByLabelText(
        `${t('weeklyCmj.attempt.label', { number: 3 })} · ${t('weeklyCmj.mode.height_cm')}`,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: t('weeklyCmj.attempt.void', { number: 1 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('weeklyCmj.attempt.void.confirm') }));
    await waitFor(() => {
      expect(props.onVoid).toHaveBeenCalled();
    });
    expect(props.onVoid.mock.calls[0]?.[2]).toBe(t('weeklyCmj.attempt.void.defaultReason'));
  });

  it('jumps to the next player without a jump today and changes the settings', () => {
    const props = renderReady({}, [40]);
    fireEvent.click(screen.getByRole('button', { name: t('weeklyCmj.next') }));
    expect(
      screen.getByRole('button', { name: `${t('weeklyCmj.save')}: Bruno Pérez` }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: t('weeklyCmj.mode.flight_time_ms') }));
    expect(props.onChangeSettings).toHaveBeenCalledWith({ ...SETTINGS, mode: 'flight_time_ms' });
  });
});
