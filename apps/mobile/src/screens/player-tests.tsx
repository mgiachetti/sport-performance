import type { MyTestDay, PlayerPercentile, TestResult } from '@sport-performance/contracts';
import { formatLocalDate, formatNumber } from '@sport-performance/i18n';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { metricLabel, metricValue, testLabel, unitValue } from '../player/format.ts';
import type { PersonalRecord } from '../player/records.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { EmptyState, ListRow } from '../ui/blocks.tsx';
import { AppText, Card, ScreenBody, ScreenHeader, StatusMessage } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';
import { TestDaySummary } from './player-today.tsx';

export type PercentilesSection =
  /** M13/M14 (or an age band without own percentiles): the matrix denies it. */
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly items: readonly PlayerPercentile[] };

function Row({ children, first }: { readonly children: ReactNode; readonly first: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.md,
        borderTopWidth: first ? 0 : theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      {children}
    </View>
  );
}

/** A label (and its caption) at the left and a figure at the right. */
function FigureLine({
  label,
  caption,
  figure,
}: {
  readonly label: string;
  readonly caption?: string;
  readonly figure: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText role="bodyStrong">{label}</AppText>
        {caption !== undefined ? (
          <AppText role="caption" tone="secondary">
            {caption}
          </AppText>
        ) : null}
      </View>
      <Figure>{figure}</Figure>
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
    <Card title={title} subtitle={intro ?? null}>
      <View>{children}</View>
    </Card>
  );
}

/** A figure at the right of a row: condensed, tabular, the unit inside the formatted value. */
function Figure({ children }: { readonly children: string }) {
  return (
    <AppText role="metric" align="right">
      {children}
    </AppText>
  );
}

/**
 * Where the player is in the group, drawn as a bar from 0 to 100: decorative,
 * the percentile is always written next to it.
 */
function PercentileBar({ percentile }: { readonly percentile: number }) {
  const theme = useTheme();
  const clamped = Math.min(100, Math.max(0, percentile));
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        height: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surfaceRaised,
        borderWidth: theme.borderWidth.hairline,
        borderColor: theme.colors.border.subtle,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${String(clamped)}%`,
          height: '100%',
          backgroundColor: theme.colors.chart.player,
        }}
      />
    </View>
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
        <EmptyState mark="0" title={t('playerApp.records.none')} />
      ) : (
        records.map((record, index) => (
          <Row key={record.key} first={index === 0}>
            <FigureLine
              label={metricLabel(t, record.metricCode, record.exercise)}
              caption={t('playerApp.records.when', {
                date: formatLocalDate(record.measuredOn),
                method: methodLabel(t, record.method),
              })}
              figure={unitValue(record.value, record.unit)}
            />
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
        <EmptyState mark="%" title={t('playerApp.percentiles.fromM15')} />
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
        <EmptyState mark="%" title={t('playerApp.percentiles.none')} />
      ) : (
        section.items.map((item, index) => (
          <Row key={`${item.metricCode}:${item.exercise ?? ''}`} first={index === 0}>
            {item.status === 'ok' && item.percentile !== null ? (
              <>
                <FigureLine
                  label={metricLabel(t, item.metricCode, item.exercise)}
                  figure={t('playerApp.percentiles.value', {
                    percentile: formatNumber(item.percentile, { decimals: 0 }),
                  })}
                />
                <PercentileBar percentile={item.percentile} />
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
              <>
                <AppText role="bodyStrong">
                  {metricLabel(t, item.metricCode, item.exercise)}
                </AppText>
                <AppText role="bodySmall" tone="secondary">
                  {t('playerApp.percentiles.insufficient')}
                </AppText>
              </>
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
        <EmptyState mark="—" title={t('playerApp.history.none')} />
      ) : (
        results.map((result, index) => (
          <Row key={result.id} first={index === 0}>
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
  onOpenProtocols = null,
}: {
  readonly notice: string | null;
  readonly records: readonly PersonalRecord[];
  readonly percentiles: PercentilesSection;
  readonly history: readonly TestResult[];
  /** `null` while loading for the first time. */
  readonly testDays: readonly MyTestDay[] | null;
  /** How each test is done (B-415); `null` hides it. */
  readonly onOpenProtocols?: (() => void) | null;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('nav.myTests')} />}>
      {notice !== null ? <StatusMessage level="warning">{notice}</StatusMessage> : null}
      <Section title={t('playerApp.testDays.title')}>
        {testDays === null ? (
          <AppText tone="secondary">{t('common.loading')}</AppText>
        ) : testDays.length === 0 ? (
          <EmptyState mark="—" title={t('playerApp.testDays.none')} />
        ) : (
          testDays.map((day, index) => (
            <Row key={day.id} first={index === 0}>
              <TestDaySummary day={day} />
            </Row>
          ))
        )}
      </Section>
      <Records records={records} />
      <Percentiles section={percentiles} />
      <History results={history} />
      {onOpenProtocols === null ? null : (
        <Card>
          <ListRow
            first
            title={t('protocols.open')}
            subtitle={t('protocols.open.hint')}
            onPress={onOpenProtocols}
          />
        </Card>
      )}
    </ScreenBody>
  );
}
