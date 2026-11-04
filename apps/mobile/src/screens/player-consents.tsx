import type {
  ConsentDocument,
  ConsentTypeStatus,
  PlayerConsents,
} from '@sport-performance/contracts';
import type { TimeZone } from '@sport-performance/domain';
import { formatDate } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  StatusMessage,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

const STATE_LEVEL: Record<ConsentTypeStatus['state'], StatusLevel> = {
  granted: 'ok',
  outdated: 'warning',
  adult_signature_required: 'warning',
  lapsed: 'critical',
  revoked: 'critical',
  missing: 'critical',
};

export type PlayerConsentsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly consents: PlayerConsents;
      /** The club's, to date the signatures (the device's never). */
      readonly timeZone: TimeZone;
    };

export interface PlayerConsentsActions {
  readonly onRead: (documentId: string) => void;
  readonly onSign: (documentId: string) => void;
  readonly onRevoke: (type: ConsentTypeStatus['type']) => void;
  readonly onCloseDocument: () => void;
  readonly onBack: () => void;
  readonly onRetry: () => void;
}

function TypeCard({
  status,
  timeZone,
  offline,
  busy,
  actions,
}: {
  readonly status: ConsentTypeStatus;
  readonly timeZone: TimeZone;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly actions: PlayerConsentsActions;
}) {
  const { t } = useTranslator();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const canSign =
    status.actions.includes('sign') &&
    status.currentDocument !== null &&
    status.state !== 'granted';
  const canRevoke =
    status.actions.includes('revoke') &&
    (status.state === 'granted' || status.state === 'outdated');
  return (
    <Card>
      <AppText role="heading" accessibilityRole="header">
        {t(`guardian.consents.type.${status.type}`)}
      </AppText>
      <AppText role="bodySmall" tone="secondary">
        {t(`guardian.consents.typeHelp.${status.type}`)}
      </AppText>
      <StatusMessage level={STATE_LEVEL[status.state]}>
        {t(`guardian.consents.state.${status.state}`)}
      </StatusMessage>
      {status.consent !== null ? (
        <AppText role="caption" tone="secondary">
          {t('guardian.consents.signedBy', {
            signer: status.consent.signerKind,
            date: formatDate(Date.parse(status.consent.signedAt), { timeZone }),
            version: status.consent.documentVersion,
          })}
        </AppText>
      ) : null}
      {status.state === 'outdated' ? (
        <AppText role="bodySmall" tone="secondary">
          {t('guardian.consents.stateHelp.outdated')}
        </AppText>
      ) : null}
      {canSign || canRevoke ? (
        offline ? (
          <AppText role="caption" tone="muted">
            {t('playerApp.consents.needsConnection')}
          </AppText>
        ) : (
          <View style={{ gap: 8 }}>
            {canSign && status.currentDocument !== null ? (
              <Button
                label={t(
                  status.state === 'outdated'
                    ? 'guardian.consents.readNew'
                    : 'guardian.consents.read',
                )}
                onPress={() => {
                  if (status.currentDocument !== null) actions.onRead(status.currentDocument.id);
                }}
              />
            ) : null}
            {canRevoke && !confirmRevoke ? (
              <Button
                variant="secondary"
                label={t('guardian.consents.revoke')}
                onPress={() => {
                  setConfirmRevoke(true);
                }}
              />
            ) : null}
            {confirmRevoke ? (
              <>
                <StatusMessage level="warning">
                  {t('playerApp.consents.revokeConfirm', { type: status.type })}
                </StatusMessage>
                <Button
                  variant="secondary"
                  label={t('guardian.consents.revokeConfirmAction')}
                  busy={busy}
                  onPress={() => {
                    actions.onRevoke(status.type);
                    setConfirmRevoke(false);
                  }}
                />
                <Button
                  variant="link"
                  label={t('common.cancel')}
                  onPress={() => {
                    setConfirmRevoke(false);
                  }}
                />
              </>
            ) : null}
          </View>
        )
      ) : status.currentDocument === null && status.state !== 'granted' ? (
        <AppText role="caption" tone="muted">
          {t('guardian.consents.noDocument')}
        </AppText>
      ) : null}
    </Card>
  );
}

