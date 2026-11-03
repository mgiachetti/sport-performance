// @vitest-environment jsdom
import { NBSP } from '@sport-performance/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations, setupDomTests } from '../testing/dom.js';
import { sessionSpec, weeklyLoadSpec } from '../testing/fixtures.js';
import { BarChart } from './bar-chart.js';

setupDomTests();

describe('BarChart', () => {
  it('draws one bar per value with the tone classes, the overlay and one direct label', () => {
    const { container } = render(<BarChart spec={weeklyLoadSpec} width={480} />);
    expect(container.querySelectorAll('.sp-chart__bar')).toHaveLength(3);
    expect(container.querySelectorAll('.sp-chart__bar--brand')).toHaveLength(3);
    expect(container.querySelector('.sp-chart__series--overlay .sp-chart__line')).not.toBeNull();
    const labels = container.querySelectorAll('.sp-chart__direct-label');
    expect([...labels].map((label) => label.textContent)).toEqual([`1.980${NBSP}UA`]);
    expect(container.querySelectorAll('.sp-chart__status.sp-status--critical')).toHaveLength(1);
  });

  it('names the tones in the legend (group never by color alone)', () => {
    const { container } = render(<BarChart spec={sessionSpec} width={480} />);
    const legend = screen.getByRole('list', { name: 'Leyenda' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Backs', 'Delanteros', `Primera 5.800${NBSP}m`]);
    expect(container.querySelectorAll('.sp-chart__bar--neutral')).toHaveLength(1);
    expect(container.querySelector('.sp-chart__reference-label')?.textContent).toBe(
      `Primera 5.800${NBSP}m`,
    );
  });

  it('shows the tooltip of the bar under the pointer and of the focused bar', async () => {
    const user = userEvent.setup();
    const { container } = render(<BarChart spec={weeklyLoadSpec} width={480} />);
    const plot = screen.getByRole('group', { name: 'Carga semanal' });
    fireEvent.pointerMove(plot, { clientX: 80, clientY: 100 });
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('Semana 41');
    expect(container.querySelector('.sp-chart__bar.is-active')).not.toBeNull();
    fireEvent.pointerLeave(plot);
    expect(container.querySelector('.sp-chart__tooltip')).toBeNull();

    await user.tab();
    const live = plot.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(
      `Semana 44. Carga: 1.980${NBSP}UA (Crítico); Crónica: 1.710${NBSP}UA.`,
    );
    // The status inside the tooltip is icon + text.
    const badge = container.querySelector('.sp-chart__tooltip .sp-status--critical');
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(badge?.textContent).toBe('Crítico');
    await user.keyboard('{ArrowLeft}');
    expect(live?.textContent).toBe(`Semana 43. Carga: Sin dato; Crónica: 1.600${NBSP}UA.`);
    await user.keyboard('{End}{ArrowRight}');
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('Semana 44');
  });

  it('carries every value and state in its table', () => {
    render(<BarChart spec={weeklyLoadSpec} width={480} defaultTableVisible />);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Dato', 'Carga', 'Crónica', 'Estado']);
    expect(within(table).getByRole('rowheader', { name: 'Semana 43' })).toBeTruthy();
    expect(within(table).getByText('Crítico')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ocultar tabla' })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<BarChart spec={sessionSpec} width={480} />);
    await expectNoA11yViolations(container);
  });
});
