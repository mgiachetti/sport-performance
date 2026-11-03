import { useActiveClub, ASSIGNED_ROLES } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { Page } from '../ui/components';

/**
 * Home of the club: who you are here and what you see. The weekly panel
 * (#66) and the other screens hang from the navigation.
 */
export function HomePage() {
  const t = useT();
  const active = useActiveClub();
  const scope = useScope();
  const name = active.user.name.trim();
  const scopedByAssignments = ASSIGNED_ROLES.includes(active.role);
  const selected = [
    scope.sport === null || scope.sports.length <= 1 ? null : t(`sport.${scope.sport}`),
    scope.category?.name ?? null,
  ].filter((part): part is string => part !== null);

  return (
    <Page
      title={t('home.title')}
      subtitle={t('home.role', { clubName: active.club.name, role: t(`role.${active.role}`) })}
    >
      <p className="sp-lead">
        {name === '' ? t('home.greetingAnonymous') : t('home.greeting', { name })}
      </p>
      <section className="sp-card" aria-labelledby="home-scope">
        <h2 id="home-scope" className="sp-card__title">
          {t('home.scope.title')}
        </h2>
        <p>
          {scopedByAssignments
            ? t('home.scope.assigned', { count: active.categories.length })
            : t('home.scope.club')}
        </p>
        {selected.length === 0 ? null : (
          <p>{t('home.scope.selected', { scope: selected.join(' · ') })}</p>
        )}
        {scope.categoryOptions.length === 0 ? null : (
          <ul className="sp-tag-list">
            {scope.categoryOptions.map((category) => (
              <li key={category.id} className="sp-tag">
                {category.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
