import type { Child } from '@sport-performance/contracts';
import { Link } from '@tanstack/react-router';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Notice, Page } from '../ui/components';
import { Icon } from '../ui/icons';
import { ageOn, clubToday, fullName, guardianSeesData } from './child';

/**
 * "Mis hijos/as" (B-413, ADR 0065): the guardian's children in the club,
 * from the list the layout already loaded. A child of age who did not keep
 * the guardian's access shows only the name and why.
 */
export function ChildrenPage() {
  const t = useT();
  const active = useActiveClub();
  const today = clubToday(active.club.timeZone);

  return (
    <Page
      title={t('guardian.children.title')}
      subtitle={t('guardian.children.subtitle', { clubName: active.club.name })}
    >
      <p>{t('guardian.children.intro')}</p>
      {active.children.length === 0 ? (
        <Notice level="info">
          <p>{t('guardian.children.none')}</p>
        </Notice>
      ) : (
        <ul className="sp-child-list">
          {active.children.map((child) => (
            <li key={child.guardianId}>
              <ChildCard child={child} age={ageOn(child, today)} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function ChildCard(props: { child: Child; age: number }) {
  const t = useT();
  const { child } = props;
  const name = fullName(child);
  const relationship = t('guardian.relationship.label', {
    relationship: t(`guardian.relationship.${child.relationship}`),
  });

  if (!guardianSeesData(child)) {
    return (
      <article className="sp-card sp-child-card" aria-label={name}>
        <h2 className="sp-card__title">{name}</h2>
        <p className="sp-child-card__meta">{relationship}</p>
        <Notice level="info">
          <p>{t('guardian.children.adultHidden')}</p>
        </Notice>
      </article>
    );
  }

  return (
    <article className="sp-card sp-child-card" aria-label={name}>
      <h2 className="sp-card__title">
        <Link
          to="/family/$playerId"
          params={{ playerId: child.playerId }}
          className="sp-child-card__link"
          aria-label={t('guardian.children.open', { name })}
        >
          {name}
        </Link>
      </h2>
      <p className="sp-child-card__meta">
        {t('guardian.children.age', { age: props.age })} · {relationship}
      </p>
      {child.categories.length === 0 ? (
        <p className="sp-child-card__meta">{t('guardian.children.noCategory')}</p>
      ) : (
        <ul className="sp-tag-list">
          {child.categories.map((category) => (
            <li key={category.id} className="sp-tag">
              {category.name} · {t(`sport.${category.sport}`)}
            </li>
          ))}
        </ul>
      )}
      <p className="sp-child-card__meta">
        <Icon name={child.hasAccount ? 'ok' : 'info'} />{' '}
        {child.hasAccount ? t('guardian.children.hasAccount') : t('guardian.children.noAccount')}
      </p>
      {child.ofAge ? (
        <p className="sp-child-card__meta">{t('guardian.children.adultShared')}</p>
      ) : null}
    </article>
  );
}
