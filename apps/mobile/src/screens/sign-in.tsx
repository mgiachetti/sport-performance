import {
  PLAYER_ACCESS_CODE_EXPIRES_IN_S,
  SIGN_IN_CODE_LENGTH,
  emailSchema,
  playerAccessCodeSchema,
  signInCodeSchema,
} from '@sport-performance/contracts';
import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '../api/error-message.ts';
import type { SignedOutNotice } from '../state/session-controller.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, ScreenBody, StatusMessage, TextField } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/** Runs an async action with a busy flag and its error as text. */
function useAction(context: Parameters<typeof errorMessage>[1]) {
  const translator = useTranslator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught, context, translator));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function SignInScreen({
  notice,
  initialEmail = '',
  onCodeSent,
  requestCode,
  onPlayerAccess,
}: {
  readonly notice: SignedOutNotice | null;
  readonly initialEmail?: string;
  /** Asks the API for the code; resolves with its lifetime in seconds. */
  readonly requestCode: (email: string) => Promise<number>;
  readonly onCodeSent: (email: string, expiresInS: number) => void;
  readonly onPlayerAccess: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [email, setEmail] = useState(initialEmail);
  const { busy, error, setError, run } = useAction('requestCode');

  function submit(): void {
    const parsed = emailSchema.safeParse(email.trim().toLowerCase());
    if (!parsed.success) {
      setError(t('auth.email.invalid'));
      return;
    }
    void run(async () => {
      const expiresInS = await requestCode(parsed.data);
      onCodeSent(parsed.data, expiresInS);
    });
  }

  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('auth.signIn.title', { appName: t('app.name') })}
      </AppText>
      <AppText tone="secondary">{t('auth.signIn.subtitle')}</AppText>
      {notice === 'sessionExpired' ? (
        <StatusMessage level="warning">{t('error.sessionExpired')}</StatusMessage>
      ) : null}
      <TextField
        label={t('auth.email.label')}
        value={email}
        onChangeText={setEmail}
        error={error}
        inputProps={{
          autoCapitalize: 'none',
          autoCorrect: false,
          autoComplete: 'email',
          keyboardType: 'email-address',
          textContentType: 'emailAddress',
          inputMode: 'email',
          placeholder: t('auth.email.placeholder'),
          returnKeyType: 'send',
          onSubmitEditing: submit,
        }}
      />
      <Button label={t('auth.email.submit')} onPress={submit} busy={busy} />
      <View style={{ marginTop: theme.spacing.lg }}>
        <Button variant="link" label={t('auth.playerAccess.link')} onPress={onPlayerAccess} />
      </View>
    </ScreenBody>
  );
}

export function VerifyCodeScreen({
  email,
  expiresInS,
  verify,
  resend,
  onChangeEmail,
}: {
  readonly email: string;
  readonly expiresInS: number;
  readonly verify: (code: string) => Promise<void>;
  readonly resend: () => Promise<number>;
  readonly onChangeEmail: () => void;
}) {
  const { t } = useTranslator();
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const [minutes, setMinutes] = useState(Math.max(1, Math.round(expiresInS / 60)));
  const verifying = useAction('verifyCode');
  const resending = useAction('requestCode');

  function submit(value = code): void {
    const parsed = signInCodeSchema.safeParse(value.trim());
    if (!parsed.success) {
      verifying.setError(t('auth.otp.format', { length: SIGN_IN_CODE_LENGTH }));
      return;
    }
    setResent(false);
    void verifying.run(() => verify(parsed.data));
  }

  function changeCode(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, SIGN_IN_CODE_LENGTH);
    setCode(digits);
    // Pasted or autofilled from the email (iOS `oneTimeCode`): no extra tap.
    if (digits.length === SIGN_IN_CODE_LENGTH && !verifying.busy) submit(digits);
  }

  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('auth.otp.title')}
      </AppText>
      <AppText tone="secondary">{t('auth.otp.sent', { email })}</AppText>
      <AppText tone="secondary" role="bodySmall">
        {t('auth.otp.expiresIn', { minutes })}
      </AppText>
      {resent ? <StatusMessage level="ok">{t('auth.otp.resent')}</StatusMessage> : null}
      <TextField
        label={t('auth.otp.label')}
        value={code}
        onChangeText={changeCode}
        error={verifying.error ?? resending.error}
        inputProps={{
          keyboardType: 'number-pad',
          inputMode: 'numeric',
          textContentType: 'oneTimeCode',
          autoComplete: 'one-time-code',
          maxLength: SIGN_IN_CODE_LENGTH,
          returnKeyType: 'done',
          onSubmitEditing: () => {
            submit();
          },
        }}
      />
      <Button
        label={t('auth.signIn')}
        onPress={() => {
          submit();
        }}
        busy={verifying.busy}
      />
      <Button
        variant="secondary"
        label={t('auth.otp.resend')}
        busy={resending.busy}
        onPress={() => {
          void resending
            .run(async () => {
              const seconds = await resend();
              setMinutes(Math.max(1, Math.round(seconds / 60)));
            })
            .then((ok) => {
              if (ok) {
                setCode('');
                verifying.setError(null);
                setResent(true);
              }
            });
        }}
      />
      <Button variant="link" label={t('auth.otp.changeEmail')} onPress={onChangeEmail} />
    </ScreenBody>
  );
}

export function PlayerAccessScreen({
  redeem,
  onUseEmail,
}: {
  readonly redeem: (code: string) => Promise<void>;
  readonly onUseEmail: () => void;
}) {
  const { t } = useTranslator();
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useAction('playerAccess');

  function submit(): void {
    const parsed = playerAccessCodeSchema.safeParse(code.trim());
    if (!parsed.success) {
      setError(t('auth.playerAccess.invalidFormat'));
      return;
    }
    void run(() => redeem(parsed.data));
  }

  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('auth.playerAccess.title')}
      </AppText>
      <AppText tone="secondary">
        {t('auth.playerAccess.body', { minutes: PLAYER_ACCESS_CODE_EXPIRES_IN_S / 60 })}
      </AppText>
      <TextField
        label={t('auth.playerAccess.label')}
        value={code}
        onChangeText={(value) => {
          setCode(value.toUpperCase());
        }}
        error={error}
        hint={t('auth.playerAccess.invalidFormat')}
        inputProps={{
          autoCapitalize: 'characters',
          autoCorrect: false,
          autoComplete: 'off',
          maxLength: 9,
          returnKeyType: 'done',
          onSubmitEditing: submit,
        }}
      />
      <Button label={t('auth.signIn')} onPress={submit} busy={busy} />
      <Button variant="link" label={t('auth.withEmail')} onPress={onUseEmail} />
    </ScreenBody>
  );
}
