import type {
  Child,
  ConsentDocumentSummary,
  ConsentTypeStatus,
  PlayerConsents,
} from '@sport-performance/contracts';
import type { ConsentState, TimeZone } from '@sport-performance/domain';
import { formatDate, formatLocalDate } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice } from '../ui/components';
import { StatusLabel } from '../ui/fields';
import { fullName } from './child';
import { childConsentHistoryQuery, consentDocumentQuery } from './queries';

/** How each state reads (always with its icon and text). */
export const CONSENT_STATE_LEVELS: Record<ConsentState, StatusLevel> = {
  granted: 'ok',
  outdated: 'warning',
  adult_signature_required: 'warning',
  missing: 'warning',
  lapsed: 'critical',
  revoked: 'critical',
};

const instant = (value: string) => new Date(value);

/**
 * The child's consents (Ley 25.326, ADR 0043): the state of each type, the
 * current text to read before signing, revoking with its consequence, and
 * the history of signatures. What the guardian may do comes from the API
 * (`actions`, the permission matrix on the server).
 */
export function ConsentsSection(props: { child: Child; consents: UseQueryResult<PlayerConsents> }) {
  const t = useT();
  const { child, consents } = props;
  return (
    <section className="sp-card" aria-labelledby="child-consents">
      <h2 id="child-consents" className="sp-card__title">
        {t('guardian.consents.title')}
      </h2>
      <p>{t('guardian.consents.intro', { name: child.firstName })}</p>
      {consents.isPending ? <Loading /> : null}
      {consents.isError ? <ErrorNotice error={consents.error} /> : null}
      {consents.data === undefined ? null : (
        <ul className="sp-row-list">
          {consents.data.types.map((status) => (
            <li key={status.type}>
              <ConsentRow child={child} status={status} playerConsents={consents.data} />
            </li>
          ))}
        </ul>
      )}
      <ConsentHistory child={child} />
    </section>
  );
}

type Mode = 'idle' | 'sign' | 'revoke';

