import { useServices, useStore } from '../app/services';
import { useT } from '../i18n/i18n';
import { THEME_PREFERENCES, type ThemePreference } from '../theme/theme-store';
import { SegmentedControl } from '../ui/components';

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
  return (
    <SegmentedControl
      label={t('theme.label')}
      layout="stack"
      size="sm"
      options={THEME_PREFERENCES.map((option) => ({ value: option, label: t(LABELS[option]) }))}
      value={preference}
      onChange={(value) => {
        theme.setPreference(value);
      }}
    />
  );
}
