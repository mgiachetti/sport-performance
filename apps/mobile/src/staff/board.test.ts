import { parseLocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  M15,
  M17,
  panelAlert,
  panelPlayer,
  squad,
  TODAY,
  weeklyPanel,
} from '../test/staff-fixtures.ts';
import {
  boardCategories,
  boardClubDay,
  buildBoard,
  canReviewAlerts,
  canSeeStaffBoard,
  findPanelAlert,
} from './board.ts';

const CATEGORIES = [M15, M17];

describe('who sees the quick look before training (B-510)', () => {
  it('is the staff that reads the panel, never a player or a guardian', () => {
    expect(canSeeStaffBoard('coach')).toBe(true);
    expect(canSeeStaffBoard('sc')).toBe(true);
    expect(canSeeStaffBoard('medical')).toBe(true);
    expect(canSeeStaffBoard('admin')).toBe(true);
    expect(canSeeStaffBoard('player')).toBe(false);
    expect(canSeeStaffBoard('parent')).toBe(false);
    expect(canReviewAlerts('coach')).toBe(true);
    expect(canReviewAlerts('player')).toBe(false);
  });
});

describe('the board', () => {
  it('puts first who is unavailable, then critical alerts, limited and warnings', () => {
    const board = buildBoard({
      panel: weeklyPanel(squad()),
      today: TODAY,
      categories: CATEGORIES,
      categoryId: null,
      wellnessPlayerIds: new Set(),
    });
    expect(board.attention.map((p) => [p.lastName, p.reason])).toEqual([
      ['Bianchi', 'unavailable'],
      ['Acosta', 'critical'],
      ['Zárate', 'limited'],
      ['Correa', 'warning'],
    ]);
    // Critical first within a player.
    expect(board.attention[1]?.alerts.map((a) => a.severity)).toEqual(['critical', 'warning']);
    expect(board.attention[3]?.categoryNames).toEqual(['M17']);
    expect(board.missingWellness.map((p) => p.lastName)).toEqual(['Díaz']);
    expect(board.clearCount).toBe(1);
    expect(board.counts).toEqual({
      players: 6,
      unavailable: 1,
      limited: 1,
      critical: 1,
      warning: 1,
      missingWellness: 4,
    });
    expect(board.today).toBe('2026-11-03');
  });

  it('filters by category', () => {
    const board = buildBoard({
      panel: weeklyPanel(squad()),
      today: TODAY,
      categories: CATEGORIES,
      categoryId: M17.id,
      wellnessPlayerIds: new Set(),
    });
    expect(board.counts.players).toBe(2);
    expect(board.attention.map((p) => p.lastName)).toEqual(['Correa']);
    expect(board.clearCount).toBe(1);
  });

  it('counts a check-in the sync brought after the panel was read', () => {
    const late = panelPlayer(5, { firstName: 'Mateo', lastName: 'Díaz' });
    const board = buildBoard({
      panel: weeklyPanel([late]),
      today: TODAY,
      categories: CATEGORIES,
      categoryId: null,
      wellnessPlayerIds: new Set([late.playerId]),
    });
    expect(board.missingWellness).toEqual([]);
    expect(board.counts.missingWellness).toBe(0);
    expect(board.clearCount).toBe(1);
  });

  it('a panel kept from an earlier day does not pass its wellness off as today', () => {
    // Read yesterday; opened today at the field without signal.
    const loadedYesterday = panelPlayer(1, {
      wellness: { ...panelPlayer(1).wellness, submittedToday: true },
    });
    const syncedToday = panelPlayer(2);
    const today = parseLocalDate('2026-11-04');
    const board = buildBoard({
      panel: weeklyPanel([loadedYesterday, syncedToday]),
      today,
      categories: CATEGORIES,
      categoryId: null,
      // The wellness rows of today the sync brought.
      wellnessPlayerIds: new Set([syncedToday.playerId]),
    });
    expect(board.stale).toBe(true);
    expect(board.today).toBe('2026-11-04');
    expect(board.panelDay).toBe(TODAY);
    expect(board.missingWellness.map((p) => p.playerId)).toEqual([loadedYesterday.playerId]);
    expect(board.counts.missingWellness).toBe(1);
    // The same panel on its own day is not stale.
    const fresh = buildBoard({
      panel: weeklyPanel([loadedYesterday]),
      today: TODAY,
      categories: CATEGORIES,
      categoryId: null,
      wellnessPlayerIds: new Set(),
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.missingWellness).toEqual([]);
  });

  it('works out the club day from the panel day and the days since it was read', () => {
    // 2026-11-03 23:00 in Buenos Aires (UTC−3) is 2026-11-04 02:00 UTC.
    const readAt = Date.UTC(2026, 10, 4, 2, 0);
    // Before midnight in the club: the panel's day.
    expect(boardClubDay(TODAY, readAt, Date.UTC(2026, 10, 4, 2, 30))).toBe(TODAY);
    // Past midnight in the club, the next morning at the field.
    expect(boardClubDay(TODAY, readAt, Date.UTC(2026, 10, 4, 12, 0))).toBe('2026-11-04');
    expect(boardClubDay(TODAY, readAt, Date.UTC(2026, 10, 6, 12, 0))).toBe('2026-11-06');
    // A clock behind the read never goes before the panel's day.
    expect(boardClubDay(TODAY, readAt, Date.UTC(2026, 10, 2, 12, 0))).toBe(TODAY);
    expect(boardClubDay(TODAY, null, Date.UTC(2026, 10, 6, 12, 0))).toBe(TODAY);
  });

  it('a player without availability reported is not taken as available or unavailable', () => {
    const board = buildBoard({
      panel: weeklyPanel([panelPlayer(9, { availability: null })]),
      today: TODAY,
      categories: CATEGORIES,
      categoryId: null,
      wellnessPlayerIds: new Set(),
    });
    expect(board.counts.unavailable).toBe(0);
    expect(board.missingWellness[0]?.availability).toBeNull();
  });

  it('offers only the categories with players, in the club order', () => {
    const panel = weeklyPanel([panelPlayer(1)]);
    expect(boardCategories(panel, [M17, M15])).toEqual([{ id: M15.id, name: 'M15' }]);
  });

  it('finds an alert of the panel and its player (the alert without signal)', () => {
    const alert = panelAlert();
    const panel = weeklyPanel([panelPlayer(1, { alerts: [alert] })]);
    expect(findPanelAlert(panel, alert.id)?.player.lastName).toBe('Apellido 1');
    expect(findPanelAlert(panel, '0192e7a0-4444-7000-8000-999999999999')).toBeNull();
    expect(findPanelAlert(undefined, alert.id)).toBeNull();
  });
});
