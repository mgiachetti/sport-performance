import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { SyncIssue, SyncStatus } from '../offline/engine.ts';
import {
  lastSyncedText,
  quietSyncLine,
  syncAlerts,
  syncIssueText,
  type QuietSyncLine,
} from '../offline/presenter.ts';
import { useTranslator } from '../ui/i18n.tsx';
import { AppText, Button, Card, ClockIcon, StatusIcon, StatusMessage } from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * The sync indicator (B-502, ADR 0069, made quiet by ADR 0103). Silent when
 * all is well. Otherwise one compact, muted line (no signal, what waits to
 * be sent, a failing server) that syncs now when pressed. What needs the
 * user to act stays a prominent status message: a pause until an app update
 * or a new sign-in, and the changes the server did not apply.
 *
 * `detailed` (the account screen) adds when it last synced and the
 * "Sincronizar ahora" button.
 */
export function SyncIndicator({
  status,
  nowMs,
  offline = false,
  detailed = false,
  onSyncNow,
}: {
  readonly status: SyncStatus;
  readonly nowMs: number;
  /** The session could not reach the server: said as no signal even before the queue tries. */
  readonly offline?: boolean;
  readonly detailed?: boolean;
  /** Asks for a sync now; omitted on screens that only inform. */
  readonly onSyncNow?: () => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const shown: SyncStatus =
    offline && status.phase !== 'paused' && status.phase !== 'offline'
      ? { ...status, phase: 'offline' }
      : status;
  const alerts = syncAlerts(shown, translator);
  const line = quietSyncLine(shown, translator);
  const canSync = onSyncNow !== undefined && shown.phase !== 'syncing' && shown.phase !== 'paused';
  if (!detailed && alerts.length === 0 && line === null) return null;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t('sync.title')}
      style={{ gap: theme.spacing.sm }}
    >
      {alerts.map((alert) => (
        <StatusMessage key={alert.text} level={alert.level}>
          {alert.text}
        </StatusMessage>
      ))}
      {line === null ? null : (
        <QuietLine line={line} onPress={canSync && !detailed ? onSyncNow : undefined} />
      )}
      {detailed ? (
        <>
          <AppText role="bodySmall" tone="muted">
            {shown.phase === 'syncing'
              ? t('sync.syncing')
              : lastSyncedText(shown.lastSyncedAt, nowMs, translator)}
          </AppText>
          {onSyncNow === undefined ? null : (
            <Button
              variant="secondary"
              label={t('sync.now')}
              disabled={!canSync}
              busy={shown.phase === 'syncing'}
              onPress={onSyncNow}
            />
          )}
        </>
      ) : null}
    </View>
  );
}

function QuietIcon({ kind }: { readonly kind: QuietSyncLine['kind'] }) {
  const theme = useTheme();
  const side = theme.sizes.statusIcon;
  if (kind === 'sending') {
    return <ActivityIndicator size="small" color={theme.colors.text.muted} />;
  }
  if (kind === 'pending') return <ClockIcon size={side} />;
  return <StatusIcon level="warning" size={side} />;
}

/** One muted row, icon and text; a button that syncs now when there is a handler. */
function QuietLine({
  line,
  onPress,
}: {
  readonly line: QuietSyncLine;
  readonly onPress: (() => void) | undefined;
}) {
  const theme = useTheme();
  const { t } = useTranslator();
  const [focused, setFocused] = useState(false);
  const warns = line.kind === 'offline' || line.kind === 'failing';
  const label = warns ? `${t('status.warning')}: ${line.text}` : line.text;
  const content = (
    <>
      <QuietIcon kind={line.kind} />
      <Text style={[theme.text.bodySmall, { color: theme.colors.text.secondary, flexShrink: 1 }]}>
        {line.text}
      </Text>
    </>
  );
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    minHeight: theme.sizes.touchTarget,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: theme.borderWidth.thick,
  };
  if (onPress === undefined) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        style={{ ...row, borderColor: 'transparent' }}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('sync.now')}
      accessibilityLiveRegion="polite"
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        ...row,
        borderColor: focused ? theme.colors.focus : 'transparent',
        backgroundColor: pressed ? theme.colors.brand.subtle : 'transparent',
      })}
    >
      {content}
    </Pressable>
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
    <Card title={t('sync.issues.title')}>
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
