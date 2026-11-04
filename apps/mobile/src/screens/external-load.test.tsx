// @vitest-environment jsdom
import { parseLocalDate } from '@sport-performance/domain';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalLoadItem } from '../external-load/model.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { ExternalLoadScreen } from './external-load.tsx';

const { t } = translator;
const TODAY = parseLocalDate('2026-11-03');

const ITEM: ExternalLoadItem = {
  key: 'r1',
  target: { id: 'r1' },
  localDate: parseLocalDate('2026-11-01'),
  activity: 'other_sport',
  detail: 'Fútbol',
  minutes: 60,
  rpe: 6,
  srpeAu: 360,
  state: 'local',
};

function renderIt(overrides: Partial<Parameters<typeof ExternalLoadScreen>[0]> = {}) {
  const props = {
    today: TODAY,
    timeZoneKnown: true,
    items: [] as readonly ExternalLoadItem[],
    onReport: vi.fn(() => Promise.resolve()),
    onCorrect: vi.fn(() => Promise.resolve('saved' as const)),
    onArchive: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  renderScreen(<ExternalLoadScreen {...props} />);
  return props;
}

const radio = (name: string) => screen.getByRole('radio', { name });

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

describe('ExternalLoadScreen', () => {
  it('reports an activity in a few taps and shows its load', async () => {
    const props = renderIt();
    fireEvent.click(radio(t('externalLoad.activity.other_sport')));
    fireEvent.click(radio(t('externalLoad.day.yesterday')));
    fireEvent.click(radio(t('externalLoad.minutes.option', { minutes: 60 })));
    fireEvent.click(radio(t('externalLoad.rpe.option', { value: '5', name: t('rpe.scale.5') })));
    // The choice is said with a mark, not only with color.
    expect(radio(t('externalLoad.activity.other_sport')).textContent).toContain('✓');
    expect(screen.getByText(t('externalLoad.load', { load: '300' }))).toBeDefined();
    await press(t('externalLoad.save'));
    expect(props.onReport).toHaveBeenCalledWith({
      activity: 'other_sport',
      detail: '',
      day: '2026-11-02',
      minutesText: '60',
      rpe: 5,
    });
    expect(screen.getByText(t('externalLoad.saved'))).toBeDefined();
  });

  it('says what is missing with icon and text, and saves nothing', async () => {
    const props = renderIt();
    await press(t('externalLoad.save'));
    expect(props.onReport).not.toHaveBeenCalled();
    expect(screen.getByText(t('externalLoad.activity.missing'))).toBeDefined();
    expect(screen.getByText(t('externalLoad.rpe.missing'))).toBeDefined();
    expect(screen.getByText(t('externalLoad.minutes.invalid', { min: 1, max: 600 }))).toBeDefined();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);
  });

  it('lists the week with the state of each activity and its total', () => {
    renderIt({ items: [ITEM, { ...ITEM, key: 'r2', target: { id: 'r2' }, state: 'synced' }] });
    expect(screen.getByText(t('externalLoad.list.total', { count: 2, load: '720' }))).toBeDefined();
    expect(screen.getByText(t('externalLoad.item.state.local'))).toBeDefined();
    expect(screen.getByText(t('externalLoad.item.state.synced'))).toBeDefined();
  });

  it('corrects an activity with a reason', async () => {
    const props = renderIt({ items: [ITEM] });
    await press(
      t('externalLoad.correct.for', { activity: 'Otro deporte (Fútbol)', day: '01/11/2026' }),
    );
    expect(screen.getByText(t('externalLoad.correct.title'))).toBeDefined();
    fireEvent.click(radio(t('externalLoad.minutes.option', { minutes: 90 })));
    await press(t('externalLoad.saveCorrection'));
    expect(props.onCorrect).not.toHaveBeenCalled();
    expect(screen.getByText(t('externalLoad.reason.missing'))).toBeDefined();
    fireEvent.change(screen.getByLabelText(t('externalLoad.reason.label')), {
      target: { value: 'Fueron 90' },
    });
    await press(t('externalLoad.saveCorrection'));
    expect(props.onCorrect).toHaveBeenCalledWith(
      ITEM,
      expect.objectContaining({ minutesText: '90', rpe: 6, activity: 'other_sport' }),
      'Fueron 90',
    );
    expect(screen.getByText(t('externalLoad.corrected'))).toBeDefined();
  });

  it('asks again before deleting an activity', async () => {
    const props = renderIt({ items: [ITEM] });
    const name = t('externalLoad.archive.for', {
      activity: 'Otro deporte (Fútbol)',
      day: '01/11/2026',
    });
    await press(name);
    expect(props.onArchive).not.toHaveBeenCalled();
    expect(screen.getByText(t('externalLoad.archive.confirm'))).toBeDefined();
    await press(name);
    expect(props.onArchive).toHaveBeenCalledWith(ITEM);
    expect(screen.getByText(t('externalLoad.archived'))).toBeDefined();
  });

  it('warns when the club zone is not known yet', () => {
    renderIt({ timeZoneKnown: false });
    expect(screen.getByText(t('externalLoad.timeZoneUnknown'))).toBeDefined();
  });
});
