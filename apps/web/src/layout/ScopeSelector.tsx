import type { CategoryId, Sport } from '@sport-performance/domain';
import { getRouteApi } from '@tanstack/react-router';
import { useId } from 'react';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { SegmentedControl } from '../ui/components';

const route = getRouteApi('/_authed/_club');

/** Up to this many categories (plus "all") the scope is a row of pills; more, a select. */
export const SEGMENTED_MAX_CATEGORIES = 5;

/** `''` is "all" in both controls (an empty search param). */
const ALL = '';

/**
 * Sport and category of the layout (ADR 0097): a segmented control when the
 * options are few (the usual coach with two or three categories), a native
 * select when they are many. The choice goes to the URL search params, which
 * every screen of the club keeps (`retainSearchParams`).
 */
export function ScopeSelector() {
  const t = useT();
  const scope = useScope();
  const navigate = route.useNavigate();
  const search = route.useSearch();
  const categoryId = useId();

  if (scope.sports.length === 0) {
    return <p className="sp-scope sp-scope--empty">{t('scope.none')}</p>;
  }

  const setSport = (value: string) => {
    // Explicit `undefined`s: the layout retains sport and category otherwise.
    void navigate({
      search: () => ({ sport: value === ALL ? undefined : (value as Sport), category: undefined }),
    });
  };
  const setCategory = (value: string) => {
    void navigate({
      search: () => ({
        sport: search.sport,
        category: value === ALL ? undefined : (value as CategoryId),
      }),
    });
  };

  const categoryLabel = (category: (typeof scope.categoryOptions)[number]) =>
    scope.sport === null && scope.sports.length > 1
      ? `${category.name} · ${t(`sport.${category.sport}`)}`
      : category.name;
  const categoryOptions = [
    { value: ALL, label: t('scope.category.all') },
    ...scope.categoryOptions.map((category) => ({
      value: category.id,
      label: categoryLabel(category),
    })),
  ];
  // Pills only when they stay short: few categories, of one sport.
  const segmented =
    scope.categoryOptions.length <= SEGMENTED_MAX_CATEGORIES &&
    (scope.sport !== null || scope.sports.length === 1);

  return (
    <div className="sp-scope" role="group" aria-label={t('scope.label')}>
      {scope.sports.length > 1 ? (
        <SegmentedControl
          label={t('scope.sport.label')}
          hideLabel
          size="sm"
          options={[
            { value: ALL, label: t('scope.sport.all') },
            ...scope.sports.map((sport) => ({ value: sport, label: t(`sport.${sport}`) })),
          ]}
          value={scope.sport ?? ALL}
          onChange={setSport}
        />
      ) : null}
      {segmented ? (
        <SegmentedControl
          label={t('scope.category.label')}
          hideLabel
          size="sm"
          options={categoryOptions}
          value={scope.category?.id ?? ALL}
          onChange={setCategory}
        />
      ) : (
        <div className="sp-scope__field">
          <label htmlFor={categoryId} className="sp-visually-hidden">
            {t('scope.category.label')}
          </label>
          <select
            id={categoryId}
            className="sp-select sp-select--sm"
            value={scope.category?.id ?? ALL}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
