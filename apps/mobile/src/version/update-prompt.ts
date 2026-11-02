import type { Translator } from '@sport-performance/i18n';
import type { UpdateGate } from './compatibility.js';

/**
 * What the UI shows for the version gate (B-324): the view model of the
 * blocking "actualizá la app" screen or of the notice, with its texts
 * already translated. The React Native components (B-501) only render it.
 */
export interface UpdatePrompt {
  /** `screen`: blocks the whole app. `banner`: a notice over the app, which keeps working. */
  readonly presentation: 'screen' | 'banner';
  readonly title: string;
  readonly body: string;
  /** Opens the store; `null` when the store link is not configured. */
  readonly action: { readonly label: string; readonly url: string } | null;
  /** Extra line under the body (no store link, or why sync is paused). */
  readonly note: string | null;
  /** Label of "Más tarde"; only on the notice of a newer version. */
  readonly dismissLabel: string | null;
}

/** Prompt for `gate`, or `null` when there is nothing to show. */
export function updatePrompt(
  gate: UpdateGate,
  currentVersion: string,
  { t }: Translator,
): UpdatePrompt | null {
  switch (gate.kind) {
    case 'ok':
      return null;
    case 'update_available':
      if (gate.dismissed) return null;
      return {
        presentation: 'banner',
        title: t('appUpdate.available.title'),
        body: t('appUpdate.available.body', { latestVersion: gate.latestVersion }),
        action:
          gate.storeUrl === null
            ? null
            : { label: t('appUpdate.available.action'), url: gate.storeUrl },
        note: null,
        dismissLabel: t('appUpdate.available.dismiss'),
      };
    case 'update_required':
    case 'update_required_offline': {
      const action =
        gate.storeUrl === null
          ? null
          : { label: t('appUpdate.required.action'), url: gate.storeUrl };
      if (gate.kind === 'update_required_offline') {
        return {
          presentation: 'banner',
          title: t('appUpdate.required.title'),
          body: t('appUpdate.required.offline'),
          action,
          note: t('sync.pausedForUpdate'),
          dismissLabel: null,
        };
      }
      return {
        presentation: 'screen',
        title: t('appUpdate.required.title'),
        body:
          gate.minVersion === null
            ? t('error.appUpdateRequired')
            : t('appUpdate.required.body', { currentVersion, minVersion: gate.minVersion }),
        action,
        note: action === null ? t('appUpdate.required.noStoreLink') : t('sync.pausedForUpdate'),
        dismissLabel: null,
      };
    }
  }
}
