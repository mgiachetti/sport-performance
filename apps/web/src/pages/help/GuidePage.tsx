import type { MessageKey } from '@sport-performance/i18n';
import { useT } from '../../i18n/i18n';
import { Notice, Page } from '../../ui/components';
import { HelpTabs } from './HelpTabs';

/** Sections of the usage guide, in reading order. */
const GUIDE_SECTIONS = [
  { id: 'roles', title: 'help.guide.roles.title', body: 'help.guide.roles.body' },
  { id: 'wellness', title: 'help.guide.wellness.title', body: 'help.guide.wellness.body' },
  { id: 'load', title: 'help.guide.load.title', body: 'help.guide.load.body' },
  { id: 'tests', title: 'help.guide.tests.title', body: 'help.guide.tests.body' },
  { id: 'maturation', title: 'help.guide.maturation.title', body: 'help.guide.maturation.body' },
  { id: 'alerts', title: 'help.guide.alerts.title', body: 'help.guide.alerts.body' },
  { id: 'privacy', title: 'help.guide.privacy.title', body: 'help.guide.privacy.body' },
] as const satisfies readonly { id: string; title: MessageKey; body: MessageKey }[];

/**
 * Usage guide for the staff (B-415): what each one sees, wellness and RPE,
 * load, test days, maturation, alerts and privacy, in the product's terms.
 */
export function GuidePage() {
  const t = useT();
  return (
    <Page title={t('help.title')} subtitle={t('help.subtitle')}>
      <HelpTabs current="guide" />
      <p className="sp-lead-muted">{t('help.guide.intro')}</p>
      <nav aria-label={t('help.tab.guide')}>
        <ul className="sp-tag-list">
          {GUIDE_SECTIONS.map((section) => (
            <li key={section.id}>
              <a className="sp-tag" href={`#guide-${section.id}`}>
                {t(section.title)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sp-guide-grid">
        {GUIDE_SECTIONS.map((section) => (
          <section
            key={section.id}
            id={`guide-${section.id}`}
            className="sp-card"
            aria-labelledby={`guide-${section.id}-title`}
          >
            <h2 id={`guide-${section.id}-title`} className="sp-card__title">
              {t(section.title)}
            </h2>
            <p>{t(section.body)}</p>
          </section>
        ))}
      </div>
      <div className="sp-help__disclaimer">
        <Notice level="info">
          <p>{t('legal.notMedicalDevice')}</p>
        </Notice>
      </div>
    </Page>
  );
}
