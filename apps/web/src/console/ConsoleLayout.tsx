import { Link, Outlet } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { SUPPORT_REASON_MAX_LENGTH } from '../api/club-selection';
import { useServices, useStore } from '../app/services';
import { useT } from '../i18n/i18n';
import { useSignOut } from '../session/use-sign-out';
import { Button, Card, ErrorNotice, Notice, Page, Stripes, TextField } from '../ui/components';
import { Icon } from '../ui/icons';

/**
 * The console's client and the reason of this session. Only inside the
 * console layout, which renders its screens once there is a reason.
 */
export function useConsole() {
  const { consoleApi, consoleReason } = useServices();
  const reason = useStore(consoleReason);
  if (reason === null) throw new Error('useConsole outside the console with a reason');
  return { api: consoleApi, reason };
}

/**
 * Frame of the superadmin console (B-414, ADR 0066), outside any club: the
 * console's own navigation and, before anything is asked of the API, the
 * reason of the session. The reason travels in `X-Support-Reason` on every
 * request and the API records it with the operator (ADR 0029).
 */
export function ConsoleLayout() {
  const t = useT();
  const { consoleReason } = useServices();
  const reason = useStore(consoleReason);
  const signOut = useSignOut();

  return (
    <div className="sp-console">
      <a href="#main" className="sp-skip-link">
        {t('layout.skipToContent')}
      </a>
      <Stripes size="sm" />
      <header className="sp-console__header">
        <p className="sp-console__brand">
          <span className="sp-club-mark sp-club-mark--monogram" aria-hidden="true">
            {t('standalone.productMark')}
          </span>
          <span>{t('console.title')}</span>
        </p>
        {reason === null ? null : (
          <nav aria-label={t('console.nav.label')} className="sp-console__nav">
            <ul>
              <li>
                <Link
                  to="/console/clubs"
                  className="sp-nav__link"
                  activeProps={{ 'aria-current': 'page', className: 'is-active' }}
                >
                  <Icon name="club" />
                  <span>{t('console.nav.clubs')}</span>
                </Link>
              </li>
              <li>
                <Link
                  to="/console/support-access"
                  className="sp-nav__link"
                  activeProps={{ 'aria-current': 'page', className: 'is-active' }}
                >
                  <Icon name="info" />
                  <span>{t('console.nav.supportAccess')}</span>
                </Link>
              </li>
            </ul>
          </nav>
        )}
        <div className="sp-console__account">
          <Link to="/clubs" className="sp-button sp-button--ghost">
            {t('console.exit')}
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              signOut.mutate();
            }}
            disabled={signOut.isPending}
          >
            <Icon name="signOut" />
            <span>{t('auth.signOut')}</span>
          </Button>
        </div>
      </header>
      <main id="main" className="sp-console__main">
        {signOut.isError ? <ErrorNotice error={signOut.error} /> : null}
        {reason === null ? (
          <ConsoleReasonForm />
        ) : (
          <>
            <Notice
              level="info"
              role="status"
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    consoleReason.clear();
                  }}
                >
                  {t('console.reason.change')}
                </Button>
              }
            >
              <p>{t('console.reason.current', { reason })}</p>
            </Notice>
            <Outlet />
          </>
        )}
      </main>
    </div>
  );
}

function ConsoleReasonForm() {
  const t = useT();
  const { consoleReason } = useServices();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consoleReason.start(reason)) setError(t('console.reason.required'));
  };
  return (
    <Page title={t('console.title')} subtitle={t('console.reason.intro')}>
      <Card className="sp-console__reason">
        <form className="sp-form" onSubmit={start} noValidate>
          <TextField
            label={t('console.reason.label')}
            help={t('console.reason.help')}
            name="reason"
            required
            maxLength={SUPPORT_REASON_MAX_LENGTH}
            value={reason}
            error={error}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <div className="sp-form__actions">
            <Button type="submit">{t('console.reason.submit')}</Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
