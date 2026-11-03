import { router } from 'expo-router';
import { useTranslator } from '../src/ui/i18n.tsx';
import { Button, ScreenBody, StatusMessage } from '../src/ui/primitives.tsx';

export default function NotFound() {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <StatusMessage level="warning">{t('error.notFound')}</StatusMessage>
      <Button
        label={t('nav.goHome')}
        onPress={() => {
          router.replace('/');
        }}
      />
    </ScreenBody>
  );
}
