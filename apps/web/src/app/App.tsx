import { ChartsProvider } from '@sport-performance/charts/web';
import { createTranslator, resolveLocale, type Translator } from '@sport-performance/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { I18nProvider } from '../i18n/i18n';
import { ConnectionMonitor } from '../status/ConnectionMonitor';
import { ThemeController } from '../theme/ThemeController';
import type { WebApp } from './create-app';
import { ServicesProvider } from './services';

export function defaultTranslator(languages: readonly string[]): Translator {
  return createTranslator({ locale: resolveLocale(languages) });
}

/** Providers around the router: services, query cache, translator (and charts), theme, connection. */
export function App(props: { app: WebApp; translator: Translator }) {
  const { services, router } = props.app;
  return (
    <ServicesProvider services={services}>
      <QueryClientProvider client={services.queryClient}>
        <I18nProvider translator={props.translator}>
          <ChartsProvider translator={props.translator}>
            <ThemeController />
            <ConnectionMonitor />
            <RouterProvider router={router} />
          </ChartsProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ServicesProvider>
  );
}
