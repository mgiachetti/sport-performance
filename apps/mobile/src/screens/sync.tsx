import { View } from 'react-native';
import type { SyncIssue, SyncStatus } from '../offline/engine.ts';
import { syncIssueText, syncStatusLines } from '../offline/presenter.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, Card, StatusMessage } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * The sync indicator (B-502, ADR 0065): what waits to be sent, whether there
 * is signal, when it last synced and how many changes could not be applied.
 * Announced as a status; each line has its icon and text.
 */
export function SyncIndicator({
  status,
  nowMs,
  onSyncNow,
}: {
  readonly status: SyncStatus;
  readonly nowMs: number;
  /** Shown when there is something to retry; omitted on screens that only inform. */
  readonly onSyncNow?: () => void;
}) {
  const translator = useTranslator();
  const theme = useTheme();
  const lines = syncStatusLines(status, nowMs, translator);
  const canRetry =
    onSyncNow !== undefined &&
    status.phase !== 'syncing' &&
    (status.pendingCount > 0 || status.phase !== 'idle');
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={translator.t('sync.title')}
      style={{ gap: theme.spacing.sm }}
    >
      {lines.map((line) => (
        <StatusMessage key={line.text} level={line.level}>
          {line.text}
        </StatusMessage>
      ))}
      {canRetry ? (
        <Button variant="secondary" label={translator.t('sync.now')} onPress={onSyncNow} />
      ) : null}
    </View>
  );
}

/** The changes that left the queue without being applied, until the user dismisses them. */
export function SyncIssuesList({
  issues,
  onDismiss,
  onDismissAll,
}: {
  readonly issues: readonly SyncIssue[];
  readonly onDismiss: (id: number) => void;
  readonly onDismissAll: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  if (issues.length === 0) return null;
  return (
    <Card>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {t('sync.issues.title')}
      </AppText>
      {issues.map((issue) => {
        const text = syncIssueText(issue, translator);
        return (
          <View key={issue.id} style={{ gap: theme.spacing.xs }}>
            <AppText role="bodyStrong">{text.title}</AppText>
            <StatusMessage level={issue.kind === 'rejected' ? 'critical' : 'warning'}>
              {text.body}
            </StatusMessage>
            <Button
              variant="link"
              label={t('sync.issue.dismiss')}
              accessibilityHint={text.title}
              onPress={() => {
                onDismiss(issue.id);
              }}
            />
          </View>
        );
      })}
      {issues.length > 1 ? (
        <Button variant="secondary" label={t('sync.issues.dismissAll')} onPress={onDismissAll} />
      ) : null}
    </Card>
  );
}
