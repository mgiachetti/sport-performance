// @vitest-environment jsdom
import { NBSP } from '@sport-performance/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations, setupDomTests } from '../testing/dom.js';
import { cmjSparkSpec, wellnessSpec } from '../testing/fixtures.js';
import { Heatmap } from './heatmap.js';
import { Sparkline } from './sparkline.js';
import { StatusBadge } from './status-badge.js';

setupDomTests();

describe('Heatmap', () => {
  it('draws the cells by step, hatches the missing one and names the scale', () => {
    const { container } = render(<Heatmap spec={wellnessSpec} width={320} />);
    expect(container.querySelectorAll('rect.sp-chart__cell[x]')).toHaveLength(5);
    expect(container.querySelectorAll('rect.sp-chart__cell--empty[x]')).toHaveLength(1);
    expect(container.querySelector('pattern')?.id).toMatch(/^sp[A-Za-z0-9_-]+$/);
    const scale = screen.getByRole('list', { name: 'Escala' });
    expect(
      within(scale)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'De 1,0 a 1,8',
      'De 1,8 a 2,6',
      'De 2,6 a 3,4',
      'De 3,4 a 4,2',
      'De 4,2 a 5,0',
      'Sin dato',
    ]);
  });

  it('walks the grid with the arrow keys', async () => {
    const user = userEvent.setup();
    const { container } = render(<Heatmap spec={wellnessSpec} width={320} />);
    const plot = screen.getByRole('group', { name: 'Bienestar de la semana' });
    await user.tab();
    const live = plot.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Juan · Lun. Valor: 4,2.');
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(live?.textContent).toBe('Lucas · Mar. Valor: 4,8.');
    await user.keyboard('{ArrowUp}{End}');
    expect(live?.textContent).toBe('Juan · Mié. Valor: Sin dato.');
    expect(container.querySelector('.sp-chart__cell-outline')).not.toBeNull();
  });

  it('shows the tooltip of the cell under the pointer', () => {
    const { container } = render(<Heatmap spec={wellnessSpec} width={320} height={80} />);
    const plot = screen.getByRole('group', { name: 'Bienestar de la semana' });
    const cell = container.querySelectorAll('rect.sp-chart__cell[x]')[0];
    const x = Number(cell?.getAttribute('x')) + 4;
    const y = Number(cell?.getAttribute('y')) + 4;
    fireEvent.pointerMove(plot, { clientX: x, clientY: y });
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('Juan · Lun');
    fireEvent.pointerMove(plot, { clientX: 1, clientY: 1 });
    expect(container.querySelector('.sp-chart__tooltip')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Heatmap spec={{ ...wellnessSpec, showValues: true }} width={320} />,
    );
    await expectNoA11yViolations(container);
  });
});

describe('Sparkline', () => {
  it('is an image named by its summary with a hidden table', () => {
    const { container } = render(<Sparkline spec={cmjSparkSpec} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe(
      `CMJ. CMJ: 4 valores, de 38,2${NBSP}cm (V1 25) a 41,7${NBSP}cm (V1 26). Referencia de Primera: 45,0${NBSP}cm.`,
    );
    expect(container.querySelector('.sp-chart__point')).not.toBeNull();
    expect(container.querySelector('.sp-chart__reference-line')).not.toBeNull();
    expect(screen.getByRole('table').closest('.sp-sr-only')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Sparkline spec={cmjSparkSpec} />);
    await expectNoA11yViolations(container);
  });
});

describe('StatusBadge', () => {
  it('shows every level as icon + text', () => {
    render(
      <>
        <StatusBadge level="ok" />
        <StatusBadge level="warning" />
        <StatusBadge level="critical" label="Historia insuficiente" />
      </>,
    );
    for (const text of ['Bien', 'Atención', 'Historia insuficiente']) {
      const badge = screen.getByText(text).closest('.sp-status');
      expect(badge?.querySelector('svg[aria-hidden="true"]'), text).not.toBeNull();
    }
  });
});
