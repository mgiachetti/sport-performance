import type { Child } from '@sport-performance/contracts';
import { formatLocalDate } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { ageOn, clubToday, fullName, guardianSeesData } from './child';
import { ConsentsSection } from './ConsentsSection';
import { ParentHeightsSection } from './ParentHeightsSection';
import { childConsentsQuery, childPlayerQuery } from './queries';

const route = getRouteApi('/_authed/_club/family/$playerId');

/**
 * Summarised profile of one child (B-413, ADR 0065): the roster data, the
 * consents and the parents' heights. Only children of the guardian's list
 * are asked for; never health data, availability causes or rankings.
 */
export function ChildPage() {
  const t = useT();
  const { playerId } = route.useParams();
  const active = useActiveClub();
  const child = active.children.find((candidate) => candidate.playerId === playerId);

  const back = (
    <Link to="/family" className="sp-button sp-button--ghost">
      {t('guardian.child.back')}
    </Link>
  );

  if (child === undefined) {
    return (
      <Page title={t('guardian.children.title')} actions={back}>
        <Notice level="warning" role="alert">
          <p>{t('guardian.child.notFound')}</p>
        </Notice>
      </Page>
    );
  }
  if (!guardianSeesData(child)) {
    return (
      <Page title={fullName(child)} actions={back}>
        <Notice level="info">
          <p>
            <strong>{t('guardian.child.adultHiddenTitle')}</strong>
          </p>
          <p>{t('guardian.children.adultHidden')}</p>
        </Notice>
      </Page>
    );
  }
  return <VisibleChild child={child} back={back} />;
}

function VisibleChild(props: { child: Child; back: ReactNode }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { child } = props;
  const player = useQuery(childPlayerQuery(api, active.selection, child.playerId));
  const consents = useQuery(childConsentsQuery(api, active.selection, child.playerId));
  const today = clubToday(active.club.timeZone);
  const name = fullName(child);

  return (
    <Page
      title={name}
      subtitle={t('guardian.relationship.label', {
        relationship: t(`guardian.relationship.${child.relationship}`),
      })}
      actions={props.back}
    >
      {child.ofAge ? (
        <Notice level="info">
          <p>{t('guardian.child.readOnly')}</p>
        </Notice>
      ) : null}

      <section className="sp-card" aria-labelledby="child-summary">
        <h2 id="child-summary" className="sp-card__title">
          {t('guardian.summary.title')}
        </h2>
        <dl className="sp-facts">
          <div>
            <dt>{t('guardian.summary.birthDate')}</dt>
            <dd>{formatLocalDate(child.birthDate)}</dd>
          </div>
          <div>
            <dt>{t('guardian.summary.age')}</dt>
            <dd>{t('guardian.children.age', { age: ageOn(child, today) })}</dd>
          </div>
          {player.data === undefined ? null : (
            <div>
              <dt>{t('guardian.summary.sport')}</dt>
              <dd>{t(`sport.${player.data.sport}`)}</dd>
            </div>
          )}
          <div>
            <dt>{t('guardian.summary.categories')}</dt>
            <dd>
              {child.categories.length === 0
                ? t('guardian.children.noCategory')
                : child.categories.map((category) => category.name).join(', ')}
            </dd>
          </div>
          {player.data === undefined ? null : (
            <div>
              <dt>{t('guardian.summary.joinedOn')}</dt>
              <dd>{formatLocalDate(player.data.joinedOn)}</dd>
            </div>
          )}
          <div>
            <dt>{t('guardian.summary.account')}</dt>
            <dd>
              {child.hasAccount
                ? t('guardian.summary.accountYes')
                : t('guardian.summary.accountNo')}
            </dd>
          </div>
        </dl>
        {player.isPending ? <Loading /> : null}
        {player.isError ? <ErrorNotice error={player.error} /> : null}
        <p className="sp-meta">{t('guardian.summary.notMedical')}</p>
      </section>

      <ConsentsSection child={child} consents={consents} />

      {player.data === undefined ? null : (
        <ParentHeightsSection child={child} player={player.data} consents={consents.data} />
      )}
    </Page>
  );
}
