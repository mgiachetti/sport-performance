import type { Role } from '@sport-performance/domain';
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/i18n';
import { StandaloneLayout } from '../layout/RootLayout';
import { useSignOut } from '../session/use-sign-out';
import { Button, ErrorNotice, Notice, Page } from '../ui/components';

/**
 * A player or guardian membership in the staff web: no club data is loaded
 * for them; they are sent to the app (CLAUDE.md, roles).
 */
export function StaffOnlyPage(props: { clubName: string; role: Role }) {
  const t = useT();
  const signOut = useSignOut();
  return (
    <StandaloneLayout>
      <Page title={t('club.staffOnly.title')}>
        <Notice level="info">
          <p>
            {t('club.staffOnly.body', { clubName: props.clubName, role: t(`role.${props.role}`) })}
          </p>
        </Notice>
        <div className="sp-form__secondary">
          <Link to="/clubs" className="sp-button sp-button--secondary">
            {t('club.switch')}
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              signOut.mutate();
            }}
            disabled={signOut.isPending}
          >
            {t('auth.signOut')}
          </Button>
        </div>
        {signOut.isError ? <ErrorNotice error={signOut.error} /> : null}
      </Page>
    </StandaloneLayout>
  );
}
