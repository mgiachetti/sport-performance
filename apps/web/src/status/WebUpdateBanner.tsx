import { isWebOutdated } from '../api/connection';
import { useServices, useStore } from '../app/services';
import { useT } from '../i18n/i18n';
import { Button, Notice } from '../ui/components';

/** "Hay una versión nueva de la web": the API answers with another contract than this build. */
export function WebUpdateBanner(props: { reload?: () => void }) {
  const t = useT();
  const { connection } = useServices();
  const { serverContractVersion } = useStore(connection);
  if (!isWebOutdated(serverContractVersion)) return null;
  const reload =
    props.reload ??
    (() => {
      window.location.reload();
    });
  return (
    <div className="sp-banner">
      <Notice
        level="warning"
        role="alert"
        action={
          <Button variant="secondary" onClick={reload}>
            {t('webUpdate.action')}
          </Button>
        }
      >
        <p>
          <strong>{t('webUpdate.title')}</strong>
        </p>
        <p>{t('webUpdate.body')}</p>
      </Notice>
    </div>
  );
}
