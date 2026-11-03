import type { Translator } from '@sport-performance/i18n';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getDefaultTranslator } from '../core/format.js';
import type { LayoutOptions } from '../core/types.js';

interface ChartsContextValue {
  readonly translator: Translator;
}

const ChartsContext = createContext<ChartsContextValue | null>(null);

export interface ChartsProviderProps {
  /** The club's translator (catalog + club overrides). es-AR by default. */
  readonly translator?: Translator | undefined;
  readonly children: ReactNode;
}

/** Gives every chart below it the club's translator. Optional: without it charts use es-AR. */
export function ChartsProvider({ translator, children }: ChartsProviderProps) {
  const value = useMemo(() => ({ translator: translator ?? getDefaultTranslator() }), [translator]);
  return <ChartsContext value={value}>{children}</ChartsContext>;
}

/** Layout options (translator) for the core functions. */
export function useChartOptions(): LayoutOptions & { readonly translator: Translator } {
  const context = useContext(ChartsContext);
  return useMemo(() => ({ translator: context?.translator ?? getDefaultTranslator() }), [context]);
}
