import type { MyTestDay, PlayerPercentile, TestResult } from '@sport-performance/contracts';
import { formatLocalDate, formatNumber } from '@sport-performance/i18n';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { metricLabel, metricValue, testLabel, unitValue } from '../player/format.ts';
import type { PersonalRecord } from '../player/records.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Card, ScreenBody, StatusMessage } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';
import { TestDaySummary } from './player-today.tsx';

export type PercentilesSection =
  /** M13/M14 (or an age band without own percentiles): the matrix denies it. */
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly items: readonly PlayerPercentile[] };

function Row({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingTop: theme.spacing.sm,
        borderTopWidth: theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      {children}
    </View>
  );
}

function Section({
  title,
  intro,
  children,
}: {
  readonly title: string;
  readonly intro?: string;
  readonly children: ReactNode;
}) {
  return (
    <Card>
      <AppText role="heading" accessibilityRole="header">
        {title}
      </AppText>
      {intro !== undefined ? (
        <AppText role="bodySmall" tone="secondary">
          {intro}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

function methodLabel(t: ReturnType<typeof useTranslator>['t'], method: string | null): string {
  return method === null ? '—' : t(`method.${method as 'manual'}`);
}

function Records({ records }: { readonly records: readonly PersonalRecord[] }) {
  const { t } = useTranslator();
  return (
    <Section title={t('playerApp.records.title')} intro={t('playerApp.records.intro')}>
      {records.length === 0 ? (
        <AppText tone="secondary">{t('playerApp.records.none')}</AppText>
      ) : (
        records.map((record) => (
          <Row key={record.key}>
            <AppText role="bodyStrong">
              {metricLabel(t, record.metricCode, record.exercise)}
            </AppText>
            <AppText role="metricSmall">{unitValue(record.value, record.unit)}</AppText>
            <AppText role="caption" tone="secondary">
              {t('playerApp.records.when', {
                date: formatLocalDate(record.measuredOn),
                method: methodLabel(t, record.method),
              })}
            </AppText>
            {record.mixedMethods ? (
              <StatusMessage level="warning">{t('playerApp.records.mixedMethods')}</StatusMessage>
            ) : null}
          </Row>
        ))
      )}
    </Section>
  );
}

function Percentiles({ section }: { readonly section: PercentilesSection }) {
  const { t } = useTranslator();
  if (section.kind === 'hidden') {
    return (
      <Section title={t('playerApp.percentiles.title')}>
        <AppText tone="secondary">{t('playerApp.percentiles.fromM15')}</AppText>
      </Section>
    );
  }
  return (
    <Section title={t('playerApp.percentiles.title')} intro={t('playerApp.percentiles.intro')}>
      {section.kind === 'loading' ? (
        <AppText tone="secondary">{t('common.loading')}</AppText>
      ) : section.kind === 'error' ? (
        <StatusMessage level="critical">{section.message}</StatusMessage>
      ) : section.items.length === 0 ? (
        <AppText tone="secondary">{t('playerApp.percentiles.none')}</AppText>
      ) : (
        section.items.map((item) => (
          <Row key={`${item.metricCode}:${item.exercise ?? ''}`}>
            <AppText role="bodyStrong">{metricLabel(t, item.metricCode, item.exercise)}</AppText>
            {item.status === 'ok' && item.percentile !== null ? (
              <>
                <AppText role="metricSmall">
                  {t('playerApp.percentiles.value', {
                    percentile: formatNumber(item.percentile, { decimals: 0 }),
                  })}
                </AppText>
                <AppText role="caption" tone="secondary">
                  {t('playerApp.percentiles.detail', {
                    value: metricValue(item.metricCode, item.value, item.unit),
                    median:
                      item.median === null
                        ? '—'
                        : metricValue(item.metricCode, item.median, item.unit),
                    size: item.sampleSize ?? 0,
                  })}
                </AppText>
                {item.mixedMethods ? (
                  <StatusMessage level="warning">
                    {t('playerApp.percentiles.mixedMethods')}
                  </StatusMessage>
                ) : null}
              </>
            ) : (
              <AppText tone="secondary">{t('playerApp.percentiles.insufficient')}</AppText>
            )}
          </Row>
        ))
      )}
    </Section>
  );
}

function History({ results }: { readonly results: readonly TestResult[] }) {
  const { t } = useTranslator();
  return (
    <Section title={t('playerApp.history.title')}>
      {results.length === 0 ? (
        <AppText tone="secondary">{t('playerApp.history.none')}</AppText>
      ) : (
        results.map((result) => (
          <Row key={result.id}>
            <AppText role="bodyStrong">{testLabel(t, result.testCode)}</AppText>
            <AppText role="caption" tone="secondary">
              {t('playerApp.history.when', {
                date: formatLocalDate(result.measuredOn),
                method: methodLabel(t, result.method),
              })}
            </AppText>
            {result.status === 'not_done' ? (
              <AppText tone="secondary">{t('playerApp.history.notDone')}</AppText>
            ) : (
              result.scores.map((score) => (
                <AppText key={score.metricCode}>
                  {`${metricLabel(t, score.metricCode, result.exercise)}: ${metricValue(
                    score.metricCode,
                    score.value,
                    score.unit,
                  )}`}
                </AppText>
              ))
            )}
          </Row>
        ))
      )}
    </Section>
  );
}

/**
 * "Mis tests" (B-503): own records, own percentiles from M15 (the group only
 * as aggregates: never names, never a ranking), the history of results and
 * the upcoming test days.
 */
export function PlayerTestsScreen({
  notice,
  records,
  percentiles,
  history,
  testDays,
}: {
  readonly notice: string | null;
  readonly records: readonly PersonalRecord[];
  readonly percentiles: PercentilesSection;
  readonly history: readonly TestResult[];
  /** `null` while loading for the first time. */
  readonly testDays: readonly MyTestDay[] | null;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('nav.myTests')}
      </AppText>
      {notice !== null ? <StatusMessage level="warning">{notice}</StatusMessage> : null}
      <Section title={t('playerApp.testDays.title')}>
        {testDays === null ? (
          <AppText tone="secondary">{t('common.loading')}</AppText>
        ) : testDays.length === 0 ? (
          <AppText tone="secondary">{t('playerApp.testDays.none')}</AppText>
        ) : (
          testDays.map((day) => (
            <Row key={day.id}>
              <TestDaySummary day={day} />
            </Row>
          ))
        )}
      </Section>
      <Records records={records} />
      <Percentiles section={percentiles} />
      <History results={history} />
    </ScreenBody>
  );
}
