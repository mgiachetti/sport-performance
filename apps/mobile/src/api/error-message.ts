import { ApiContractError, ApiError, ApiNetworkError } from '@sport-performance/contracts';
import { type MessageKey, type Translator, retryWaitValues } from '@sport-performance/i18n';

/**
 * Where an error happened, to pick the right words: the same `401` means
 * "wrong code" on the sign-in and "your session expired" anywhere else.
 */
export type ErrorContext =
  | 'generic'
  | 'requestCode'
  | 'verifyCode'
  | 'playerAccess'
  | 'invitationPreview'
  | 'invitationAccept';

/**
 * The text the user sees for an error of the typed client (`ApiError`,
 * `ApiNetworkError`, `ApiContractError`). Never the server message: it is
 * English and meant for developers (ADR 0020).
 */
export function errorMessage(error: unknown, context: ErrorContext, { t }: Translator): string {
  if (error instanceof ApiNetworkError) return t('error.network');
  // An off-contract answer or input is a bug, reported to Sentry by the caller.
  if (error instanceof ApiContractError || !(error instanceof ApiError)) return t('error.generic');

  if (error.code === 'app_update_required') return t('error.appUpdateRequired');
  if (error.code === 'service_unavailable') return t('error.code.service_unavailable');
  if (error.code === 'rate_limited') {
    if (error.retryAfterS === undefined) {
      // Only the verification burns a code: elsewhere, a limit without a wait.
      return context === 'verifyCode' ? t('auth.otp.tooManyAttempts') : t('auth.rateLimited');
    }
    return t('auth.rateLimitedFor', retryWaitValues(error.retryAfterS));
  }

  const key = contextualKey(error.code, context);
  if (key !== null) return t(key);

  switch (error.code) {
    case 'unauthenticated':
      return t('error.sessionExpired');
    case 'forbidden':
      return t('error.forbidden');
    case 'not_found':
      return t('error.notFound');
    default:
      return t('error.generic');
  }
}

function contextualKey(code: string, context: ErrorContext): MessageKey | null {
  switch (context) {
    case 'verifyCode':
      return code === 'unauthenticated' ? 'auth.otp.invalid' : null;
    case 'playerAccess':
      if (code === 'not_found') return 'auth.playerAccess.notFound';
      if (code === 'conflict') return 'auth.playerAccess.unavailable';
      return null;
    case 'invitationPreview':
      return code === 'not_found' ? 'invitation.error.unavailable' : null;
    case 'invitationAccept':
      if (code === 'conflict' || code === 'not_found') return 'invitation.error.unavailable';
      if (code === 'forbidden') return 'invitation.error.wrongEmail';
      return null;
    case 'generic':
    case 'requestCode':
      return null;
  }
}
