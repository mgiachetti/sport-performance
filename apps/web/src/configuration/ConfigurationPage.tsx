import { SEXES, type Sex, type Sport } from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { RequirePermission, useCan } from '../permissions/permissions';
import { ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { SelectField } from '../ui/fields';
import { AlertRulesSection } from './AlertRulesSection';
import { BatterySection } from './BatterySection';
import { ReferencesSection } from './ReferencesSection';
import { SpeedZonesSection } from './SpeedZonesSection';
import { clubBranchesQuery } from './queries';
import { CONFIGURATION_SECTIONS, type ConfigurationSection } from './search';
import './configuration.css';

const route = getRouteApi('/_authed/_club/configuration');

const SECTION_LABELS: Record<ConfigurationSection, MessageKey> = {
  battery: 'configuration.section.battery',
  'speed-zones': 'configuration.section.speedZones',
  'alert-rules': 'configuration.section.alertRules',
  references: 'configuration.section.references',
};

/**
 * Configuration of the club (B-409, ADR 0062): the test battery as a test ×
 * stage matrix, the speed zones, the alert rules and the first-team
 * references. The staff reads it; `sc` and the administration change it.
 */
export function ConfigurationPage() {
  const t = useT();
  return (
    <Page title={t('configuration.title')} subtitle={t('configuration.subtitle')}>
      <RequirePermission kind="configuration" action="read">
        <ConfigurationContent />
      </RequirePermission>
    </Page>
  );
}

/**
 * Branches (sexes) of the sport the club runs, from the club's branches and
 * not from the categories the role sees: the configuration is the club's,
 * and a sport-wide entry reaches every branch.
 */
function sexesOf(branches: readonly { sport: Sport; sex: Sex }[], sport: Sport): Sex[] {
  const present = new Set(branches.filter((b) => b.sport === sport).map((b) => b.sex));
  return SEXES.filter((sex) => present.has(sex));
}

function ConfigurationContent() {
  const t = useT();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const scope = useScope();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const canEdit = useCan('configuration', 'update');
  const section = search.section ?? 'battery';

  const sport = scope.sport;
  const branches = useQuery({ ...clubBranchesQuery(api, selection), enabled: sport !== null });
  const sexes = sport === null ? [] : sexesOf(branches.data ?? [], sport);
  // A category pins the branch; else the URL, else a branch of the user's categories.
  // The first branch the user works with (their categories) comes before the rest.
  const mine = sexes.find((candidate) =>
    scope.categoryOptions.some((category) => category.sex === candidate),
  );
  const sex: Sex | null =
    scope.category?.sex ??
    (search.sex !== undefined && sexes.includes(search.sex)
      ? search.sex
      : (mine ?? sexes[0] ?? null));

  const tabs = (
    <nav aria-label={t('configuration.sections')} className="sp-tabs">
      <ul>
        {CONFIGURATION_SECTIONS.map((candidate) => (
          <li key={candidate}>
            <Link
              to="/configuration"
              search={(prev) => ({ ...prev, section: candidate })}
              className="sp-tabs__link"
              aria-current={candidate === section ? 'page' : undefined}
            >
              {t(SECTION_LABELS[candidate])}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  // Alert rules are for the whole club; the rest is by sport and branch.
  const needsGroup = section !== 'alert-rules';

  return (
    <>
      {tabs}
      {canEdit ? null : (
        <Notice level="info">
          <p>{t('configuration.readOnly')}</p>
        </Notice>
      )}
      {needsGroup && sport !== null && sexes.length > 1 && scope.category === null ? (
        <div className="sp-form__row sp-config__group">
          <SelectField
            label={t('configuration.sex.label')}
            value={sex ?? ''}
            options={sexes.map((value) => ({ value, label: t(`sex.${value}`) }))}
            onChange={(event) => {
              const value = event.currentTarget.value as Sex;
              void navigate({ search: (prev) => ({ ...prev, sex: value }) });
            }}
          />
        </div>
      ) : null}
      {!needsGroup ? (
        <AlertRulesSection canEdit={canEdit} />
      ) : sport !== null && branches.error !== null ? (
        <ErrorNotice error={branches.error} />
      ) : sport !== null && branches.data === undefined ? (
        <Loading />
      ) : sport === null || sex === null ? (
        <Notice level="info">
          <p>{t('configuration.pickSport')}</p>
        </Notice>
      ) : section === 'battery' ? (
        <BatterySection
          sport={sport}
          sex={sex}
          branches={sexes}
          category={scope.category}
          canEdit={canEdit}
        />
      ) : section === 'speed-zones' ? (
        <SpeedZonesSection sport={sport} sex={sex} canEdit={canEdit} />
      ) : (
        <ReferencesSection sport={sport} sex={sex} canEdit={canEdit} />
      )}
    </>
  );
}
