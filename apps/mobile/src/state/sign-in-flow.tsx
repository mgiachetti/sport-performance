import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The email being signed in and the lifetime of its code, shared by the
 * email and code screens. In memory only: never in the route (it would end
 * up in navigation breadcrumbs) nor on disk.
 */
export interface SignInFlow {
  readonly email: string;
  readonly expiresInS: number;
  setCodeSent(email: string, expiresInS: number): void;
}

const SignInFlowContext = createContext<SignInFlow | null>(null);

export function useSignInFlow(): SignInFlow {
  const flow = useContext(SignInFlowContext);
  if (flow === null) throw new Error('useSignInFlow() outside <SignInFlowProvider>');
  return flow;
}

export function SignInFlowProvider({ children }: { readonly children: ReactNode }) {
  const [sent, setSent] = useState({ email: '', expiresInS: 0 });
  const flow = useMemo<SignInFlow>(
    () => ({
      ...sent,
      setCodeSent: (email, expiresInS) => {
        setSent({ email, expiresInS });
      },
    }),
    [sent],
  );
  return <SignInFlowContext value={flow}>{children}</SignInFlowContext>;
}
