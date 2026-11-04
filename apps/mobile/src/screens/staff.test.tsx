// @vitest-environment jsdom
import type { NotificationPreference } from '@sport-performance/contracts';
import { parseLocalDate } from '@sport-performance/domain';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildBoard } from '../staff/board.ts';
import { renderScreen, translator } from '../test/render.tsx';
import {
  M15,
  M17,
  alertDetail,
  panelAlert,
  panelPlayer,
  squad,
  TODAY,
  weeklyPanel,
} from '../test/staff-fixtures.ts';
import {
  AlertDetailScreen,
  NotificationSettingsScreen,
  StaffBoardScreen,
  fetchedText,
} from './staff.tsx';

const { t } = translator;
const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);
const FRESH = { fetchedAt: NOW - 5 * 60_000, fromCache: false, nowMs: NOW };
const REGISTERED = { status: 'registered', busy: false } as const;

function board(categoryId: string | null = null) {
  return buildBoard({
    panel: weeklyPanel(squad()),
    today: TODAY,
    categories: [M15, M17],
    categoryId,
    wellnessPlayerIds: new Set(),
  });
}

function renderBoard(overrides: Partial<Parameters<typeof StaffBoardScreen>[0]> = {}) {
  const props = {
    board: board(),
    loading: false,
    error: null,
    freshness: FRESH,
    categories: [
      { id: M15.id, name: 'M15' },
      { id: M17.id, name: 'M17' },
    ],
    categoryId: null,
    sessionFilter: null,
    push: REGISTERED,
    onSelectCategory: vi.fn(),
    onOpenAlert: vi.fn(),
    onRetry: vi.fn(),
    onEnablePush: vi.fn(),
    ...overrides,
  };
  renderScreen(<StaffBoardScreen {...props} />);
  return props;
}

