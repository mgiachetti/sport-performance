import { MEMBER_STATUSES, type Member, type MemberStatus } from '@sport-performance/contracts';
import { MEMBERSHIP_ROLES, type MembershipRole } from '@sport-performance/domain';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import {
  ActionError,
  AdminSection,
  ConfirmAction,
  LoadMore,
  isConflict,
  useClubFormat,
} from './parts';
import { adminKey, membersQuery, type MemberFilters } from './queries';

/** Roles a staff membership can move between (players and guardians are tied to a player). */
export const STAFF_MEMBER_ROLES = ['coach', 'sc', 'medical', 'admin'] as const;

function isStaffMemberRole(role: MembershipRole): boolean {
  return (STAFF_MEMBER_ROLES as readonly MembershipRole[]).includes(role);
}

/**
 * Users and roles of the club (B-411 over B-314): who belongs with which
 * role and since when. A role change ends the membership (and its staff
 * assignments) and opens another; ending one is how someone leaves.
 */
export function MembersSection() {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const [filters, setFilters] = useState<MemberFilters>({ role: null, status: 'active', q: '' });
  const [q, setQ] = useState('');
  const members = useInfiniteQuery(membersQuery(api, selection, filters));
  const items = members.data?.pages.flatMap((page) => page.items) ?? [];

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'members') }),
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'assignments') }),
    ]);

  const search = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters((current) => ({ ...current, q: q.trim() }));
  };

  return (
    <AdminSection
      id="admin-members"
      title={t('admin.members.title')}
      intro={t('admin.members.intro')}
    >
      <form
        className="sp-filters"
        onSubmit={search}
        role="search"
        aria-label={t('admin.members.filters')}
      >
        <SelectField
          label={t('admin.members.role')}
          value={filters.role ?? ''}
          options={[
            { value: '', label: t('admin.members.allRoles') },
            ...MEMBERSHIP_ROLES.map((role) => ({ value: role, label: t(`role.${role}`) })),
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((current) => ({
              ...current,
              role: value === '' ? null : (value as MembershipRole),
            }));
          }}
        />
        <SelectField
          label={t('admin.members.status')}
          value={filters.status}
          options={[...MEMBER_STATUSES, 'all' as const].map((status) => ({
            value: status,
            label: t(`admin.members.status.${status}`),
          }))}
          onChange={(event) => {
            const value = event.target.value as MemberStatus | 'all';
            setFilters((current) => ({ ...current, status: value }));
          }}
        />
        <TextField
          label={t('admin.members.search')}
          type="search"
          maxLength={120}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        <div className="sp-admin__filter-submit">
          <Button type="submit" variant="secondary">
            {t('common.search')}
          </Button>
        </div>
      </form>

      {members.isPending ? <Loading /> : null}
      {members.isError ? <ErrorNotice error={members.error} /> : null}
      {members.isSuccess && items.length === 0 ? (
        <Notice level="info" role="status">
          <p>{t('admin.members.empty')}</p>
        </Notice>
      ) : null}
      {items.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('admin.members.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.members.person')}</th>
                <th scope="col">{t('admin.members.role')}</th>
                <th scope="col">{t('admin.members.status')}</th>
                <th scope="col" className="sp-table__number">
                  {t('admin.members.since')}
                </th>
                <th scope="col">{t('admin.members.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <MemberRow key={member.id} member={member} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore
        hasNextPage={members.hasNextPage}
        isFetchingNextPage={members.isFetchingNextPage}
        fetchNextPage={members.fetchNextPage}
      />
    </AdminSection>
  );
}

function MemberRow(props: { member: Member; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const format = useClubFormat();
  const { member } = props;
  const own = active.membership?.id === member.id;
  const [role, setRole] = useState<MembershipRole>(member.role);

  const changeRole = useMutation({
    mutationFn: (next: MembershipRole) =>
      api.changeMemberRole({
        params: { membershipId: member.id },
        body: { version: member.version, role: next },
      }),
    onSettled: props.onChanged,
  });
  const end = useMutation({
    mutationFn: () => api.endMember({ params: { membershipId: member.id } }),
    onSettled: props.onChanged,
  });
  const error = changeRole.error ?? end.error;
  const name = member.user.name.trim();
  const ended = member.status === 'ended';

  return (
    <tr>
      <th scope="row">
        <span className="sp-admin__name">{name === '' ? member.user.email : name}</span>
        {name === '' ? null : <span className="sp-admin__meta">{member.user.email}</span>}
        {own ? <span className="sp-admin__meta">{t('admin.members.you')}</span> : null}
      </th>
      <td className="sp-admin__nowrap">{t(`role.${member.role}`)}</td>
      <td>
        {ended ? (
          <StatusLabel level="info">
            {t('admin.members.endedOn', { date: format.dateTime(member.endedAt) })}
          </StatusLabel>
        ) : (
          <StatusLabel level="ok">{t('admin.members.status.active')}</StatusLabel>
        )}
      </td>
      <td className="sp-table__number">{format.dateTime(member.startedAt)}</td>
      <td>
        {ended || own ? (
          <span className="sp-admin__meta">
            {own ? t('admin.members.ownHint') : t('common.notAvailable')}
          </span>
        ) : (
          <div className="sp-admin__row-actions">
            {isStaffMemberRole(member.role) ? (
              <div className="sp-admin__inline">
                <SelectField
                  hideLabel
                  label={t('admin.members.newRole', {
                    name: name === '' ? member.user.email : name,
                  })}
                  value={role}
                  options={STAFF_MEMBER_ROLES.map((value) => ({
                    value,
                    label: t(`role.${value}`),
                  }))}
                  onChange={(event) => {
                    setRole(event.target.value as MembershipRole);
                  }}
                />
                <ConfirmAction
                  label={t('admin.members.changeRole')}
                  question={t('admin.members.changeRoleQuestion', {
                    role: t(`role.${role}`),
                  })}
                  disabled={role === member.role}
                  pending={changeRole.isPending}
                  onConfirm={() => {
                    changeRole.mutate(role);
                  }}
                />
              </div>
            ) : null}
            <ConfirmAction
              label={t('admin.members.end')}
              question={t('admin.members.endQuestion')}
              pending={end.isPending}
              onConfirm={() => {
                end.mutate();
              }}
            />
          </div>
        )}
        <ActionError
          error={error}
          conflictText={translate(
            t,
            isConflict(error) && member.role === 'admin'
              ? 'admin.members.conflictAdmin'
              : 'admin.conflict',
          )}
        />
      </td>
    </tr>
  );
}