function ConsentRow(props: {
  child: Child;
  status: ConsentTypeStatus;
  playerConsents: PlayerConsents;
}) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const { child, status } = props;
  const timeZone = active.club.timeZone;
  const [mode, setMode] = useState<Mode>('idle');
  const [done, setDone] = useState<'signed' | 'revoked' | null>(null);
  const titleId = useId();

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: clubQueryKey(active.selection, 'players', child.playerId, 'consents'),
    });

  const revoke = useMutation({
    mutationFn: () =>
      api.revokeConsent({ params: { playerId: child.playerId, type: status.type } }),
    onSuccess: async () => {
      setMode('idle');
      setDone('revoked');
      await refresh();
    },
  });

  const document = status.currentDocument;
  const canSign = status.actions.includes('sign') && status.state !== 'granted';
  const canRevoke = status.actions.includes('revoke') && status.consent !== null;
  const typeLabel = t(`guardian.consents.type.${status.type}`);

  return (
    <article className="sp-row" aria-labelledby={titleId}>
      <div className="sp-row__head">
        <h3 id={titleId} className="sp-row__title">
          {typeLabel}
        </h3>
        <StatusLabel level={CONSENT_STATE_LEVELS[status.state]}>
          {t(`guardian.consents.state.${status.state}`)}
        </StatusLabel>
      </div>
      <p className="sp-meta">{t(`guardian.consents.typeHelp.${status.type}`)}</p>
      {status.consent === null ? null : (
        <p className="sp-meta">
          {t('guardian.consents.signedBy', {
            signer: status.consent.signerKind,
            date: formatDate(instant(status.consent.signedAt), { timeZone }),
            version: status.consent.documentVersion,
          })}
        </p>
      )}
      {status.state === 'outdated' ? <p>{t('guardian.consents.stateHelp.outdated')}</p> : null}
      {status.state === 'adult_signature_required' ? (
        <p>
          {t('guardian.consents.stateHelp.adult_signature_required', {
            date: formatLocalDate(props.playerConsents.guardianSignaturesLapseOn),
          })}
        </p>
      ) : null}
      {canSign && document === null ? (
        <Notice level="info">
          <p>{t('guardian.consents.noDocument')}</p>
        </Notice>
      ) : null}

      {mode === 'idle' && (canSign || canRevoke) ? (
        <div className="sp-row__actions">
          {canSign && document !== null ? (
            <Button
              onClick={() => {
                setDone(null);
                setMode('sign');
              }}
            >
              {status.state === 'outdated'
                ? t('guardian.consents.readNew')
                : t('guardian.consents.read')}
            </Button>
          ) : null}
          {canRevoke ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                revoke.reset();
                setMode('revoke');
              }}
            >
              {t('guardian.consents.revoke')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === 'sign' && document !== null ? (
        <SignPanel
          child={child}
          document={document}
          timeZone={timeZone}
          onCancel={() => {
            setMode('idle');
          }}
          onSigned={async () => {
            setMode('idle');
            setDone('signed');
            await refresh();
          }}
          onFailed={refresh}
        />
      ) : null}

      {mode === 'revoke' ? (
        <div className="sp-form" role="group" aria-label={t('guardian.consents.revoke')}>
          <Notice level="warning">
            <p>
              {t('guardian.consents.revokeConfirm', { type: status.type, name: child.firstName })}
            </p>
          </Notice>
          {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
          <div className="sp-row__actions">
            <Button
              onClick={() => {
                revoke.mutate();
              }}
              disabled={revoke.isPending}
            >
              {revoke.isPending
                ? t('guardian.consents.revoking')
                : t('guardian.consents.revokeConfirmAction')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMode('idle');
              }}
              disabled={revoke.isPending}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <div role="status">
        {done === null ? null : (
          <StatusLabel level="ok">
            {done === 'signed' ? t('guardian.consents.signed') : t('guardian.consents.revoked')}
          </StatusLabel>
        )}
      </div>
    </article>
  );
}

/** The current text, read whole, then "I read it and consent" and the signature. */
function SignPanel(props: {
  child: Child;
  document: ConsentDocumentSummary;
  timeZone: TimeZone;
  onCancel: () => void;
  onSigned: () => Promise<void>;
  onFailed: () => Promise<void>;
}) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { child, document } = props;
  const text = useQuery(consentDocumentQuery(api, active.selection, document.id));
  // One id per signature: a retry after a lost answer does not sign twice (ADR 0032).
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [accepted, setAccepted] = useState(false);
  const [mustAccept, setMustAccept] = useState(false);
  const checkboxId = useId();
  const errorId = useId();

  const sign = useMutation({
    mutationFn: () =>
      api.signConsent({
        params: { playerId: child.playerId },
        body: { clientUuid, documentId: document.id },
      }),
    onSuccess: props.onSigned,
    onError: () => void props.onFailed(),
  });

  const relationship = t(`guardian.relationship.${child.relationship}`).toLowerCase();

  return (
    <form
      className="sp-form"
      aria-label={document.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (!accepted) {
          setMustAccept(true);
          return;
        }
        sign.mutate();
      }}
      noValidate
    >
      <div>
        <h4 className="sp-row__title">{document.title}</h4>
        <p className="sp-meta">
          {t('guardian.consents.documentVersion', {
            version: document.version,
            date: formatDate(instant(document.publishedAt), { timeZone: props.timeZone }),
          })}
        </p>
      </div>
      {text.isPending ? <Loading /> : null}
      {text.isError ? <ErrorNotice error={text.error} /> : null}
      {text.data === undefined ? null : (
        <div className="sp-document" tabIndex={0} aria-label={document.title}>
          {text.data.body
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph, index) => (
              // Paragraphs of an immutable text: the index is a stable key.
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      )}
      <div className="sp-field">
        <label className="sp-check" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={accepted}
            disabled={text.data === undefined}
            aria-invalid={mustAccept && !accepted ? true : undefined}
            aria-describedby={mustAccept && !accepted ? errorId : undefined}
            onChange={(event) => {
              setAccepted(event.target.checked);
            }}
          />
          <span>{t('guardian.consents.accept', { relationship, name: fullName(child) })}</span>
        </label>
        {mustAccept && !accepted ? (
          <p id={errorId} className="sp-field__error">
            <span>{t('guardian.consents.mustAccept')}</span>
          </p>
        ) : null}
      </div>
      {sign.isError ? <ErrorNotice error={sign.error} /> : null}
      <div className="sp-row__actions">
        <Button type="submit" disabled={sign.isPending || text.data === undefined}>
          {sign.isPending ? t('guardian.consents.signing') : t('guardian.consents.sign')}
        </Button>
        <Button variant="ghost" onClick={props.onCancel} disabled={sign.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Every signature, current and revoked; loaded when opened. */
function ConsentHistory(props: { child: Child }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const [open, setOpen] = useState(false);
  const history = useQuery({
    ...childConsentHistoryQuery(api, active.selection, props.child.playerId),
    enabled: open,
  });
  const timeZone = active.club.timeZone;
  return (
    <details
      className="sp-history"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>{t('guardian.consents.history.title')}</summary>
      {open && history.isPending ? <Loading /> : null}
      {history.isError ? <ErrorNotice error={history.error} /> : null}
      {history.data === undefined ? null : history.data.length === 0 ? (
        <p>{t('guardian.consents.history.none')}</p>
      ) : (
        <ul className="sp-row-list">
          {history.data.map((consent) => (
            <li key={consent.id} className="sp-meta">
              {t('guardian.consents.history.item', {
                type: t(`guardian.consents.type.${consent.type}`),
                version: consent.documentVersion,
                signer: consent.signerKind,
                date: formatDate(instant(consent.signedAt), { timeZone }),
              })}{' '}
              ·{' '}
              {consent.revokedAt === null ? (
                <StatusLabel level="ok">{t('guardian.consents.history.notRevoked')}</StatusLabel>
              ) : (
                <StatusLabel level="critical">
                  {t('guardian.consents.history.revokedOn', {
                    date: formatDate(instant(consent.revokedAt), { timeZone }),
                  })}
                </StatusLabel>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