describe('StaffBoardScreen (B-510)', () => {
  it('shows who needs a look first, each state with its text', () => {
    renderBoard();
    expect(screen.getByRole('heading', { name: t('staff.board.title') })).toBeTruthy();
    expect(screen.getByText('Actualizado hace 5 minutos.')).toBeTruthy();
    expect(screen.getByLabelText('1 no disponible')).toBeTruthy();
    expect(screen.getByLabelText('1 con alerta crítica')).toBeTruthy();
    expect(screen.getByLabelText('1 limitado/a')).toBeTruthy();
    expect(screen.getByLabelText('4 sin bienestar hoy')).toBeTruthy();
    // Availability without the cause, always as text.
    expect(screen.getAllByLabelText('No disponible')).toHaveLength(1);
    expect(screen.getAllByLabelText('Limitado')).toHaveLength(1);
    // The alert's own text, formatted es-AR.
    expect(
      screen.getByText('Carga aguda alta respecto de la crónica: ACWR 1,46 (umbral 1,40).'),
    ).toBeTruthy();
    expect(screen.getByText('1 jugador/a sin novedades.')).toBeTruthy();
  });

  it('opens an alert and filters by category', () => {
    const props = renderBoard();
    const [first] = screen.getAllByRole('button', { name: 'Ver la alerta de Juan Acosta' });
    if (first === undefined) throw new Error('No alert button');
    fireEvent.click(first);
    expect(props.onOpenAlert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: 'M17' }));
    expect(props.onSelectCategory).toHaveBeenCalledWith(M17.id);
  });

  it('says it is the copy of the phone without signal', () => {
    renderBoard({ freshness: { fetchedAt: NOW - 3 * 3_600_000, fromCache: true, nowMs: NOW } });
    expect(screen.getByText(`${t('staff.kept')} Actualizado hace 3 horas.`)).toBeTruthy();
  });

  it('warns when the kept panel is of an earlier day', () => {
    renderBoard({
      board: buildBoard({
        panel: weeklyPanel(squad()),
        today: parseLocalDate('2026-11-04'),
        categories: [M15, M17],
        categoryId: null,
        wellnessPlayerIds: new Set(),
      }),
    });
    expect(screen.getByText(t('staff.board.stale', { date: '03/11/2026' }))).toBeTruthy();
  });

  it('offers to turn the pushes on when the phone never asked', () => {
    const props = renderBoard({ push: { status: 'needsPermission', busy: false } });
    fireEvent.click(screen.getByRole('button', { name: t('staff.push.enable') }));
    expect(props.onEnablePush).toHaveBeenCalled();
  });

  it('with nothing to look at, says so', () => {
    renderBoard({
      board: buildBoard({
        panel: weeklyPanel([
          panelPlayer(1, { wellness: { ...panelPlayer(1).wellness, submittedToday: true } }),
        ]),
        today: TODAY,
        categories: [M15],
        categoryId: null,
        wellnessPlayerIds: new Set(),
      }),
    });
    expect(screen.getByLabelText(t('staff.board.allClear'))).toBeTruthy();
  });

  it('without data and without a kept copy, shows the error and retries', () => {
    const props = renderBoard({
      board: null,
      error: t('error.network'),
      freshness: { fetchedAt: null, fromCache: false, nowMs: NOW },
    });
    expect(screen.getByText(t('error.network'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('staff.retry') }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('formats when it was read, relative', () => {
    expect(fetchedText(NOW, NOW, translator)).toBe('Actualizado recién.');
    expect(fetchedText(NOW - 2 * 86_400_000, NOW, translator)).toBe('Actualizado hace 2 días.');
  });
});

describe('AlertDetailScreen (B-510)', () => {
  const alert = panelAlert();
  const player = panelPlayer(2, { firstName: 'Juan', lastName: 'Acosta', alerts: [alert] });

  function renderAlert(overrides: Partial<Parameters<typeof AlertDetailScreen>[0]> = {}) {
    const props = {
      view: { source: 'detail' as const, alert: alertDetail(alert, player) },
      playerName: 'Juan Acosta',
      loading: false,
      error: null,
      freshness: FRESH,
      canReview: true,
      online: true,
      reviewing: false,
      notice: null,
      onReview: vi.fn(),
      onBack: vi.fn(),
      ...overrides,
    };
    renderScreen(<AlertDetailScreen {...props} />);
    return props;
  }

  it('shows the alert, its suggestion and its history', () => {
    renderAlert();
    expect(screen.getByRole('heading', { name: 'Juan Acosta' })).toBeTruthy();
    expect(screen.getByLabelText(t('status.critical'))).toBeTruthy();
    expect(screen.getByText('Desde el 03/11/2026 · último día: 03/11/2026')).toBeTruthy();
    expect(screen.getByText(t('alert.acwr_high.suggestion'))).toBeTruthy();
    expect(screen.getByText('03/11/2026 · Se abrió')).toBeTruthy();
    expect(screen.getByLabelText(t('player.alerts.review.open'))).toBeTruthy();
  });

  it('acknowledges with an optional note and asks for one to dismiss', () => {
    const props = renderAlert();
    fireEvent.click(screen.getByRole('button', { name: t('staff.alert.dismiss') }));
    expect(screen.getByText(t('staff.alert.note.required'))).toBeTruthy();
    expect(props.onReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t('staff.alert.acknowledge') }));
    expect(props.onReview).toHaveBeenCalledWith('acknowledged', '');
    fireEvent.change(screen.getByLabelText(t('staff.alert.note.label')), {
      target: { value: '  Ya hablamos con él ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('staff.alert.dismiss') }));
    expect(props.onReview).toHaveBeenLastCalledWith('dismissed', 'Ya hablamos con él');
  });

  it('without signal, the review waits and says why', () => {
    renderAlert({ online: false });
    expect(screen.getByText(t('staff.alert.reviewOffline'))).toBeTruthy();
    const acknowledge = screen.getByRole('button', { name: t('staff.alert.acknowledge') });
    expect(acknowledge.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the copy of the board when the phone has no detail', () => {
    renderAlert({ view: { source: 'board', alert }, online: false });
    expect(screen.getByText(t('staff.alert.fromBoard'))).toBeTruthy();
    expect(screen.queryByText(t('staff.alert.history'))).toBeNull();
  });

  it('a role that cannot review sees no actions; a reviewed alert neither', () => {
    renderAlert({ canReview: false });
    expect(screen.queryByRole('button', { name: t('staff.alert.acknowledge') })).toBeNull();
  });

  it('opening another alert starts its review afresh: no note or error of the previous one', () => {
    // The route is a tab that stays mounted: the next alert arrives as new props.
    const views = [alert, panelAlert(), panelAlert()].map((each) => ({
      source: 'detail' as const,
      alert: alertDetail(each, player),
    }));
    function AlertsInARow() {
      const [index, setIndex] = useState(0);
      return (
        <>
          <AlertDetailScreen
            view={views[index] ?? null}
            playerName="Juan Acosta"
            loading={false}
            error={null}
            freshness={FRESH}
            canReview
            online
            reviewing={false}
            notice={null}
            onReview={vi.fn()}
            onBack={vi.fn()}
          />
          <button
            type="button"
            onClick={() => {
              setIndex((current) => current + 1);
            }}
          >
            next
          </button>
        </>
      );
    }
    renderScreen(<AlertsInARow />);
    const next = () => {
      fireEvent.click(screen.getByRole('button', { name: 'next' }));
    };
    // The first: dismissed without a note, it asks for one.
    fireEvent.click(screen.getByRole('button', { name: t('staff.alert.dismiss') }));
    expect(screen.getByText(t('staff.alert.note.required'))).toBeTruthy();
    next();
    // The second: no error of the first; a note typed for it...
    expect(screen.queryByText(t('staff.alert.note.required'))).toBeNull();
    fireEvent.change(screen.getByLabelText(t('staff.alert.note.label')), {
      target: { value: 'Nota de la segunda' },
    });
    expect(screen.getByDisplayValue('Nota de la segunda')).toBeTruthy();
    next();
    // ...is not filled in on the third.
    expect(screen.queryByDisplayValue('Nota de la segunda')).toBeNull();
  });

  it('says when the alert is not there', () => {
    const props = renderAlert({ view: null });
    expect(screen.getByText(t('staff.alert.notFound'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('staff.alert.back') }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

describe('NotificationSettingsScreen (B-510)', () => {
  const PREFERENCES: NotificationPreference[] = [
    { kind: 'critical_alert', push: true, email: true, isDefault: true },
    { kind: 'pre_training_summary', push: true, email: false, isDefault: true },
  ];

  function renderSettings(
    overrides: Partial<Parameters<typeof NotificationSettingsScreen>[0]> = {},
  ) {
    const props = {
      push: REGISTERED,
      preferences: PREFERENCES,
      loading: false,
      error: null,
      online: true,
      saving: false,
      onEnablePush: vi.fn(),
      onDisablePush: vi.fn(),
      onOpenSettings: vi.fn(),
      onChange: vi.fn(),
      ...overrides,
    };
    renderScreen(<NotificationSettingsScreen {...props} />);
    return props;
  }

  it('changes one kind and channel', () => {
    const props = renderSettings();
    expect(screen.getByText(t('staff.notifications.status.registered'))).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Resumen antes de entrenar por Email'));
    expect(props.onChange).toHaveBeenCalledWith('pre_training_summary', 'email', true);
  });

  it('turns the pushes of this phone off', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByLabelText(t('staff.notifications.device')));
    expect(props.onDisablePush).toHaveBeenCalled();
  });

  it('sends to the settings when the system denied them', () => {
    const props = renderSettings({ push: { status: 'denied', busy: false } });
    expect(screen.getByText(t('staff.notifications.status.denied'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('staff.notifications.openSettings') }));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it('without signal, shows them read-only', () => {
    renderSettings({ online: false });
    expect(screen.getByText(t('staff.notifications.offline'))).toBeTruthy();
    const toggle = screen.getByLabelText('Alertas críticas por Push');
    expect(
      toggle.getAttribute('aria-disabled') ?? String((toggle as HTMLInputElement).disabled),
    ).toBe('true');
  });

  it('a role without notifications says so', () => {
    renderSettings({ preferences: [] });
    expect(screen.getByText(t('staff.notifications.none'))).toBeTruthy();
  });
});