function DocumentView({
  document,
  timeZone,
  busy,
  error,
  actions,
}: {
  readonly document: ConsentDocument;
  readonly timeZone: TimeZone;
  readonly busy: boolean;
  readonly error: string | null;
  readonly actions: PlayerConsentsActions;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [accepted, setAccepted] = useState(false);
  const [mustAccept, setMustAccept] = useState(false);
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {document.title}
      </AppText>
      <AppText role="caption" tone="secondary">
        {t('guardian.consents.documentVersion', {
          version: document.version,
          date: formatDate(Date.parse(document.publishedAt), { timeZone }),
        })}
      </AppText>
      {document.body.split(/\n\s*\n/).map((paragraph, index) => (
        <AppText key={index}>{paragraph.trim()}</AppText>
      ))}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: theme.sizes.touchTarget,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppText>{t('playerApp.consents.accept')}</AppText>
        </View>
        <Switch
          accessibilityLabel={t('playerApp.consents.accept')}
          value={accepted}
          onValueChange={(on) => {
            setAccepted(on);
            setMustAccept(false);
          }}
          trackColor={{ true: theme.colors.brand.solid, false: theme.colors.border.strong }}
        />
      </View>
      {mustAccept ? (
        <StatusMessage level="critical">{t('guardian.consents.mustAccept')}</StatusMessage>
      ) : null}
      {error !== null ? <StatusMessage level="critical">{error}</StatusMessage> : null}
      <Button
        label={busy ? t('guardian.consents.signing') : t('guardian.consents.sign')}
        busy={busy}
        onPress={() => {
          if (!accepted) {
            setMustAccept(true);
            return;
          }
          actions.onSign(document.id);
        }}
      />
      <Button variant="link" label={t('common.back')} onPress={actions.onCloseDocument} />
    </ScreenBody>
  );
}

/**
 * The player's consents (B-503): the state of each type with icon and text.
 * A minor reads them (the guardian signs); an adult reads the current text,
 * signs and revokes, always online (a consent is a legal act on the text in
 * force, never queued).
 */
export function PlayerConsentsScreen({
  state,
  document,
  offline,
  busy,
  notice,
  error,
  actions,
}: {
  readonly state: PlayerConsentsState;
  /** The text being read before signing (opened from the ready list). */
  readonly document: ConsentDocument | null;
  readonly offline: boolean;
  readonly busy: boolean;
  /** "Signed", "revoked", or "kept on…". */
  readonly notice: { readonly level: StatusLevel; readonly text: string } | null;
  readonly error: string | null;
  readonly actions: PlayerConsentsActions;
}) {
  const { t } = useTranslator();
  if (document !== null && state.status === 'ready') {
    return (
      <DocumentView
        document={document}
        timeZone={state.timeZone}
        busy={busy}
        error={error}
        actions={actions}
      />
    );
  }
  if (state.status === 'loading') return <LoadingView label={t('common.loading')} />;
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('playerApp.consents.title')}
      </AppText>
      <AppText tone="secondary">{t('playerApp.consents.intro')}</AppText>
      {notice !== null ? <StatusMessage level={notice.level}>{notice.text}</StatusMessage> : null}
      {error !== null ? <StatusMessage level="critical">{error}</StatusMessage> : null}
      {state.status === 'error' ? (
        <>
          <StatusMessage level="critical">{state.message}</StatusMessage>
          <Button variant="secondary" label={t('common.retry')} onPress={actions.onRetry} />
        </>
      ) : (
        <>
          <AppText>
            {t(
              state.consents.playerOfAge ? 'playerApp.consents.adult' : 'playerApp.consents.minor',
            )}
          </AppText>
          {state.consents.types.map((status) => (
            <TypeCard
              key={status.type}
              status={status}
              timeZone={state.timeZone}
              offline={offline}
              busy={busy}
              actions={actions}
            />
          ))}
        </>
      )}
      <Button variant="link" label={t('common.back')} onPress={actions.onBack} />
    </ScreenBody>
  );
}
