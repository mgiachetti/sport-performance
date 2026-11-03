import { playerAccessTokenSchema } from '@sport-performance/contracts';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import { useServices, useSession } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import { Button, LoadingView, ScreenBody, StatusMessage } from '../../src/ui/primitives.tsx';

/**
 * The sign-in link a guardian shares with a player without email (ADR 0042):
 * redeemed once, on opening, for a bearer session of the player's account.
 */
export default function PlayerAccessLink() {
  const services = useServices();
  const translator = useTranslator();
  const { t } = translator;
  const state = useSession();
  const params = useLocalSearchParams<{ token: string }>();
  const parsed = playerAccessTokenSchema.safeParse(params.token);
  const token = parsed.success ? parsed.data : null;
  const attempted = useRef(false);
  const redeem = useMutation({
    mutationFn: (linkToken: string) => services.session.redeemPlayerAccess({ token: linkToken }),
    onSuccess: () => {
      router.replace('/');
    },
  });
  const { mutate } = redeem;
  const signedOut = state.status === 'signedOut';

  useEffect(() => {
    // One attempt per opening: the token is single use.
    if (token === null || !signedOut || attempted.current) return;
    attempted.current = true;
    mutate(token);
  }, [token, signedOut, mutate]);

  const goHome = () => {
    router.replace('/');
  };

  const message =
    token === null
      ? { level: 'critical' as const, text: t('auth.playerAccess.unavailable') }
      : redeem.isError
        ? {
            level: 'critical' as const,
            text: errorMessage(redeem.error, 'playerAccess', translator),
          }
        : redeem.isIdle && state.status === 'signedIn'
          ? { level: 'warning' as const, text: t('auth.playerAccess.signedIn') }
          : null;

  if (message === null) return <LoadingView label={t('auth.playerAccess.signingIn')} />;
  return (
    <ScreenBody>
      <StatusMessage level={message.level}>{message.text}</StatusMessage>
      <Button variant="secondary" label={t('nav.goHome')} onPress={goHome} />
    </ScreenBody>
  );
}
