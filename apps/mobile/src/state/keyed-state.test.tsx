// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { boardOpeningKey } from '../staff/board.ts';
import { useKeyedState } from './keyed-state.ts';

const ALERT_A = '0192e7a0-4444-7000-8000-00000000000a';
const ALERT_B = '0192e7a0-4444-7000-8000-00000000000b';
const SESSION = '0192e7a0-5555-7000-8000-000000000001';

describe('state of a tab that stays mounted (B-510)', () => {
  it('two alerts in a row: the notice and the review of the first never show on the second', () => {
    const { result, rerender } = renderHook(
      ({ alertId }) => ({
        notice: useKeyedState<string | null>(alertId, null),
        reviewing: useKeyedState(alertId, false),
      }),
      { initialProps: { alertId: ALERT_A } },
    );
    const lateNotice = result.current.notice[1];
    act(() => {
      result.current.reviewing[1](true);
    });
    expect(result.current.reviewing[0]).toBe(true);
    rerender({ alertId: ALERT_B });
    expect(result.current.notice[0]).toBeNull();
    expect(result.current.reviewing[0]).toBe(false);
    // The review of A answers after B opened: it does not land on B.
    act(() => {
      lateNotice('reviewed');
    });
    expect(result.current.notice[0]).toBeNull();
    act(() => {
      result.current.notice[1]('conflict');
    });
    expect(result.current.notice[0]).toBe('conflict');
  });

  it('a tap on the summary push filters by its session, whatever was picked before', () => {
    const { result, rerender } = renderHook(
      ({ tap }) =>
        useKeyedState<string | null | undefined>(boardOpeningKey(SESSION, tap), undefined),
      { initialProps: { tap: undefined as string | undefined } },
    );
    // The person picks "Todas" on the board opened from the tab.
    act(() => {
      result.current[1](null);
    });
    expect(result.current[0]).toBeNull();
    // A tap on the push: the pick is gone, the session's category applies.
    rerender({ tap: '1' });
    expect(result.current[0]).toBeUndefined();
    act(() => {
      result.current[1]('m17');
    });
    // Another tap of the same session starts from it again.
    rerender({ tap: '2' });
    expect(result.current[0]).toBeUndefined();
  });
});
