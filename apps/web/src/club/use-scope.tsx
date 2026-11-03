import { createContext, useContext, type ReactNode } from 'react';
import type { ResolvedScope } from './scope';

const ScopeContext = createContext<ResolvedScope | null>(null);

export function ScopeProvider(props: { value: ResolvedScope; children: ReactNode }) {
  return <ScopeContext.Provider value={props.value}>{props.children}</ScopeContext.Provider>;
}

/**
 * Sport and category picked in the layout, already checked against what the
 * user sees. Screens filter by it; `null` means "all I see".
 */
export function useScope(): ResolvedScope {
  const value = useContext(ScopeContext);
  if (value === null) throw new Error('useScope outside the club layout');
  return value;
}
