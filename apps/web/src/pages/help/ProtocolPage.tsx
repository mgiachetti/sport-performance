import type { TestDefinitionDto } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import { describeError } from '../../api/errors';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useT } from '../../i18n/i18n';
import { useCan } from '../../permissions/permissions';
import { ErrorNotice, Loading, Notice, Page } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { ProtocolMediaSection } from './ProtocolMedia';
import { restLabel, testLabel, unitLabel, validityLabel } from './format';
import { testDefinitionQuery } from './queries';

const route = getRouteApi('/_authed/_club/help/protocols/$testDefinitionId');

/**
 * One protocol version (B-415): summary, numbered steps, attempts and which
 * one counts, rest, equipment, the metrics it records and, for the staff,
 * its images and videos.
 */
export function ProtocolPage() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const { testDefinitionId } = route.useParams();
  const definition = useQuery(testDefinitionQuery(api, selection, testDefinitionId));
  const seesMedia = useCan('configuration', 'read');

  const back = (
    <Link to="/help" className="sp-back-link">
      {t('protocol.back')}
    </Link>
  );

  if (definition.isPending) {
    return (
      <Page title={t('help.title')}>
        {back}
        <Loading />
      </Page>
    );
  }
  if (definition.isError) {
    const notFound = describeError(definition.error).code === 'not_found';
    return (
      <Page title={t('help.title')}>
        {back}
        {notFound ? (
          <Notice level="warning" role="alert">
            <p>{t('protocol.notFound')}</p>
          </Notice>
        ) : (
          <ErrorNotice error={definition.error} />
        )}
      </Page>
    );
  }

  const data = definition.data;
  const name = testLabel(t, data.code);
  return (
    <Page
      title={name}
      subtitle={`${t('protocol.version', { version: data.version })} · ${validityLabel(t, data)}`}
    >
      {back}
      <ProtocolDetails definition={data} />
      {seesMedia ? <ProtocolMediaSection definition={data} /> : null}
    </Page>
  );
}

function ProtocolDetails({ definition }: { definition: TestDefinitionDto }) {
  const t = useT();
  const { protocol } = definition;
  const sports =
    definition.sports === null
      ? t('protocol.allSports')
      : definition.sports.map((sport) => t(`sport.${sport}`)).join(', ');
  return (
    <>
      <section className="sp-card" aria-labelledby="protocol-summary">
        <h2 id="protocol-summary" className="sp-card__title">
          {t('protocol.summary')}
        </h2>
        {protocol.summary === null ? null : <p>{protocol.summary}</p>}
        <ul className="sp-tag-list">
          <li className="sp-tag">{sports}</li>
          <li className="sp-tag">
            {t('protocol.attempts', {
              count: definition.attemptCount,
              aggregation: definition.attemptAggregation,
            })}
          </li>
          {protocol.restBetweenAttemptsS === null ? null : (
            <li className="sp-tag">{restLabel(t, protocol.restBetweenAttemptsS)}</li>
          )}
        </ul>
        {definition.maximalLoad ? (
          <Notice level="warning">
            <p>{t('protocol.maximalLoad')}</p>
          </Notice>
        ) : null}
      </section>

      <section className="sp-card" aria-labelledby="protocol-steps">
        <h2 id="protocol-steps" className="sp-card__title">
          {t('protocol.steps')}
        </h2>
        {protocol.steps.length === 0 ? (
          <p>{t('protocol.noSteps')}</p>
        ) : (
          <ol className="sp-steps">
            {protocol.steps.map((step, index) => (
              <li key={`${String(index)}-${step}`}>{step}</li>
            ))}
          </ol>
        )}
        <Notice level="info">
          <p>{t('protocol.recordHow')}</p>
        </Notice>
      </section>

      {protocol.equipment.length === 0 ? null : (
        <section className="sp-card" aria-labelledby="protocol-equipment">
          <h2 id="protocol-equipment" className="sp-card__title">
            {t('protocol.equipment')}
          </h2>
          <ul>
            {protocol.equipment.map((item, index) => (
              <li key={`${String(index)}-${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {definition.metrics.length === 0 ? null : (
        <section className="sp-card" aria-labelledby="protocol-metrics">
          <h2 id="protocol-metrics" className="sp-card__title">
            {t('protocol.metrics')}
          </h2>
          <ul className="sp-metric-list">
            {definition.metrics.map((metric) => {
              const unit = unitLabel(metric.unit);
              return (
                <li key={metric.code}>
                  <code>{metric.code}</code>
                  {unit === '' ? null : <span> ({unit})</span>}
                  {metric.isDerived ? (
                    <span className="sp-metric-list__derived">
                      {' '}
                      <Icon name="sync" /> {t('protocol.metricDerived')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
