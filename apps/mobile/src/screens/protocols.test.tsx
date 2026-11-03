// @vitest-environment jsdom
import type { TestDefinitionDto } from '@sport-performance/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen, translator } from '../test/render.tsx';
import { ProtocolListScreen, ProtocolScreen } from './protocols.tsx';

const { t } = translator;
const AT = '2026-03-01T12:00:00.000Z';

const SPRINT: TestDefinitionDto = {
  id: '0192e7a0-4444-7000-8000-000000000001' as TestDefinitionDto['id'],
  code: 'sprint_40',
  version: 2,
  sports: null,
  attemptCount: 3,
  attemptAggregation: 'best',
  maximalLoad: false,
  protocol: {
    summary: 'Sprint de 40 m con parciales a 10 y 20 m.',
    steps: ['Salida parado a 0,5 m detrás de la línea.', 'Fotocélulas en 0, 10, 20 y 40 m.'],
    restBetweenAttemptsS: 180,
    equipment: ['fotocélulas', 'conos'],
    parameters: {},
  },
  metrics: [{ code: 'sprint_40_s', unit: 's', isDerived: false }],
  validFrom: '2026-01-01' as TestDefinitionDto['validFrom'],
  validTo: null,
  createdAt: AT,
  updatedAt: AT,
};

describe('ProtocolListScreen', () => {
  it('lists the protocols with their attempts and opens one', () => {
    const onOpen = vi.fn();
    renderScreen(
      <ProtocolListScreen
        state={{ status: 'ready', definitions: [SPRINT] }}
        offline={false}
        onOpen={onOpen}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Versión 2 · 3 intentos, vale el mejor')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Ver el protocolo de Sprint 10/20/40 m' }));
    expect(onOpen).toHaveBeenCalledWith(SPRINT.id);
  });

  it('explains an error with icon and text and retries', () => {
    const onRetry = vi.fn();
    renderScreen(
      <ProtocolListScreen
        state={{ status: 'error', message: t('error.network') }}
        offline
        onOpen={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says when there is nothing in force', () => {
    renderScreen(
      <ProtocolListScreen
        state={{ status: 'ready', definitions: [] }}
        offline={false}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(t('protocol.empty'))).toBeDefined();
  });
});

describe('ProtocolScreen', () => {
  it('shows the numbered steps, the rest and the equipment', () => {
    const onBack = vi.fn();
    renderScreen(<ProtocolScreen definition={SPRINT} onBack={onBack} />);
    expect(screen.getByRole('heading', { name: 'Sprint 10/20/40 m' })).toBeDefined();
    expect(screen.getByText('Versión 2 · Vigente desde el 01/01/2026')).toBeDefined();
    expect(screen.getByText('Pausa entre intentos: 3 minutos')).toBeDefined();
    expect(screen.getByText('2.')).toBeDefined();
    expect(screen.getByText('Fotocélulas en 0, 10, 20 y 40 m.')).toBeDefined();
    expect(screen.getByText('• conos')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('protocol.back') }));
    expect(onBack).toHaveBeenCalled();
  });

  it('warns about maximal loads', () => {
    renderScreen(
      <ProtocolScreen
        definition={{ ...SPRINT, code: 'strength', maximalLoad: true }}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').getAttribute('aria-label')).toContain(
      t('protocol.maximalLoad'),
    );
  });
});
