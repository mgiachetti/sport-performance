import { router } from 'expo-router';
import { SignInScreen } from '../../src/screens/sign-in.tsx';
import { useServices, useSession } from '../../src/state/app-context.tsx';
import { useSignInFlow } from '../../src/state/sign-in-flow.tsx';

export default function SignIn() {
  const { session } = useServices();
  const state = useSession();
  const flow = useSignInFlow();
  return (
    <SignInScreen
      notice={state.status === 'signedOut' ? state.notice : null}
      initialEmail={flow.email}
      requestCode={(email) => session.requestCode(email)}
      onCodeSent={(email, expiresInS) => {
        flow.setCodeSent(email, expiresInS);
        router.push('/verify');
      }}
      onPlayerAccess={() => {
        router.push('/player-code');
      }}
    />
  );
}
