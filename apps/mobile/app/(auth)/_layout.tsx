import { Stack } from 'expo-router';
import { SignInFlowProvider } from '../../src/state/sign-in-flow.tsx';
import { useTheme } from '../../src/ui/theme.tsx';

/** Signed-out screens: email, code and the guardian's code. */
export default function AuthLayout() {
  const theme = useTheme();
  return (
    <SignInFlowProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />
    </SignInFlowProvider>
  );
}
