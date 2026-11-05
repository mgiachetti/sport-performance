import { Link } from '@tanstack/react-router';
import { useActiveClub, ASSIGNED_ROLES } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { NAV_ITEMS, visibleNavItems } from '../layout/navigation';
import { Card, Page } from '../ui/components';
import { Icon } from '../ui/icons';

/**
 * Home of the club: who you are here, what you see and the sections your
 * role can open (the same entries as the navigation, gated by the matrix).
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
  const shortcuts = visibleNavItems(NAV_ITEMS, active.subject, active.categories).filter(
    (item) => item.to !== '/',
  );

  return (
    <Page
      title={t('home.title')}
      subtitle={t('home.role', { clubName: active.club.name, role: t(`role.${active.role}`) })}
    >
      <p className="sp-lead">
        {name === '' ? t('home.greetingAnonymous') : t('home.greeting', { name })}
      </p>
      <div className="sp-home-grid">
        <Card title={t('home.scope.title')} className="sp-home-scope">
          <div className="sp-home-scope__body">
            <div>
              <p>
                {scopedByAssignments
                  ? t('home.scope.assigned', { count: active.categories.length })
                  : t('home.scope.club')}
              </p>
              {selected.length === 0 ? null : (
                <p className="sp-card__subtitle-text">
                  {t('home.scope.selected', { scope: selected.join(' · ') })}
                </p>
              )}
            </div>
            {scope.categoryOptions.length === 0 ? null : (
              <ul className="sp-tag-list">
                {scope.categoryOptions.map((category) => (
                  <li key={category.id} className="sp-tag">
                    {category.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        {shortcuts.length === 0 ? null : (
          <Card
            title={t('home.shortcuts.title')}
            subtitle={t('home.shortcuts.subtitle')}
            className="sp-home-shortcuts"
          >
            <ul className="sp-shortcut-list">
              {shortcuts.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="sp-shortcut">
                    <span className="sp-shortcut__icon" aria-hidden="true">
                      <Icon name={item.icon} size={20} />
                    </span>
                    {/* "Abrir …": the sidebar has a link with the bare section name. */}
                    <span className="sp-visually-hidden">{t('home.shortcuts.open')} </span>
                    <span className="sp-shortcut__label">{t(item.labelKey)}</span>
                    <Icon name="chevronRight" className="sp-shortcut__chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
