import {
  ApiError,
  SIGN_IN_CODE_LENGTH,
  emailSchema,
  signInCodeSchema,
} from '@sport-performance/contracts';
import { useMutation } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { describeError } from '../api/errors';
import { useServices } from '../app/services';
import { translate, useT } from '../i18n/i18n';
import { StandaloneLayout } from '../layout/RootLayout';
import { Button, Notice, Page, TextField } from '../ui/components';
import { type MessageKey, type MessageValues, retryWaitValues } from '@sport-performance/i18n';

const route = getRouteApi('/login');

interface Problem {
  readonly key: MessageKey;
  readonly values?: MessageValues;
  readonly requestId?: string;
}

/** Sign-in answers the user can act on; the rest goes through the error envelope. */
export function signInProblem(error: unknown, step: 'email' | 'code'): Problem {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      if (error.retryAfterS !== undefined && error.retryAfterS > 0) {
        return { key: 'auth.rateLimitedFor', values: retryWaitValues(error.retryAfterS) };
      }
      // A burnt code (3 attempts) answers 429 without Retry-After: ask for another one.
      return { key: step === 'code' ? 'auth.otp.tooManyAttempts' : 'auth.rateLimited' };
    }
    if (error.status === 401 && step === 'code') return { key: 'auth.otp.invalid' };
  }
  const description = describeError(error);
  return {
    key: description.messageKey,
    ...(description.requestId === undefined ? {} : { requestId: description.requestId }),
  };
}

/**
 * Sign-in by email code (ADR 0010, ADR 0028): `POST /v1/auth/email-otp`,
 * then `/verify` with `transport: 'cookie'`. The session is an `HttpOnly`
 * cookie of the API; this page never handles a token.
 */
export function LoginPage() {
  const t = useT();
  const { api, queryClient } = useServices();
  const search = route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [expiresInS, setExpiresInS] = useState<number | null>(null);
  const [resent, setResent] = useState(false);

  const send = useMutation({
    mutationFn: (address: string) => api.sendSignInCode({ body: { email: address } }),
    retry: false,
    onSuccess: (result) => {
      setExpiresInS(result.expiresInS);
      setCode('');
      setProblem(null);
      setStep('code');
    },
    onError: (error) => {
      setProblem(signInProblem(error, 'email'));
    },
  });

  const verify = useMutation({
    mutationFn: (input: { email: string; code: string }) =>
      api.verifySignInCode({ body: { ...input, transport: 'cookie' } }),
    retry: false,
    onSuccess: async () => {
      // Nothing of a previous session survives a sign-in.
      queryClient.clear();
      await navigate({ href: search.redirect ?? '/', replace: true });
    },
    onError: (error) => {
      setProblem(signInProblem(error, 'code'));
    },
  });

  const submitEmail = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!emailSchema.safeParse(address).success) {
      setFieldError(t('auth.email.invalid'));
      return;
    }
    setFieldError(null);
    setResent(false);
    send.mutate(address);
  };

  const submitCode = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = code.trim();
    if (!signInCodeSchema.safeParse(value).success) {
      setFieldError(t('auth.otp.format', { length: SIGN_IN_CODE_LENGTH }));
      return;
    }
    setFieldError(null);
    verify.mutate({ email: email.trim(), code: value });
  };

  const resend = () => {
    setResent(true);
    send.mutate(email.trim());
  };

  return (
    <StandaloneLayout>
      <Page
        title={t('auth.signIn.title', { appName: t('app.name') })}
        subtitle={t('auth.signIn.subtitle')}
      >
        {search.expired === true && step === 'email' && problem === null ? (
          <Notice level="info" role="status">
            <p>{t('error.sessionExpired')}</p>
          </Notice>
        ) : null}
        {problem === null ? null : (
          <Notice level="critical" role="alert">
            <p>{translate(t, problem.key, problem.values)}</p>
            {problem.requestId === undefined ? null : (
              <p className="sp-notice__meta">
                {t('error.requestId', { requestId: problem.requestId })}
              </p>
            )}
          </Notice>
        )}

        {step === 'email' ? (
          <form className="sp-form" onSubmit={submitEmail} noValidate>
            <TextField
              label={t('auth.email.label')}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              required
              value={email}
              error={fieldError}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? t('common.loading') : t('auth.email.submit')}
            </Button>
          </form>
        ) : (
          <form className="sp-form" onSubmit={submitCode} noValidate>
            <Notice level="info" role="status">
              <p>
                {resent && send.isSuccess
                  ? t('auth.otp.resent')
                  : t('auth.otp.sent', { email: email.trim() })}
              </p>
              {expiresInS === null ? null : (
                <p>
                  {t('auth.otp.expiresIn', { minutes: Math.max(1, Math.round(expiresInS / 60)) })}
                </p>
              )}
            </Notice>
            <TextField
              label={t('auth.otp.label')}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={SIGN_IN_CODE_LENGTH}
              autoFocus
              required
              value={code}
              error={fieldError}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ''));
              }}
            />
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending ? t('common.loading') : t('auth.signIn')}
            </Button>
            <div className="sp-form__secondary">
              <Button variant="ghost" onClick={resend} disabled={send.isPending}>
                {t('auth.otp.resend')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('email');
                  setProblem(null);
                  setFieldError(null);
                }}
              >
                {t('auth.otp.changeEmail')}
              </Button>
            </div>
          </form>
        )}
      </Page>
    </StandaloneLayout>
  );
}
