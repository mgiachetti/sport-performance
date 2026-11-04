import { createTranslator } from '@sport-performance/i18n';
import type { ThemeVariant } from '@sport-performance/ui-tokens';
import { act, configure, getConfig, render } from '@testing-library/react';
import { useLayoutEffect, useState, type ReactElement, type ReactNode } from 'react';
import { nativeThemeFor } from '../branding/club-branding.ts';
import { TranslatorProvider } from '../ui/i18n.tsx';
import { ThemeProvider } from '../ui/theme.tsx';

export const translator = createTranslator();

/** One per mounted screen: re-renders its root, which first runs React's pending effects. */
const settlers = new Set<() => void>();

/**
 * Wraps each rendered screen. Bumping its state is an update of the same
 * root, and React runs every pending passive effect of a root before it
 * renders it again, so `settle()` leaves the screen with all its effects run.
 * The children keep their element, so they are not rendered again.
 */
function Settle({ children }: { readonly children: ReactNode }) {
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const settle = () => {
      setTick((tick) => tick + 1);
    };
    settlers.add(settle);
    return () => {
      settlers.delete(settle);
    };
  }, []);
  return children;
}

/**
 * Runs, inside `act`, the effects React left pending in the mounted screens.
 *
 * `waitFor` and `findBy*` run outside `act` (Testing Library turns the act
 * environment off while they wait), so the renders that the awaited promise
 * starts go through React's scheduler: the commit puts the new text on the
 * screen, which is what the wait sees, and the passive effects run in a later
 * scheduler task. React Native Web's `Pressable` hands its `onPress` and
 * `disabled` to its press responder in one of those effects
 * (`usePressEvents`), so until it runs a press reaches the button as it was
 * before: still busy, or with the handler of the previous render. Under CPU
 * contention the scheduler yields and that task came after the wait had
 * already returned, and a press right after the wait was lost («expected
 * vi.fn() to be called 1 times, but got 0 times»).
 */
function settle(): void {
  act(() => {
    for (const run of settlers) run();
  });
}

const testingLibrary = getConfig();

configure({
  // Every wait returns with the screen settled, so the next press finds it as it is shown.
  asyncWrapper: async (callback) => {
    const result: unknown = await testingLibrary.asyncWrapper(callback);
    settle();
    return result;
  },
  // Testing Library's 1 s is wall-clock time, and `pnpm test` runs every
  // package at once on a CI runner: 5 s gives a slow screen room and keeps a
  // missing element a fast failure, far below the shared `testTimeout` (30 s).
  asyncUtilTimeout: 5000,
});

/**
 * Renders a screen as the app does (translator and club theme), through
 * `react-native-web` in jsdom. Query by role and accessible name, as a
 * screen reader user would find things.
 */
export function renderScreen(ui: ReactElement, variant: ThemeVariant = 'dark') {
  return render(
    <Settle>
      <TranslatorProvider translator={translator}>
        <ThemeProvider
          value={{ theme: nativeThemeFor(null, variant), variant, setVariant: () => undefined }}
        >
          {ui}
        </ThemeProvider>
      </TranslatorProvider>
    </Settle>,
  );
}
