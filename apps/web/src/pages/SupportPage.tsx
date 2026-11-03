import type { Club } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import {
  SUPPORT_REASON_MAX_LENGTH,
  normalizeSupportReason,
  supportReasonHeader,
} from '../api/club-selection';
import { supportClubsQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { StandaloneLayout } from '../layout/RootLayout';
import { Button, ErrorNotice, Loading, Notice, Page, TextField } from '../ui/components';
import { Icon } from '../ui/icons';

const route = getRouteApi('/_authed/support');

/**
 * Support mode of the superadmin (ADR 0029, ADR 0032): a reason first, then
 * a club of the registry. From then on every request carries
 * `X-Support-Club-Id` and `X-Support-Reason`, and the API records the access.
 */
export function SupportPage() {
  const t = useT();
  const { api, queryClient, selection } = useServices();
  const search = route.useSearch();
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ reason: string; q: string } | null>(null);

  const clubs = useQuery({
    ...supportClubsQuery(api, supportReasonHeader(submitted?.reason ?? ''), submitted?.q ?? ''),
    enabled: submitted !== null,
  });

  const searchClubs = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeSupportReason(reason);
    if (normalized === null) {
      setReasonError(t('support.reason.required'));
      return;
    }
    setReasonError(null);
    setSubmitted({ reason: normalized, q: q.trim() });
  };

  const enter = async (club: Club) => {
    if (submitted === null) return;
    selection.select({ kind: 'support', clubId: club.id, reason: submitted.reason });
    queryClient.removeQueries({ queryKey: ['club'] });
    await navigate({ href: search.redirect ?? '/' });
  };

  return (
    <StandaloneLayout>
      <Page title={t('support.title')} subtitle={t('support.intro')}>
        <form className="sp-form" onSubmit={searchClubs} noValidate>
          <TextField
            label={t('support.reason.label')}
            help={t('support.reason.help')}
            name="reason"
            required
            maxLength={SUPPORT_REASON_MAX_LENGTH}
            value={reason}
            error={reasonError}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <TextField
            label={t('support.search.label')}
            name="q"
            type="search"
            maxLength={120}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
          <Button type="submit">{t('support.search.submit')}</Button>
        </form>
        {clubs.isFetching ? <Loading /> : null}
        {clubs.isError ? <ErrorNotice error={clubs.error} /> : null}
        {clubs.data === undefined ? null : clubs.data.items.length === 0 ? (
          <Notice level="info" role="status">
            <p>{t('support.noClubs')}</p>
          </Notice>
        ) : (
          <ul className="sp-choice-list">
            {clubs.data.items.map((club) => (
              <li key={club.id}>
                <button type="button" className="sp-choice" onClick={() => void enter(club)}>
                  <Icon name="support" />
                  <span>{t('support.enter', { clubName: club.name })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </StandaloneLayout>
  );
}
