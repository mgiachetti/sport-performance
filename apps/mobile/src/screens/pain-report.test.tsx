// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PAIN_DRAFT, type PainDraft } from '../pain/draft.ts';
import type { PainQuestionState } from '../pain/question.ts';
import { renderScreen, translator } from '../test/render.tsx';
import { PainReportScreen, areaLabel, type PainSentState } from './pain-report.tsx';

const { t } = translator;

/** The screen with its draft in state, as the route holds it. */
function Harness({
  question = { kind: 'ask' },
  sent = null,
  onSubmit,
}: {
  readonly question?: PainQuestionState;
  readonly sent?: PainSentState | null;
  readonly onSubmit: (draft: PainDraft) => void;
}) {
  const [draft, setDraft] = useState<PainDraft>(EMPTY_PAIN_DRAFT);
  return (
    <PainReportScreen
      question={question}
      draft={draft}
      onChange={setDraft}
      onSubmit={onSubmit}
      submitting={false}
      sent={sent}
      onAnswerAgain={vi.fn()}
      error={null}
    />
  );
}

describe('PainReportScreen', () => {
  it('says who sees it, and "no" sends in one tap', () => {
    const onSubmit = vi.fn();
    renderScreen(<Harness onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: t('pain.title') })).toBeDefined();
    expect(screen.getByText(t('pain.privacy'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('pain.answer.no') }));
    expect(onSubmit).toHaveBeenCalledWith({ hasPain: false, areas: [], comment: '' });
  });

  it('a yes opens the body map; each area takes its intensity before sending', () => {
    const onSubmit = vi.fn();
    renderScreen(<Harness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: t('pain.answer.yes') }));
    const send = screen.getByRole('button', { name: t('pain.submit') });
    expect(send.getAttribute('aria-disabled')).toBe('true');

    const knee = areaLabel(translator, { region: 'knee', side: 'left' });
    expect(knee).toBe('Rodilla, lado izquierdo');
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('pain.map.area.select', { area: knee }) }),
    );
    expect(
      screen.getByRole('checkbox', { name: t('pain.map.area.selected', { area: knee }) }),
    ).toBeDefined();
    // Waiting for the intensity: told with icon and text.
    expect(screen.getByText(t('pain.intensity.pick', { area: knee }))).toBeDefined();
    fireEvent.click(
      screen.getByRole('radio', {
        name: `${t('pain.intensity.value', { value: 7 })}, ${t('pain.intensity.severe')}`,
      }),
    );
    // The back view has the lower back.
    fireEvent.click(screen.getByRole('button', { name: t('pain.map.back') }));
    const lumbar = areaLabel(translator, { region: 'lumbar_spine', side: 'central' });
    expect(lumbar).toBe(t('body.region.lumbar_spine'));
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('pain.map.area.select', { area: lumbar }) }),
    );
    const [, lumbarTwo] = screen.getAllByRole('radio', {
      name: `${t('pain.intensity.value', { value: 2 })}, ${t('pain.intensity.mild')}`,
    });
    expect(lumbarTwo).toBeDefined();
    if (lumbarTwo !== undefined) fireEvent.click(lumbarTwo);
    fireEvent.change(screen.getByLabelText(t('pain.comment.label')), {
      target: { value: 'Desde el partido' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('pain.submit') }));
    expect(onSubmit).toHaveBeenCalledWith({
      hasPain: true,
      areas: [
        { region: 'knee', side: 'left', intensity: 7 },
        { region: 'lumbar_spine', side: 'central', intensity: 2 },
      ],
      comment: 'Desde el partido',
    });
  });

  it('removes a marked area from the list', () => {
    renderScreen(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t('pain.answer.yes') }));
    const foot = areaLabel(translator, { region: 'foot', side: 'right' });
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('pain.map.area.select', { area: foot }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('pain.areas.remove', { area: foot }) }));
    expect(screen.getByText(t('pain.areas.none'))).toBeDefined();
  });

  it('tells why it does not ask, and when it needs a connection', () => {
    const { unmount } = renderScreen(
      <Harness question={{ kind: 'unavailable', reason: 'missing_consent' }} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText(t('pain.unavailable.missing_consent'))).toBeDefined();
    expect(screen.queryByRole('button', { name: t('pain.answer.no') })).toBeNull();
    unmount();
    renderScreen(<Harness question={{ kind: 'needs_connection' }} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText(t('pain.needsConnection'))).toBeDefined();
  });

  it('confirms the answer, still queued or reviewed', () => {
    renderScreen(
      <Harness sent={{ hasPain: true, queued: true, reviewed: false }} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText(t('pain.sent.yes'))).toBeDefined();
    expect(screen.getByText(t('pain.sent.queued'))).toBeDefined();
    expect(screen.getByRole('button', { name: t('pain.sent.again') })).toBeDefined();
  });
});
