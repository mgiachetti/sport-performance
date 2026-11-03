import { invitationTokenSchema } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { InvitationScreen, type InvitationPreviewState } from '../../src/screens/invitation.tsx';
import { useServices, useSession } from '../../src/state/app-context.tsx';

/**
 * An invitation link (`<scheme>://invite/<token>` or the web's universal
 * link, ADR 0028). The token goes to the API in the body, never in a URL.
 */
export default function Invite() {
  const services = useServices();
  const state = useSession();
  const params = useLocalSearchParams<{ token: string }>();
  const parsed = invitationTokenSchema.safeParse(params.token);
  const token = parsed.success ? parsed.data : null;
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    // Signed out: come back here after the sign-in (memory only).
    if (token !== null && state.status === 'signedOut') {
      services.session.pendingInvitation.set(token);
    }
    if (signedIn) services.session.pendingInvitation.set(null);
  }, [token, state.status, signedIn, services.session]);

  const preview = useQuery({
    queryKey: ['public', 'invitationPreview', token],
    enabled: token !== null,
    // A link is opened once: never serve a stale status (accepted, revoked).
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) =>
      services.api.client.previewInvitation({ body: { token: token ?? '' } }, { signal }),
  });

  const screenState: InvitationPreviewState =
    token === null
      ? { status: 'invalidLink' }
      : preview.isPending
        ? { status: 'loading' }
        : preview.isError
          ? { status: 'error', error: preview.error }
          : { status: 'ready', preview: preview.data };

  return (
    <InvitationScreen
      state={screenState}
      signedIn={signedIn}
      accept={async () => {
        if (token === null) return;
        await services.session.acceptInvitation(token);
      }}
      onSignIn={() => {
        router.replace('/sign-in');
      }}
      onDone={() => {
        router.replace('/');
      }}
      onRetry={() => {
        void preview.refetch();
      }}
    />
  );
}
