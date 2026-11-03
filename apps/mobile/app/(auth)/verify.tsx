import { Redirect, router } from 'expo-router';
import { VerifyCodeScreen } from '../../src/screens/sign-in.tsx';
import { useServices } from '../../src/state/app-context.tsx';
import { useSignInFlow } from '../../src/state/sign-in-flow.tsx';

export default function Verify() {
  const { session } = useServices();
  const flow = useSignInFlow();
  // Opened without an email (restored navigation state): start over.
  if (flow.email === '') return <Redirect href="/sign-in" />;
  return (
    <VerifyCodeScreen
      email={flow.email}
      expiresInS={flow.expiresInS}
      verify={(code) => session.verifyCode(flow.email, code)}
      resend={async () => {
        const expiresInS = await session.requestCode(flow.email);
        flow.setCodeSent(flow.email, expiresInS);
        return expiresInS;
      }}
      onChangeEmail={() => {
        router.back();
      }}
    />
  );
}
