import type { InvitationPreview } from '@sport-performance/contracts';
import { Fragment, useState } from 'react';
import { errorMessage } from '../api/error-message.ts';
import { roleLabel, useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  StatusMessage,
} from '../ui/primitives.tsx';

export type InvitationPreviewState =
  | { readonly status: 'invalidLink' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly preview: InvitationPreview };

export function InvitationScreen({
  state,
  signedIn,
  accept,
  onSignIn,
  onDone,
  onRetry,
}: {
  readonly state: InvitationPreviewState;
  readonly signedIn: boolean;
  readonly accept: () => Promise<void>;
  readonly onSignIn: () => void;
  readonly onDone: () => void;
  readonly onRetry: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  if (state.status === 'loading') return <LoadingView label={t('common.loading')} />;

  if (state.status === 'invalidLink') {
    return (
      <ScreenBody>
        <StatusMessage level="critical">{t('invitation.invalidLink')}</StatusMessage>
        <Button variant="secondary" label={t('nav.goHome')} onPress={onDone} />
      </ScreenBody>
    );
  }

  if (state.status === 'error') {
    return (
      <ScreenBody>
        <StatusMessage level="critical">
          {errorMessage(state.error, 'invitationPreview', translator)}
        </StatusMessage>
        <Button label={t('common.retry')} onPress={onRetry} />
        <Button variant="link" label={t('nav.goHome')} onPress={onDone} />
      </ScreenBody>
    );
  }

  const { preview } = state;
  const clubName = preview.club.name;
  const pending = preview.status === 'pending';

  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('invitation.title', { clubName })}
      </AppText>
      <Card>
        <AppText>{t('invitation.asRole', { role: roleLabel(preview.role, translator) })}</AppText>
        <AppText tone="secondary" role="bodySmall">
          {t(`invitation.status.${preview.status}`)}
        </AppText>
      </Card>
      {/* Keyed: each outcome mounts its own buttons, never reusing the busy one. */}
      {accepted ? (
        <Fragment key="accepted">
          <StatusMessage level="ok">{t('invitation.accepted', { clubName })}</StatusMessage>
          <Button label={t('invitation.goToClub')} onPress={onDone} />
        </Fragment>
      ) : !pending ? (
        <Fragment key="unavailable">
          <StatusMessage level="critical">{t('invitation.error.unavailable')}</StatusMessage>
          <Button variant="secondary" label={t('nav.goHome')} onPress={onDone} />
        </Fragment>
      ) : signedIn ? (
        <Fragment key="accept">
          {acceptError !== null ? (
            <StatusMessage level="critical">{acceptError}</StatusMessage>
          ) : null}
          <Button
            label={t('invitation.accept')}
            busy={accepting}
            onPress={() => {
              setAccepting(true);
              setAcceptError(null);
              accept()
                .then(() => {
                  setAccepted(true);
                })
                .catch((error: unknown) => {
                  setAcceptError(errorMessage(error, 'invitationAccept', translator));
                })
                .finally(() => {
                  setAccepting(false);
                });
            }}
          />
        </Fragment>
      ) : (
        <Fragment key="signIn">
          <AppText tone="secondary">
            {t('invitation.signInFirst', { emailHint: preview.emailHint })}
          </AppText>
          <Button label={t('invitation.signIn')} onPress={onSignIn} />
        </Fragment>
      )}
    </ScreenBody>
  );
}
