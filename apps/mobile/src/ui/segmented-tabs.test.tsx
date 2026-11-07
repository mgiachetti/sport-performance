// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, translator } from '../test/render.tsx';
import {
  SegmentedTabs,
  TabPanel,
  forgetRememberedSegments,
  segmentKey,
  useRememberedSegment,
  type TabSegment,
} from './segmented-tabs.tsx';

const { t } = translator;

type Tab = 'a' | 'b' | 'c';

const SEGMENTS: readonly TabSegment<Tab>[] = [
  { value: 'a', label: 'Récords' },
  { value: 'b', label: 'Historial' },
  { value: 'c', label: 'Próximos', badge: { count: 2, label: '2 días de test' } },
];

function Screen({
  scope,
  values = ['a', 'b', 'c'],
}: {
  readonly scope: string | null;
  readonly values?: readonly Tab[];
}) {
  const [tab, setTab] = useRememberedSegment(segmentKey('demo', scope), values, 'a');
  return (
    <>
      <SegmentedTabs
        label="Secciones"
        segments={SEGMENTS.filter((segment) => values.includes(segment.value))}
        value={tab}
        onChange={setTab}
      />
      <TabPanel label={tab}>{`panel ${tab}`}</TabPanel>
    </>
  );
}

beforeEach(() => {
  forgetRememberedSegments();
});

describe('SegmentedTabs', () => {
  it('reads as a named tab list with one selected tab, and its badge in the name', () => {
    const onChange = vi.fn();
    renderScreen(
      <SegmentedTabs label="Secciones" segments={SEGMENTS} value="a" onChange={onChange} />,
    );
    expect(screen.getByRole('tablist', { name: 'Secciones' })).toBeDefined();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Récords', selected: true })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Historial', selected: false })).toBeDefined();
    const withBadge = t('tabs.withBadge', { label: 'Próximos', badge: '2 días de test' });
    expect(withBadge).toBe('Próximos, 2 días de test');
    fireEvent.click(screen.getByRole('tab', { name: withBadge }));
    expect(onChange).toHaveBeenCalledWith('c');
    // The selected one says so in text too: never color alone.
    expect(screen.getByText('✓ Récords')).toBeDefined();
  });

  it('draws no badge for a count of 0', () => {
    renderScreen(
      <SegmentedTabs
        label="Secciones"
        segments={[
          { value: 'a', label: 'Récords' },
          { value: 'b', label: 'Próximos', badge: { count: 0, label: '0 días' } },
        ]}
        value="a"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Próximos' })).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('marks a critical badge with "!" besides its color', () => {
    renderScreen(
      <SegmentedTabs
        label="Secciones"
        segments={[
          { value: 'a', label: 'Asistencia' },
          {
            value: 'b',
            label: 'Minutos',
            badge: { count: 1, label: '1 con error', tone: 'critical' },
          },
        ]}
        value="a"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('! 1')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Minutos, 1 con error' })).toBeDefined();
  });

  it('shows the selected panel, named by its tab', () => {
    renderScreen(<Screen scope="m1" />);
    expect(screen.getByRole('tabpanel', { name: 'a' }).textContent).toBe('panel a');
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }));
    expect(screen.getByRole('tabpanel', { name: 'b' }).textContent).toBe('panel b');
  });
});

describe('useRememberedSegment', () => {
  it('remembers the last segment of a screen for the app session, per membership', () => {
    const first = renderScreen(<Screen scope="m1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }));
    first.unmount();

    const again = renderScreen(<Screen scope="m1" />);
    expect(screen.getByRole('tab', { name: 'Historial', selected: true })).toBeDefined();
    again.unmount();

    renderScreen(<Screen scope="m2" />);
    expect(screen.getByRole('tab', { name: 'Récords', selected: true })).toBeDefined();
  });

  it('falls back to the initial segment when the remembered one is not offered', () => {
    const first = renderScreen(<Screen scope="m1" />);
    fireEvent.click(screen.getByRole('tab', { name: /^Próximos/ }));
    first.unmount();

    renderScreen(<Screen scope="m1" values={['a', 'b']} />);
    expect(screen.getByRole('tab', { name: 'Récords', selected: true })).toBeDefined();
  });

  it('keys a screen by its membership, or a placeholder before choosing a club', () => {
    expect(segmentKey('player-tests', 'm1')).toBe('m1:player-tests');
    expect(segmentKey('player-tests', null)).toBe('-:player-tests');
  });
});
