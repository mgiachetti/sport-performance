import type { CategoryId, Sport } from '@sport-performance/domain';
import { getRouteApi } from '@tanstack/react-router';
import { useId } from 'react';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';

const route = getRouteApi('/_authed/_club');

/**
 * Sport and category of the layout. Native selects (keyboard and screen
 * readers for free); the choice goes to the URL search params, which every
 * screen of the club keeps (`retainSearchParams`).
 */
export function ScopeSelector() {
  const t = useT();
  const scope = useScope();
  const navigate = route.useNavigate();
  const search = route.useSearch();
  const sportId = useId();
  const categoryId = useId();

  if (scope.sports.length === 0) {
    return <p className="sp-scope sp-scope--empty">{t('scope.none')}</p>;
  }

  const setSport = (value: string) => {
    // Explicit `undefined`s: the layout retains sport and category otherwise.
    void navigate({
      search: () => ({ sport: value === '' ? undefined : (value as Sport), category: undefined }),
    });
  };
  const setCategory = (value: string) => {
    void navigate({
      search: () => ({
        sport: search.sport,
        category: value === '' ? undefined : (value as CategoryId),
      }),
    });
  };

  return (
    <fieldset className="sp-scope">
      <legend className="sp-visually-hidden">{t('scope.label')}</legend>
      {scope.sports.length > 1 ? (
        <div className="sp-scope__field">
          <label htmlFor={sportId}>{t('scope.sport.label')}</label>
          <select
            id={sportId}
            value={scope.sport ?? ''}
            onChange={(event) => {
              setSport(event.target.value);
            }}
          >
            <option value="">{t('scope.sport.all')}</option>
            {scope.sports.map((sport) => (
              <option key={sport} value={sport}>
                {t(`sport.${sport}`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="sp-scope__field">
        <label htmlFor={categoryId}>{t('scope.category.label')}</label>
        <select
          id={categoryId}
          value={scope.category?.id ?? ''}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        >
          <option value="">{t('scope.category.all')}</option>
          {scope.categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {scope.sport === null
                ? `${category.name} · ${t(`sport.${category.sport}`)}`
                : category.name}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
