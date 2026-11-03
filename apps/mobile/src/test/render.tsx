import { createTranslator } from '@sport-performance/i18n';
import type { ThemeVariant } from '@sport-performance/ui-tokens';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { nativeThemeFor } from '../branding/club-branding.ts';
import { TranslatorProvider } from '../ui/i18n.tsx';
import { ThemeProvider } from '../ui/theme.tsx';

export const translator = createTranslator();

/**
 * Renders a screen as the app does (translator and club theme), through
 * `react-native-web` in jsdom. Query by role and accessible name, as a
 * screen reader user would find things.
 */
export function renderScreen(ui: ReactElement, variant: ThemeVariant = 'dark') {
  return render(
    <TranslatorProvider translator={translator}>
      <ThemeProvider
        value={{ theme: nativeThemeFor(null, variant), variant, setVariant: () => undefined }}
      >
        {ui}
      </ThemeProvider>
    </TranslatorProvider>,
  );
}
