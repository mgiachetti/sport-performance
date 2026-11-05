import { MEMBER_STATUSES, type Member, type MemberStatus } from '@sport-performance/contracts';
import { MEMBERSHIP_ROLES, type MembershipRole } from '@sport-performance/domain';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import {
  ActionError,
  AdminSection,
  ConfirmAction,
  ConfirmPanel,
  LoadMore,
  isConflict,
  useClubFormat,
} from './parts';
import { activeAdminsQuery, adminKey, membersQuery, type MemberFilters } from './queries';

/** Roles a staff membership can move between (players and guardians are tied to a player). */
export const STAFF_MEMBER_ROLES = ['coach', 'sc', 'medical', 'admin'] as const;

function isStaffMemberRole(role: MembershipRole): boolean {
  return (STAFF_MEMBER_ROLES as readonly MembershipRole[]).includes(role);
}

/** Roles whose access is sensitive: the whole club (`admin`) or minors' health data (`medical`). */
const SENSITIVE_ROLES: readonly MembershipRole[] = ['admin', 'medical'];

type AccessChange = 'fromAdmin' | 'fromMedical' | 'toAdmin' | 'toMedical';

/**
 * What access a role change gives or takes, in the order it is said: a
 * change to or from `admin` or `medical` asks for confirmation with these
 * lines; any other change (between coach and S&C) saves directly.
 */
export function accessChanges(from: MembershipRole, to: MembershipRole): readonly AccessChange[] {
  if (from === to) return [];
  const changes: AccessChange[] = [];
  if (from === 'admin') changes.push('fromAdmin');
  if (from === 'medical') changes.push('fromMedical');
  if (to === 'admin') changes.push('toAdmin');
  if (to === 'medical') changes.push('toMedical');
  return changes;
}

export function isSensitiveRoleChange(from: MembershipRole, to: MembershipRole): boolean {
  return from !== to && (SENSITIVE_ROLES.includes(from) || SENSITIVE_ROLES.includes(to));
}

function memberLabel(member: Member): string {
  const name = member.user.name.trim();
  return name === '' ? member.user.email : name;
}

/** How long "Guardado" stays after a role change. */
export const ROLE_SAVED_MS = 4000;

/**
 * The role just saved: the membership changed (`from`) and the one the
 * change opened (`to`, which takes the focus back when the list shows it).
 */
interface SavedRole {
  readonly from: string;
  readonly to: string;
  readonly name: string;
  readonly role: MembershipRole;
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
  // The API never leaves the club without an active admin (409): the last
  // one shows why it cannot change instead of failing on save.
  const admins = useQuery(activeAdminsQuery(api, selection));
  const onlyAdmin = admins.data?.items.length === 1 ? admins.data.items[0]?.id : undefined;
  const [saved, setSaved] = useState<SavedRole | null>(null);
  useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(() => {
      setSaved(null);
    }, ROLE_SAVED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [saved]);

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

