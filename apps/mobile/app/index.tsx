import { Redirect } from 'expo-router';
import { useState } from 'react';
import { UnavailableScreen } from '../src/screens/clubs.tsx';
import { useKiosk, useServices, useSession } from '../src/state/app-context.tsx';
import { useTranslator } from '../src/ui/i18n.tsx';
import { LoadingView } from '../src/ui/primitives.tsx';

/**
 * Entry route and anchor of the guards: sends each session state to its
 * place. When a guard closes (sign-out, a lost membership), the router comes
 * back here and this redirects again.
 */
export default function Index() {
  const { session } = useServices();
  const state = useSession();
  const kiosk = useKiosk();
  const { t } = useTranslator();
  const [retrying, setRetrying] = useState(false);

  switch (state.status) {
    case 'starting':
      return <LoadingView label={t('common.loading')} />;
    case 'unavailable':
      return (
        <UnavailableScreen
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void session.refresh().finally(() => {
              setRetrying(false);
            });
          }}
          onSignOut={() => {
            void session.signOut();
          }}
        />
      );
    case 'signedOut':
      return <Redirect href="/sign-in" />;
    case 'signedIn':
      if (state.activeMembership === null) return <Redirect href="/select-club" />;
      // Until the kiosk is read the staff's app never shows: it may be the club's kiosk.
      if (kiosk.status === 'loading') return <LoadingView label={t('common.loading')} />;
      return kiosk.status === 'on' ? <Redirect href="/kiosk" /> : <Redirect href="/home" />;
  }
}
