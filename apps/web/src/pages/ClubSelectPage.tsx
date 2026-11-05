import type { MembershipSummary } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { clubThemeQuery, meQuery, membershipsQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { StandaloneLayout } from '../layout/RootLayout';
import { useSignOut } from '../session/use-sign-out';
import { Button, ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { Icon } from '../ui/icons';

const route = getRouteApi('/_authed/clubs');

/**
 * Club selector (ADR 0007): the user's memberships; the chosen one travels
 * in `X-Membership-Id` from then on. A superadmin also gets the way into
 * support mode.
 */
export function ClubSelectPage() {
  const t = useT();
  const { api, queryClient, selection } = useServices();
  const search = route.useSearch();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const memberships = useQuery(membershipsQuery(api));
  const me = useQuery(meQuery(api, selection.get()));

  const choose = async (membership: MembershipSummary) => {
    selection.select({ kind: 'membership', membershipId: membership.id });
    queryClient.removeQueries({ queryKey: ['club'] });
    await navigate({ href: search.redirect ?? '/' });
  };

  return (
    <StandaloneLayout>
      <Page title={t('club.select.title')}>
        {search.unavailable === true ? (
          <Notice level="warning" role="status">
            <p>{t('club.select.unavailable')}</p>
          </Notice>
        ) : null}
        {memberships.isPending ? <Loading /> : null}
        {memberships.isError ? (
          <ErrorNotice
            error={memberships.error}
            action={
              <Button variant="secondary" onClick={() => void memberships.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : null}
        {memberships.data === undefined ? null : memberships.data.items.length === 0 ? (
          <Notice level="info">
            <p>{t('club.select.none')}</p>
          </Notice>
        ) : (
          <>
            {memberships.data.items.length > 1 ? <p>{t('club.select.subtitle')}</p> : null}
            <ul className="sp-choice-list">
              {memberships.data.items.map((membership) => (
                <li key={membership.id}>
                  <button
                    type="button"
                    className="sp-choice"
                    aria-label={t('club.select.asRole', {
                      clubName: membership.club.name,
                      role: t(`role.${membership.role}`),
                    })}
                    onClick={() => void choose(membership)}
                  >
                    <ClubCrest slug={membership.club.slug} />
                    <span className="sp-choice__text">
                      <span className="sp-choice__title">{membership.club.name}</span>
                      <span className="sp-choice__meta">{t(`role.${membership.role}`)}</span>
                    </span>
                    <Icon name="chevronRight" className="sp-choice__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sp-form__secondary">
          {me.data?.user.isSuperadmin === true ? (
            <Link to="/console" className="sp-button sp-button--secondary">
              <Icon name="club" />
              <span>{t('console.start')}</span>
            </Link>
          ) : null}
          {me.data?.user.isSuperadmin === true ? (
            <Link
              to="/support"
              search={search.redirect === undefined ? {} : { redirect: search.redirect }}
              className="sp-button sp-button--secondary"
            >
              <Icon name="support" />
              <span>{t('support.start')}</span>
            </Link>
          ) : null}
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
        {signOut.isError ? <ErrorNotice error={signOut.error} /> : null}
      </Page>
    </StandaloneLayout>
  );
}

/**
 * The crest of a club in the list, from its public theme (the same read the
 * shell does once a club is picked); the short name while it loads or when the
 * club has none. Decorative: the button is named by the club and the role.
 */
function ClubCrest(props: { slug: string }) {
  const { api } = useServices();
  const theme = useQuery(clubThemeQuery(api, props.slug));
  const logoUrl = theme.data?.logoUrl ?? null;
  if (logoUrl === null) {
    return (
      <span className="sp-club-mark sp-club-mark--monogram" aria-hidden="true">
        {theme.data?.shortName ?? ''}
      </span>
    );
  }
  return <img className="sp-club-mark" src={logoUrl} alt="" width={44} height={44} />;
}