      {/* Saved, and the list (a role filter) no longer shows the person: say it above it. */}
      <div role="status" aria-live="polite" className="sp-admin__saved">
        {saved !== null && !items.some((m) => m.id === saved.from || m.id === saved.to) ? (
          <Notice level="ok">
            <p>
              {t('admin.members.roleSavedOutside', {
                name: saved.name,
                role: t(`role.${saved.role}`),
              })}
            </p>
          </Notice>
        ) : null}
      </div>
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
                <MemberRow
                  key={member.id}
                  member={member}
                  lastAdmin={onlyAdmin === member.id}
                  saved={saved !== null && (saved.from === member.id || saved.to === member.id)}
                  focusRole={saved?.to === member.id}
                  onSaved={(next) => {
                    setSaved({
                      from: member.id,
                      to: next.id,
                      name: memberLabel(member),
                      role: next.role,
                    });
                  }}
                  onChanged={refresh}
                />
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

function MemberRow(props: {
  member: Member;
  /** The only active admin of the club: the API would refuse to change or end it. */
  lastAdmin: boolean;
  /** Its role was just saved: "Guardado" for a few seconds. */
  saved: boolean;
  /** Give the role select the focus (the membership a role change opened). */
  focusRole: boolean;
  onSaved: (next: Member) => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const format = useClubFormat();
  const { member } = props;
  const own = active.membership?.id === member.id;
  const [role, setRole] = useState<MembershipRole>(member.role);
  const [confirming, setConfirming] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const reasonId = useId();

  const changeRole = useMutation({
    mutationFn: (next: MembershipRole) =>
      api.changeMemberRole({
        params: { membershipId: member.id },
        body: { version: member.version, role: next },
      }),
    onSuccess: props.onSaved,
    onSettled: props.onChanged,
  });
  const end = useMutation({
    mutationFn: () => api.endMember({ params: { membershipId: member.id } }),
    onSettled: props.onChanged,
  });

  const focusRole = props.focusRole;
  useEffect(() => {
    if (focusRole) selectRef.current?.focus();
  }, [focusRole]);

  const name = member.user.name.trim();
  const label = memberLabel(member);
  const ended = member.status === 'ended';
  const editable = !ended && isStaffMemberRole(member.role);
  const locked = own || props.lastAdmin;
  // Saved: the old membership shows the new role until the list is read again.
  const changed = role !== member.role && !changeRole.isSuccess;

  const restore = () => {
    setRole(member.role);
    setConfirming(false);
    changeRole.reset();
    selectRef.current?.focus();
  };
  const save = () => {
    setConfirming(false);
    changeRole.mutate(role, {
      onSettled: () => {
        selectRef.current?.focus();
      },
    });
  };

  const reason = own
    ? t('admin.members.ownHint')
    : props.lastAdmin
      ? t('admin.members.lastAdminHint')
      : null;

  return (
    <tr>
      <th scope="row">
        <span className="sp-admin__name">{label}</span>
        {name === '' ? null : <span className="sp-admin__meta">{member.user.email}</span>}
        {own ? <span className="sp-admin__meta">{t('admin.members.you')}</span> : null}
      </th>
      <td className={editable ? 'sp-admin__role-cell' : undefined}>
        {editable ? (
          <div className="sp-admin__role">
            <div className="sp-admin__role-edit">
              <SelectField
                ref={selectRef}
                hideLabel
                label={t('admin.members.roleOf', { name: label })}
                value={role}
                disabled={locked || changeRole.isPending || changeRole.isSuccess}
                aria-describedby={reason === null ? undefined : reasonId}
                data-changed={changed ? 'true' : undefined}
                options={STAFF_MEMBER_ROLES.map((value) => ({
                  value,
                  label: t(`role.${value}`),
                }))}
                onChange={(event) => {
                  setRole(event.target.value as MembershipRole);
                  setConfirming(false);
                  changeRole.reset();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && changed) {
                    event.preventDefault();
                    restore();
                  }
                }}
              />
              {changed && !confirming ? (
                <div className="sp-admin__role-actions">
                  <Button
                    size="sm"
                    disabled={changeRole.isPending}
                    onClick={() => {
                      if (isSensitiveRoleChange(member.role, role)) setConfirming(true);
                      else save();
                    }}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={changeRole.isPending}
                    onClick={restore}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : null}
            </div>
            {changed && confirming ? (
              <ConfirmPanel
                label={t('admin.members.confirmRole', { name: label, role: t(`role.${role}`) })}
                question={
                  <>
                    <strong>
                      {t('admin.members.confirmRole', { name: label, role: t(`role.${role}`) })}
                    </strong>{' '}
                    {accessChanges(member.role, role)
                      .map((change) => t(`admin.members.confirmRole.${change}`))
                      .join(' ')}
                  </>
                }
                confirmLabel={t('admin.members.changeRole')}
                pending={changeRole.isPending}
                autoFocus
                onConfirm={save}
                onCancel={restore}
              />
            ) : null}
            {reason === null ? null : (
              <span id={reasonId} className="sp-admin__meta">
                {reason}
              </span>
            )}
            <span role="status" aria-live="polite" className="sp-admin__role-status">
              {props.saved ? (
                <StatusLabel level="ok">{t('admin.members.roleSaved')}</StatusLabel>
              ) : null}
            </span>
            <ActionError
              error={changeRole.error}
              conflictText={translate(
                t,
                member.role === 'admin' ? 'admin.members.conflictAdmin' : 'admin.conflict',
              )}
            />
          </div>
        ) : (
          t(`role.${member.role}`)
        )}
      </td>
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
        {ended ? (
          <span className="sp-admin__meta">{t('common.notAvailable')}</span>
        ) : own ? null : (
          <ConfirmAction
            label={t('admin.members.end')}
            question={t('admin.members.endQuestion')}
            variant="ghost"
            size="sm"
            disabled={props.lastAdmin}
            describedBy={props.lastAdmin && editable ? reasonId : undefined}
            pending={end.isPending}
            onConfirm={() => {
              end.mutate();
            }}
          />
        )}
        <ActionError
          error={end.error}
          conflictText={translate(
            t,
            isConflict(end.error) && member.role === 'admin'
              ? 'admin.members.conflictAdmin'
              : 'admin.conflict',
          )}
        />
      </td>
    </tr>
  );
}
