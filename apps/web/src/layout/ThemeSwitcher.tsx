import { useId } from 'react';
import { useServices, useStore } from '../app/services';
import { useT } from '../i18n/i18n';
import { THEME_PREFERENCES, type ThemePreference } from '../theme/theme-store';
import { Icon } from '../ui/icons';

const LABELS = {
  system: 'theme.option.system',
  dark: 'theme.option.dark',
  'light-hc': 'theme.option.lightHc',
} as const satisfies Record<ThemePreference, string>;

/** Dark identity or the light high-contrast variant for the sun; remembered per browser. */
export function ThemeSwitcher() {
  const t = useT();
  const { theme } = useServices();
  const { preference } = useStore(theme);
  const id = useId();
  return (
    <div className="sp-theme-switcher">
      <label htmlFor={id}>
        <Icon name="contrast" />
        <span>{t('theme.label')}</span>
      </label>
      <select
        id={id}
        value={preference}
        onChange={(event) => {
          theme.setPreference(event.target.value as ThemePreference);
        }}
      >
        {THEME_PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {t(LABELS[option])}
          </option>
        ))}
      </select>
    </div>
  );
}
