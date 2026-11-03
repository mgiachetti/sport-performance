import { ApiError } from '@sport-performance/contracts';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useT } from '../i18n/i18n';
import { StandaloneLayout } from '../layout/RootLayout';
import { Button, ErrorNotice, Page } from '../ui/components';

export function NotFoundPage() {
  const t = useT();
  return (
    <StandaloneLayout>
      <Page title={t('error.pageNotFound.title')} subtitle={t('error.pageNotFound.body')}>
        <Link to="/" className="sp-button sp-button--primary">
          {t('nav.goHome')}
        </Link>
      </Page>
    </StandaloneLayout>
  );
}

/**
 * Error boundary of the routes: the error envelope, with retry (resets the
 * failed queries and reloads the route). A `403` is "no tenés permiso".
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const t = useT();
  const router = useRouter();
  const queryReset = useQueryErrorResetBoundary();
  useEffect(() => {
    queryReset.reset();
  }, [queryReset]);
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <StandaloneLayout>
      <Page title={forbidden ? t('error.forbidden') : t('error.title')}>
        <ErrorNotice
          error={error}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              {t('common.retry')}
            </Button>
          }
        />
        <Link to="/" className="sp-button sp-button--ghost">
          {t('nav.goHome')}
        </Link>
      </Page>
    </StandaloneLayout>
  );
}
