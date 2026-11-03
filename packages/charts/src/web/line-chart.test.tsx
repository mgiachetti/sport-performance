// @vitest-environment jsdom
import { NBSP, createTranslator } from '@sport-performance/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations, setupDomTests } from '../testing/dom.js';
import { sprintSpec } from '../testing/fixtures.js';
import { ChartsProvider } from './context.js';
import { LineChart } from './line-chart.js';

setupDomTests();

function renderChart(width = 400) {
  return render(<LineChart spec={sprintSpec} width={width} description="Segundos, mejor de 3" />);
}

describe('LineChart', () => {
  it('is a figure with its caption, legend and an SVG named by the summary', () => {
    renderChart();
    const figure = screen.getByRole('figure', { name: /Sprint 40 m/ });
    expect(within(figure).getByText('Segundos, mejor de 3')).toBeTruthy();
    const legend = within(figure).getByRole('list', { name: 'Leyenda' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Tomás Pérez', 'Promedio M17', `Primera 5,25${NBSP}s`]);
    const img = within(figure).getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/^Sprint 40 m\. Tomás Pérez: 4 valores/);
  });

  it('draws the player in the brand class, the average in grey and the dashed reference', () => {
    const { container } = renderChart();
    expect(container.querySelector('.sp-chart__series--player .sp-chart__line')).not.toBeNull();
    expect(
      container.querySelector('.sp-chart__series--categoryAverage .sp-chart__line'),
    ).not.toBeNull();
    const reference = container.querySelector('.sp-chart__reference-line');
    expect(reference?.getAttribute('stroke-dasharray')).toMatch(/^\d+ \d+$/);
    expect(container.querySelector('.sp-chart__reference-label')?.textContent).toBe(
      `Primera 5,25${NBSP}s`,
    );
    // The flagged point carries a status glyph (shape, not just color).
    expect(container.querySelectorAll('.sp-chart__status.sp-status--warning')).toHaveLength(1);
  });

  it('keeps the alternative table in the DOM and shows it on demand', async () => {
    const user = userEvent.setup();
    renderChart();
    const table = screen.getByRole('table', { name: 'Datos de «Sprint 40 m»' });
    expect(table.parentElement?.className).toContain('sp-sr-only');
    const toggle = screen.getByRole('button', { name: 'Ver como tabla' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Ocultar tabla');
    expect(table.parentElement?.className).not.toContain('sp-sr-only');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[4]?.textContent).toContain('Atención');
    expect(rows[3]?.textContent).toContain('—');
  });

  it('walks the values with the keyboard and announces each one', async () => {
    const user = userEvent.setup();
    const { container } = renderChart();
    const plot = screen.getByRole('group', { name: 'Sprint 40 m' });
    await user.tab();
    expect(document.activeElement).toBe(plot);
    // Focus opens the latest value.
    const live = plot.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/^V1 26\. Tomás Pérez: 5,31/);
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('V1 26');
    await user.keyboard('{ArrowLeft}');
    expect(live?.textContent).toMatch(/^V4 25\. Tomás Pérez: 5,41.*\(Atención\)/);
    await user.keyboard('{Home}');
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('V1 25');
    expect(container.querySelector('.sp-chart__crosshair')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(container.querySelector('.sp-chart__tooltip')).toBeNull();
    expect(live?.textContent).toBe('');
  });

  it('shows the tooltip of the nearest category under the pointer', () => {
    const { container } = renderChart(400);
    const plot = screen.getByRole('group', { name: 'Sprint 40 m' });
    fireEvent.pointerMove(plot, { clientX: 60, clientY: 50 });
    const title = container.querySelector('.sp-chart__tooltip-title');
    expect(title?.textContent).toBe('V1 25');
    const values = [...container.querySelectorAll('.sp-chart__tooltip-value')].map(
      (node) => node.textContent,
    );
    expect(values).toEqual([`5,62${NBSP}s`, `5,68${NBSP}s`, `5,25${NBSP}s`]);
    fireEvent.pointerMove(plot, { clientX: 395, clientY: 50 });
    expect(container.querySelector('.sp-chart__tooltip-title')?.textContent).toBe('V1 26');
    expect(container.querySelector('.sp-chart__tooltip')?.getAttribute('data-align')).toBe('end');
    fireEvent.pointerLeave(plot);
    expect(container.querySelector('.sp-chart__tooltip')).toBeNull();
  });

  it('renders data labels as text, never as HTML', () => {
    const { container } = render(
      <LineChart
        width={300}
        spec={{
          ...sprintSpec,
          series: [
            {
              id: 'x',
              role: 'player',
              label: '<img src=x onerror=alert(1)>',
              values: [1, 2, 3, 4, 5],
            },
          ],
        }}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
  });

  it('shows an empty state without drawing or table', () => {
    const { container } = render(
      <LineChart
        width={300}
        spec={{
          ...sprintSpec,
          series: [{ id: 'p', role: 'player', label: 'P', values: [null, null, null, null, null] }],
        }}
      />,
    );
    expect(screen.getByText('Sin datos')).toBeTruthy();
    expect(container.querySelector('svg.sp-chart__svg')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses the club translator from the provider', () => {
    const translator = createTranslator({
      overrides: { 'chart.table.show': 'Mostrar los datos' },
    });
    render(
      <ChartsProvider translator={translator}>
        <LineChart spec={sprintSpec} width={300} />
      </ChartsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Mostrar los datos' })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderChart();
    await expectNoA11yViolations(container);
  });
});
