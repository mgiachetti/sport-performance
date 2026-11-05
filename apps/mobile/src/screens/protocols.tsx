import type { TestDefinitionDto } from '@sport-performance/contracts';
import { addDays } from '@sport-performance/domain';
import { formatLocalDate, isMessageKey, type Translator } from '@sport-performance/i18n';
import { Pressable, View } from 'react-native';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Protocols of the club's tests (B-415), to read on the field before or
 * during a test day: what is done, how many attempts, which one counts, the
 * rest and the equipment. Text only; the images and videos are on the
 * staff web.
 */

export type ProtocolListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly definitions: readonly TestDefinitionDto[] };

export function testLabel({ t }: Translator, code: string): string {
  const key = `test.${code}`;
  return isMessageKey(key) ? (t as (key: string) => string)(key) : code;
}

function attemptsLabel({ t }: Translator, definition: TestDefinitionDto): string {
  return t('protocol.attempts', {
    count: definition.attemptCount,
    aggregation: definition.attemptAggregation,
  });
}

export function restLabel({ t }: Translator, seconds: number): string {
  const duration =
    seconds >= 60 && seconds % 60 === 0
      ? t('protocol.restMinutes', { minutes: seconds / 60 })
      : t('protocol.restSeconds', { seconds });
  return t('protocol.rest', { duration });
}

function validityLabel({ t }: Translator, definition: TestDefinitionDto): string {
  return definition.validTo === null
    ? t('protocol.validFrom', { date: formatLocalDate(definition.validFrom) })
    : t('protocol.validRange', {
        from: formatLocalDate(definition.validFrom),
        to: formatLocalDate(addDays(definition.validTo, -1)),
      });
}

export function ProtocolListScreen({
  state,
  offline,
  onOpen,
  onRetry,
}: {
  readonly state: ProtocolListState;
  readonly offline: boolean;
  readonly onOpen: (testDefinitionId: string) => void;
  readonly onRetry: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  return (
    <ScreenBody header={<ScreenHeader title={t('nav.protocols')} subtitle={t('protocol.intro')} />}>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {state.status === 'loading' ? (
        <AppText tone="secondary">{t('common.loading')}</AppText>
      ) : null}
      {state.status === 'error' ? (
        <>
          <StatusMessage level="critical">{state.message}</StatusMessage>
          <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
        </>
      ) : null}
      {state.status === 'ready' && state.definitions.length === 0 ? (
        <AppText tone="secondary">{t('protocol.empty')}</AppText>
      ) : null}
      {state.status === 'ready'
        ? state.definitions.map((definition) => {
            const name = testLabel(translator, definition.code);
            return (
              <Pressable
                key={definition.id}
                accessibilityRole="button"
                accessibilityLabel={t('protocol.open', { test: name })}
                onPress={() => {
                  onOpen(definition.id);
                }}
                style={{ minHeight: theme.sizes.touchTarget }}
              >
                <Card>
                  <AppText role="heading">{name}</AppText>
                  <AppText role="bodySmall" tone="secondary">
                    {`${t('protocol.version', { version: definition.version })} · ${attemptsLabel(translator, definition)}`}
                  </AppText>
                  {definition.protocol.summary === null ? null : (
                    <AppText>{definition.protocol.summary}</AppText>
                  )}
                </Card>
              </Pressable>
            );
          })
        : null}
    </ScreenBody>
  );
}

export function ProtocolScreen({
  definition,
  onBack,
}: {
  readonly definition: TestDefinitionDto;
  readonly onBack: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const { protocol } = definition;
  return (
    <ScreenBody>
      <Button variant="link" label={t('protocol.back')} onPress={onBack} />
      <AppText role="title" accessibilityRole="header">
        {testLabel(translator, definition.code)}
      </AppText>
      <AppText tone="secondary">
        {`${t('protocol.version', { version: definition.version })} · ${validityLabel(translator, definition)}`}
      </AppText>
      <Card title={t('protocol.summary')}>
        {protocol.summary === null ? null : <AppText>{protocol.summary}</AppText>}
        <AppText>{attemptsLabel(translator, definition)}</AppText>
        {protocol.restBetweenAttemptsS === null ? null : (
          <AppText>{restLabel(translator, protocol.restBetweenAttemptsS)}</AppText>
        )}
      </Card>
      {definition.maximalLoad ? (
        <StatusMessage level="warning">{t('protocol.maximalLoad')}</StatusMessage>
      ) : null}
      <Card title={t('protocol.steps')}>
        {protocol.steps.length === 0 ? (
          <AppText tone="secondary">{t('protocol.noSteps')}</AppText>
        ) : (
          protocol.steps.map((step, index) => (
            <View
              key={`${String(index)}-${step}`}
              style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            >
              <AppText role="heading">{`${String(index + 1)}.`}</AppText>
              <View style={{ flex: 1 }}>
                <AppText>{step}</AppText>
              </View>
            </View>
          ))
        )}
      </Card>
      {protocol.equipment.length === 0 ? null : (
        <Card title={t('protocol.equipment')}>
          {protocol.equipment.map((item, index) => (
            <AppText key={`${String(index)}-${item}`}>{`• ${item}`}</AppText>
          ))}
        </Card>
      )}
      <AppText role="bodySmall" tone="secondary">
        {t('protocol.recordHow')}
      </AppText>
    </ScreenBody>
  );
}
