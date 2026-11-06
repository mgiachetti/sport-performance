import { View } from 'react-native';
import { useTranslator } from '../ui/i18n.tsx';
import { Button } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * The bar above a screen opened from a tab (ADR 0100): only the way back to
 * the tab, as one of the app's own buttons. The title stays in the screen's
 * header, so the bar is as short as a thumb target.
 */
export function BackBar({ onBack }: { readonly onBack: () => void }) {
  const theme = useTheme();
  const { t } = useTranslator();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        alignItems: 'flex-start',
      }}
    >
      <Button
        variant="ghost"
        align="start"
        label={`‹ ${t('common.back')}`}
        accessibilityLabel={t('common.back')}
        onPress={onBack}
      />
    </View>
  );
}
