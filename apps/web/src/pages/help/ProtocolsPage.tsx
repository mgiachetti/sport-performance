import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useScope } from '../../club/use-scope';
import { useT } from '../../i18n/i18n';
import { ErrorNotice, Loading, Notice, Page } from '../../ui/components';
import { HelpTabs } from './HelpTabs';
import { testLabel, validityLabel } from './format';
import { testDefinitionsQuery } from './queries';

/**
 * Protocols of the club's tests in force today (B-415), for the sport the
 * user is looking at: what each test measures and how, before a test day.
 */
export function ProtocolsPage() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const scope = useScope();
  const definitions = useQuery(testDefinitionsQuery(api, selection, scope.sport));

  return (
    <Page title={t('help.title')} subtitle={t('help.subtitle')}>
      <HelpTabs current="protocols" />
      <p className="sp-lead-muted">{t('help.protocols.intro')}</p>
      {scope.sport === null || scope.sports.length <= 1 ? null : (
        <p className="sp-meta">
          {t('help.protocols.sportFilter', { sport: t(`sport.${scope.sport}`) })}
        </p>
      )}
      {definitions.isPending ? <Loading /> : null}
      {definitions.isError ? <ErrorNotice error={definitions.error} /> : null}
      {definitions.data?.length === 0 ? (
        <Notice level="info">
          <p>{t('protocol.empty')}</p>
        </Notice>
      ) : null}
      {definitions.data === undefined || definitions.data.length === 0 ? null : (
        <ul className="sp-protocol-list">
          {definitions.data.map((definition) => {
            const name = testLabel(t, definition.code);
            return (
              <li key={definition.id} className="sp-card sp-protocol-list__item">
                <h2 className="sp-card__title">
                  <Link
                    to="/help/protocols/$testDefinitionId"
                    params={{ testDefinitionId: definition.id }}
                    aria-label={t('protocol.open', { test: name })}
                    className="sp-protocol-list__link"
                  >
                    {name}
                  </Link>
                </h2>
                <p className="sp-protocol-list__meta">
                  {t('protocol.version', { version: definition.version })} ·{' '}
                  {validityLabel(t, definition)} ·{' '}
                  {t('protocol.attempts', {
                    count: definition.attemptCount,
                    aggregation: definition.attemptAggregation,
                  })}
                </p>
                {definition.protocol.summary === null ? null : <p>{definition.protocol.summary}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
