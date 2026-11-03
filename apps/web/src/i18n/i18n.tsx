import type { MessageKey, MessageValues, Translator } from '@sport-performance/i18n';
import { createContext, useContext, type ReactNode } from 'react';

const TranslatorContext = createContext<Translator | null>(null);

/**
 * Provides the translator (ADR 0019). The web ships the `es-AR` source
 * catalog; club terminology overrides plug in here when the API serves them.
 */
export function I18nProvider(props: { translator: Translator; children: ReactNode }) {
  return (
    <TranslatorContext.Provider value={props.translator}>
      {props.children}
    </TranslatorContext.Provider>
  );
}

export function useTranslator(): Translator {
  const translator = useContext(TranslatorContext);
  if (translator === null) throw new Error('useTranslator outside <I18nProvider>');
  return translator;
}

/** `const t = useT(); t('common.save')`. */
export function useT(): Translator['t'] {
  return useTranslator().t;
}

/**
 * For a key chosen at runtime (an error code, a status): `t` cannot check its
 * arguments statically, so the caller passes the values the message needs.
 */
export function translate(t: Translator['t'], key: MessageKey, values?: MessageValues): string {
  return (t as (key: MessageKey, values?: MessageValues) => string)(key, values);
}
