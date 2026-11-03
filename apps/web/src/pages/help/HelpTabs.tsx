import { Link } from '@tanstack/react-router';
import { useT } from '../../i18n/i18n';

/** The two parts of the help: the club's protocols and the usage guide. */
export function HelpTabs(props: { current: 'protocols' | 'guide' }) {
  const t = useT();
  return (
    <nav className="sp-tabs" aria-label={t('help.sections')}>
      <Link
        to="/help"
        className="sp-tabs__link"
        aria-current={props.current === 'protocols' ? 'page' : undefined}
        activeOptions={{ exact: true }}
      >
        {t('help.tab.protocols')}
      </Link>
      <Link
        to="/help/guide"
        className="sp-tabs__link"
        aria-current={props.current === 'guide' ? 'page' : undefined}
      >
        {t('help.tab.guide')}
      </Link>
    </nav>
  );
}
