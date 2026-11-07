// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { valuesOf, type DayMeasurement } from '../anthropometry/model.ts';
import { DAY, OTHER_PLAYER_ID, anthroDto, squadPlayer } from '../test/anthro-fixtures.ts';
import { COACH_AT_ORC } from '../test/fixtures.ts';
import { PLAYER_ID } from '../test/fake-sync-server.ts';
import { renderScreen, translator } from '../test/render.tsx';
import {
  AnthropometryCategoriesScreen,
  AnthropometrySheetScreen,
  type SheetProps,
} from './anthropometry.tsx';
import { HomeScreen } from './app.tsx';

const { t } = translator;
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function input(field: string, player = 'Juan Pérez') {
  return screen.getByLabelText(
    t('anthropometry.input.label', { field: t(field as 'anthropometry.column.heightCm'), player }),
  );
}

function sheet(overrides: Partial<SheetProps> = {}) {
  const props: SheetProps = {
    categoryName: 'M15',
    measuredOn: DAY as SheetProps['measuredOn'],
    squad: { status: 'ready', players: [squadPlayer()], savedAt: Date.UTC(2026, 10, 2) },
    measurements: new Map(),
    offline: false,
    refreshing: false,
    formatSavedAt: () => '02/11/2026',
    onChangeCategory: vi.fn(),
    onSave: vi.fn(() => Promise.resolve()),
    onCorrect: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  renderScreen(<AnthropometrySheetScreen {...props} />);
  return props;
}

describe('HomeScreen', () => {
  it('opens the field anthropometry only when the route allows it', () => {
    const onOpen = vi.fn();
    const props = { userName: 'Ana', membership: COACH_AT_ORC, clubTheme: null, offline: false };
    const { unmount } = renderScreen(<HomeScreen {...props} onOpenAnthropometry={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: t('home.tile.anthropometry') }));
    expect(onOpen).toHaveBeenCalled();
    unmount();
    renderScreen(<HomeScreen {...props} />);
    expect(screen.queryByRole('button', { name: t('home.tile.anthropometry') })).toBeNull();
  });
});

describe('AnthropometryCategoriesScreen', () => {
  it('lists the categories kept on the phone and says when there is nothing offline', () => {
    const onSelect = vi.fn();
    const { unmount } = renderScreen(
      <AnthropometryCategoriesScreen
        state={{ status: 'ready', categories: [{ id: 'c15', name: 'M15' }] }}
        offline
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText(t('anthropometry.field.offline'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'M15' }));
    expect(onSelect).toHaveBeenCalledWith('c15');
    unmount();
    renderScreen(
      <AnthropometryCategoriesScreen
        state={{ status: 'missing', message: null }}
        offline
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText(t('anthropometry.field.noContext'))).toBeTruthy();
  });
});

