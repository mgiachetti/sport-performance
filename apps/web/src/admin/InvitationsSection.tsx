import {
  INVITATION_EXPIRES_IN_DAYS_DEFAULT,
  INVITATION_EXPIRES_IN_DAYS_MAX,
  INVITATION_STATUSES,
  STAFF_ROLES,
  type CreatedInvitation,
  type Invitation,
  type InvitationStatus,
} from '@sport-performance/contracts';
import { MEMBERSHIP_ROLES, type CategoryId, type MembershipRole } from '@sport-performance/domain';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { ActionError, AdminSection, ConfirmAction, LoadMore, useClubFormat } from './parts';
import { adminKey, allCategoriesQuery, invitationsQuery } from './queries';

/**
 * Roles invited from the web. Players and guardians tied to a player are
 * invited from the roster import (or the player's profile), which knows the
 * player; here they join the club without one.
 */
const INVITABLE_ROLES = MEMBERSHIP_ROLES;

const STATUS_LEVELS: Record<InvitationStatus, StatusLevel | 'info'> = {
  pending: 'warning',
  accepted: 'ok',
  revoked: 'info',
  expired: 'info',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function takesCategories(role: MembershipRole): boolean {
  return (STAFF_ROLES as readonly MembershipRole[]).includes(role);
}

/** Validation of the invitation form; `null` when it can be sent. */
export function invitationFormErrors(form: {
  email: string;
  expiresInDays: string;
}): { email?: 'required' | 'invalid'; expiresInDays?: 'range' } | null {
  const errors: { email?: 'required' | 'invalid'; expiresInDays?: 'range' } = {};
  const email = form.email.trim();
  if (email === '') errors.email = 'required';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'invalid';
  const days = Number(form.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > INVITATION_EXPIRES_IN_DAYS_MAX) {
    errors.expiresInDays = 'range';
  }
  return Object.keys(errors).length === 0 ? null : errors;
}

/**
 * Invitations (B-411 over B-309): invite by email with a role (and, for the
 * staff, the categories they will see), see what happened to each one and
 * revoke the pending ones. The link is shown once, when it is created.
 */
export function InvitationsSection() {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const [status, setStatus] = useState<InvitationStatus | null>('pending');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const invitations = useInfiniteQuery(invitationsQuery(api, selection, status));
  const items = invitations.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: adminKey(selection, 'invitations') });

  return (
    <>
      <AdminSection
        id="admin-invite"
        title={t('admin.invitations.new')}
        intro={t('admin.invitations.intro')}
      >
        <InvitationForm
          onCreated={(result) => {
            setCreated(result);
            void refresh();
          }}
        />
        {created === null ? null : <CreatedLink created={created} />}
      </AdminSection>

      <AdminSection id="admin-invitations" title={t('admin.invitations.title')}>
        <div className="sp-filters">
          <SelectField
            label={t('admin.invitations.status')}
            value={status ?? ''}
            options={[
              { value: '', label: t('admin.invitations.allStatuses') },
              ...INVITATION_STATUSES.map((value) => ({
                value,
                label: t(`admin.invitations.status.${value}`),
              })),
            ]}
            onChange={(event) => {
              const value = event.target.value;
              setStatus(value === '' ? null : (value as InvitationStatus));
            }}
          />
        </div>
        {invitations.isPending ? <Loading /> : null}
        {invitations.isError ? <ErrorNotice error={invitations.error} /> : null}
        {invitations.isSuccess && items.length === 0 ? (
          <Notice level="info" role="status">
            <p>{t('admin.invitations.empty')}</p>
          </Notice>
        ) : null}
        {items.length === 0 ? null : (
          <div className="sp-table-wrap">
            <table className="sp-table">
              <caption className="sp-visually-hidden">{t('admin.invitations.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.invitations.email')}</th>
                  <th scope="col">{t('admin.invitations.role')}</th>
                  <th scope="col">{t('admin.invitations.status')}</th>
                  <th scope="col">{t('admin.invitations.expiresAt')}</th>
                  <th scope="col">{t('admin.members.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((invitation) => (
                  <InvitationRow key={invitation.id} invitation={invitation} onChanged={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore
          hasNextPage={invitations.hasNextPage}
          isFetchingNextPage={invitations.isFetchingNextPage}
          fetchNextPage={invitations.fetchNextPage}
        />
      </AdminSection>
    </>
  );
}

function InvitationForm(props: { onCreated: (created: CreatedInvitation) => void }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const categories = useQuery(allCategoriesQuery(api, selection));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('coach');
  const [categoryIds, setCategoryIds] = useState<readonly CategoryId[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(String(INVITATION_EXPIRES_IN_DAYS_DEFAULT));
  const [submitted, setSubmitted] = useState(false);
  const errors = invitationFormErrors({ email, expiresInDays });

  const create = useMutation({
    mutationFn: () =>
      api.createInvitation({
        body: {
          email: email.trim(),
          role,
          categoryIds: takesCategories(role) ? [...categoryIds] : [],
          expiresInDays: Number(expiresInDays),
        },
      }),
    onSuccess: (result) => {
      props.onCreated(result);
      setEmail('');
      setCategoryIds([]);
      setSubmitted(false);
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors !== null) return;
    create.mutate();
  };

  const activeCategories = (categories.data ?? []).filter((c) => c.archivedAt === null);
  const showErrors = submitted && errors !== null;

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <div className="sp-form__row">
        <TextField
          label={t('admin.invitations.email')}
          type="email"
          autoComplete="off"
          required
          value={email}
          error={
            showErrors && errors.email !== undefined
              ? errors.email === 'required'
                ? t('error.validation.required')
                : t('admin.invitations.emailInvalid')
              : null
          }
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <SelectField
          label={t('admin.invitations.role')}
          value={role}
          options={INVITABLE_ROLES.map((value) => ({ value, label: t(`role.${value}`) }))}
          onChange={(event) => {
            setRole(event.target.value as MembershipRole);
          }}
        />
        <TextField
          label={t('admin.invitations.expiresInDays')}
          help={t('admin.invitations.expiresInDaysHelp', { max: INVITATION_EXPIRES_IN_DAYS_MAX })}
          inputMode="numeric"
          value={expiresInDays}
          error={
            showErrors && errors.expiresInDays !== undefined
              ? t('error.validation.range', { min: 1, max: INVITATION_EXPIRES_IN_DAYS_MAX })
              : null
          }
          onChange={(event) => {
            setExpiresInDays(event.target.value);
          }}
        />
      </div>
      {takesCategories(role) ? (
        <fieldset className="sp-fieldset sp-fieldset--nested">
          <legend className="sp-field__label">{t('admin.invitations.categories')}</legend>
          <p className="sp-field__help">{t('admin.invitations.categoriesHelp')}</p>
          {categories.isError ? <ErrorNotice error={categories.error} /> : null}
          <ul className="sp-admin__checks sp-admin__checks--columns">
            {activeCategories.map((category) => (
              <li key={category.id}>
                <label className="sp-admin__check">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(category.id)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setCategoryIds((current) =>
                        checked
                          ? [...current, category.id]
                          : current.filter((id) => id !== category.id),
                      );
                    }}
                  />
                  <span>
                    {category.name} · {t(`sport.${category.sport}`)} · {t(`sex.${category.sex}`)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : role === 'player' || role === 'parent' ? (
        <Notice level="info">
          <p>{t('admin.invitations.playerHint')}</p>
        </Notice>
      ) : null}
      <ActionError error={create.error} />
      <div className="sp-form__actions">
        <Button type="submit" disabled={create.isPending}>
          {t('admin.invitations.send')}
        </Button>
      </div>
    </form>
  );
}

function CreatedLink(props: { created: CreatedInvitation }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const { invitation, links } = props.created;
  return (
    <Notice level="ok" role="status">
      <p>{t('admin.invitations.sent', { email: invitation.email })}</p>
      <p className="sp-admin__link">
        <span>{t('admin.invitations.link')}</span> <code>{links.web}</code>
      </p>
      <p className="sp-notice__meta">{t('admin.invitations.linkOnce')}</p>
      <div className="sp-form__actions">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(links.web).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? t('admin.invitations.copied') : t('admin.invitations.copy')}
        </Button>
      </div>
    </Notice>
  );
}

function InvitationRow(props: { invitation: Invitation; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const format = useClubFormat();
  const { invitation } = props;
  const revoke = useMutation({
    mutationFn: () => api.revokeInvitation({ params: { invitationId: invitation.id } }),
    onSettled: props.onChanged,
  });
  return (
    <tr>
      <th scope="row">{invitation.email}</th>
      <td>{t(`role.${invitation.role}`)}</td>
      <td>
        <StatusLabel level={STATUS_LEVELS[invitation.status]}>
          {t(`admin.invitations.status.${invitation.status}`)}
        </StatusLabel>
      </td>
      <td>{format.dateTime(invitation.expiresAt)}</td>
      <td>
        {invitation.status === 'pending' ? (
          <ConfirmAction
            label={t('admin.invitations.revoke')}
            question={t('admin.invitations.revokeQuestion', { email: invitation.email })}
            pending={revoke.isPending}
            onConfirm={() => {
              revoke.mutate();
            }}
          />
        ) : null}
        <ActionError error={revoke.error} />
      </td>
    </tr>
  );
}
