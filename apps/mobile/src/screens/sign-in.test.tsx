// @vitest-environment jsdom
import { ApiError } from '@sport-performance/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen, translator } from '../test/render.tsx';
import { PlayerAccessScreen, SignInScreen, VerifyCodeScreen } from './sign-in.tsx';

const { t } = translator;

function apiError(code: string, status: number, retryAfterS?: number): ApiError {
  return new ApiError({ operationId: 'op', status, code, message: code, retryAfterS });
}

describe('SignInScreen', () => {
  function setup(requestCode = vi.fn(() => Promise.resolve(300))) {
    const onCodeSent = vi.fn();
    const onPlayerAccess = vi.fn();
    renderScreen(
      <SignInScreen
        notice={null}
        requestCode={requestCode}
        onCodeSent={onCodeSent}
        onPlayerAccess={onPlayerAccess}
      />,
    );
    return { requestCode, onCodeSent, onPlayerAccess };
  }

  it('asks for the code with the email in lowercase', async () => {
    const { requestCode, onCodeSent } = setup();
    fireEvent.change(screen.getByLabelText(t('auth.email.label')), {
      target: { value: ' Ana@Example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('auth.email.submit') }));
    await waitFor(() => {
      expect(onCodeSent).toHaveBeenCalledWith('ana@example.com', 300);
    });
    expect(requestCode).toHaveBeenCalledWith('ana@example.com');
  });

  it('flags an invalid email without calling the API, as text and icon', () => {
    const { requestCode } = setup();
    fireEvent.change(screen.getByLabelText(t('auth.email.label')), { target: { value: 'ana@' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.email.submit') }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(t('auth.email.invalid'));
    expect(alert.getAttribute('aria-label')).toBe(
      `${t('status.critical')}: ${t('auth.email.invalid')}`,
    );
    expect(requestCode).not.toHaveBeenCalled();
  });

  it('says how long to wait when the email is rate limited', async () => {
    setup(vi.fn(() => Promise.reject(apiError('rate_limited', 429, 900))));
    fireEvent.change(screen.getByLabelText(t('auth.email.label')), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('auth.email.submit') }));
    expect(
      await screen.findByText(t('auth.rateLimitedFor', { unit: 'minutes', amount: 15 })),
    ).toBeDefined();
  });

  it('shows why the user is back on the sign-in', () => {
    renderScreen(
      <SignInScreen
        notice="sessionExpired"
        requestCode={vi.fn()}
        onCodeSent={vi.fn()}
        onPlayerAccess={vi.fn()}
      />,
    );
    expect(screen.getByText(t('error.sessionExpired'))).toBeDefined();
  });

  it('offers the guardian code', () => {
    const { onPlayerAccess } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('auth.playerAccess.link') }));
    expect(onPlayerAccess).toHaveBeenCalled();
  });
});

describe('VerifyCodeScreen', () => {
  function setup(verify: (code: string) => Promise<void> = vi.fn(() => Promise.resolve())) {
    const resend = vi.fn(() => Promise.resolve(300));
    renderScreen(
      <VerifyCodeScreen
        email="ana@example.com"
        expiresInS={300}
        verify={verify}
        resend={resend}
        onChangeEmail={vi.fn()}
      />,
    );
    return { verify, resend };
  }

  it('verifies as soon as the six digits are typed or pasted', async () => {
    const { verify } = setup();
    expect(screen.getByText(t('auth.otp.sent', { email: 'ana@example.com' }))).toBeDefined();
    fireEvent.change(screen.getByLabelText(t('auth.otp.label')), {
      target: { value: '48 29-13' },
    });
    await waitFor(() => {
      expect(verify).toHaveBeenCalledWith('482913');
    });
  });

  it('explains a wrong code and a burnt one', async () => {
    const verify = vi
      .fn<(code: string) => Promise<void>>()
      .mockRejectedValueOnce(apiError('unauthenticated', 401))
      .mockRejectedValueOnce(apiError('rate_limited', 429));
    setup(verify);
    const input = screen.getByLabelText(t('auth.otp.label'));
    fireEvent.change(input, { target: { value: '111111' } });
    expect(await screen.findByText(t('auth.otp.invalid'))).toBeDefined();
    fireEvent.change(input, { target: { value: '222222' } });
    expect(await screen.findByText(t('auth.otp.tooManyAttempts'))).toBeDefined();
  });

  it('asks for a complete code before calling the API', () => {
    const { verify } = setup();
    fireEvent.change(screen.getByLabelText(t('auth.otp.label')), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));
    expect(screen.getByText(t('auth.otp.format', { length: 6 }))).toBeDefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('sends a new code and says the old one no longer works', async () => {
    const { resend } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('auth.otp.resend') }));
    expect(await screen.findByText(t('auth.otp.resent'))).toBeDefined();
    expect(resend).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerAccessScreen', () => {
  it('redeems a well-formed guardian code, uppercased', async () => {
    const redeem = vi.fn(() => Promise.resolve());
    renderScreen(<PlayerAccessScreen redeem={redeem} onUseEmail={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(t('auth.playerAccess.label')), {
      target: { value: 'k7qm-2xpa' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));
    await waitFor(() => {
      expect(redeem).toHaveBeenCalledWith('K7QM-2XPA');
    });
  });

  it('rejects a malformed code and explains a used one', async () => {
    const redeem = vi.fn(() => Promise.reject(apiError('conflict', 409)));
    renderScreen(<PlayerAccessScreen redeem={redeem} onUseEmail={vi.fn()} />);
    const input = screen.getByLabelText(t('auth.playerAccess.label'));
    fireEvent.change(input, { target: { value: 'K7Q' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));
    expect(screen.getByRole('alert').textContent).toContain(t('auth.playerAccess.invalidFormat'));
    expect(redeem).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'K7QM2XPA' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn') }));
    expect(await screen.findByText(t('auth.playerAccess.unavailable'))).toBeDefined();
  });
});