describe('AnthropometrySheetScreen', () => {
  it('saves the values typed in es-AR, and only valid ones', async () => {
    const props = sheet();
    const save = screen.getByRole('button', {
      name: t('anthropometry.field.saveA11y', { player: 'Juan Pérez' }),
    });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    // No skinfolds outside the performance stage.
    expect(screen.queryByLabelText(/Σ pliegues/)).toBeNull();
    fireEvent.change(input('anthropometry.column.heightCm'), { target: { value: '165,4' } });
    fireEvent.change(input('anthropometry.column.sittingHeightCm'), { target: { value: '170' } });
    expect(screen.getByText(t('anthropometry.error.range', { max: '150' }))).toBeTruthy();
    fireEvent.change(input('anthropometry.column.sittingHeightCm'), { target: { value: '85,2' } });
    fireEvent.change(input('anthropometry.column.weightKg'), { target: { value: '55,1' } });
    fireEvent.click(save);
    await flush();
    expect(props.onSave).toHaveBeenCalledWith(PLAYER_ID, {
      heightCm: 165.4,
      sittingHeightCm: 85.2,
      weightKg: 55.1,
    });
  });

  it('warns of an implausible value on the phone and offers the decimal moved', () => {
    sheet();
    fireEvent.change(input('anthropometry.column.heightCm'), { target: { value: '16,54' } });
    const fix = screen.getByRole('button', {
      name: t('anthropometry.plausibility.suggestion', { value: '165,4' }),
    });
    fireEvent.click(fix);
    expect((input('anthropometry.column.heightCm') as HTMLInputElement).value).toBe('165,4');
  });

  it('asks for the skinfolds in M17/M19 and blocks a player without consent', () => {
    sheet({
      squad: {
        status: 'ready',
        savedAt: 0,
        players: [
          squadPlayer({ stage: 'performance', parentHeightsMissing: true }),
          squadPlayer({ id: OTHER_PLAYER_ID, name: 'Tomás Gómez', blocked: true }),
        ],
      },
    });
    expect(input('anthropometry.column.skinfoldsSumMm')).toBeTruthy();
    expect(screen.getByText(t('anthropometry.gap.parent_heights_missing'))).toBeTruthy();
    expect(screen.getByText(t('anthropometry.blocked'))).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: t('anthropometry.field.saveA11y', { player: 'Tomás Gómez' }),
      }),
    ).toBeNull();
  });

  it('shows the state of a saved measurement and its maturation', () => {
    const served = anthroDto();
    const measurements = new Map<string, DayMeasurement>([
      [
        PLAYER_ID,
        {
          target: { id: served.id },
          playerId: PLAYER_ID,
          values: valuesOf(served),
          sync: 'synced',
          maturation: served.maturation,
        },
      ],
      [
        OTHER_PLAYER_ID,
        {
          target: { clientUuid: 'q' },
          playerId: OTHER_PLAYER_ID,
          values: valuesOf({ weightKg: 60 }),
          sync: 'queued',
          maturation: null,
        },
      ],
    ]);
    sheet({
      measurements,
      squad: {
        status: 'ready',
        savedAt: 0,
        players: [squadPlayer(), squadPlayer({ id: OTHER_PLAYER_ID, name: 'Tomás Gómez' })],
      },
    });
    // The synced measurement shows nothing; only the queued one is marked.
    expect(screen.getAllByText(t('sync.item.pending'))).toHaveLength(1);
    expect(screen.getByLabelText(t('anthropometry.field.state.queued'))).toBeTruthy();
    expect(screen.getByText(t('anthropometry.field.maturation.later'))).toBeTruthy();
    expect(
      screen.getByText(
        t('anthropometry.field.maturation.offset', {
          value: '-0,8',
          equation: t('anthropometry.equation.mirwald_2002'),
        }),
      ),
    ).toBeTruthy();
  });

  it('corrects only what changed, with a required reason', async () => {
    const served = anthroDto();
    const props = sheet({
      measurements: new Map([
        [
          PLAYER_ID,
          {
            target: { id: served.id },
            playerId: PLAYER_ID,
            values: valuesOf(served),
            sync: 'synced',
            maturation: served.maturation,
          },
        ],
      ]),
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: t('anthropometry.field.correctA11y', { player: 'Juan Pérez' }),
      }),
    );
    expect((input('anthropometry.column.heightCm') as HTMLInputElement).value).toBe('165,4');
    fireEvent.change(input('anthropometry.column.heightCm'), { target: { value: '166,4' } });
    const saveCorrection = screen.getByRole('button', {
      name: t('anthropometry.field.saveCorrection'),
    });
    fireEvent.click(saveCorrection);
    expect(screen.getByText(t('anthropometry.field.reasonRequired'))).toBeTruthy();
    expect(props.onCorrect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t('anthropometry.field.reason')), {
      target: { value: 'Talla mal tipeada' },
    });
    fireEvent.click(saveCorrection);
    await flush();
    expect(props.onCorrect).toHaveBeenCalledWith({
      target: { id: served.id },
      body: { changeReason: 'Talla mal tipeada', heightCm: 166.4 },
    });
  });

  it('says when the squad is not on the phone', () => {
    sheet({ squad: { status: 'missing', message: null }, offline: true });
    expect(screen.getByText(t('anthropometry.field.noSquad'))).toBeTruthy();
  });
});
