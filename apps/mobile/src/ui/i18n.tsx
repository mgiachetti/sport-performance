import { createTranslator, resolveLocale, type Translator } from '@sport-performance/i18n';
import type { MembershipRole } from '@sport-performance/domain';
import { createContext, useContext, type ReactNode } from 'react';

/** Translator for the languages of the device, in order of preference. */
export function createAppTranslator(deviceLanguageTags: readonly string[]): Translator {
  return createTranslator({ locale: resolveLocale(deviceLanguageTags) });
}

const TranslatorContext = createContext<Translator>(createTranslator());

export function TranslatorProvider({
  translator,
  children,
}: {
  readonly translator: Translator;
  readonly children: ReactNode;
}) {
  return <TranslatorContext value={translator}>{children}</TranslatorContext>;
}

export function useTranslator(): Translator {
  return useContext(TranslatorContext);
}

/** Label of a membership role (`role.*`). */
export function roleLabel(role: MembershipRole, { t }: Translator): string {
  return t(`role.${role}`);
}
