import {
  STAFF_ASSIGNMENT_STATUS_FILTERS,
  type Category,
  type StaffAssignment,
  type StaffAssignmentStatusFilter,
} from '@sport-performance/contracts';
import {
  SPORTS,
  isLocalDate,
  type CategoryId,
  type LocalDate,
  type Sport,
  type Uuid,
} from '@sport-performance/domain';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import {
  ActionError,
  AdminSection,
  ConfirmAction,
  LoadMore,
  useClubFormat,
  useClubToday,
} from './parts';
import {
  adminKey,
  allCategoriesQuery,
  assignableMembersQuery,
  assignmentsQuery,
  branchesQuery,
} from './queries';

const STATUS_LEVELS: Record<StaffAssignment['status'], StatusLevel | 'info'> = {
  current: 'ok',
  upcoming: 'info',
  ended: 'info',
};

export interface AssignmentDraft {
  readonly membershipId: string;
  /** `category:<id>` or `sport:<sport>`. */
  readonly target: string;
  readonly validFrom: string;
  readonly validTo: string;
}

export type AssignmentDraftError = 'member' | 'target' | 'validFrom' | 'validTo' | 'order';

/** Validation of the assignment form (the API checks again, ADR 0032). */
export function assignmentDraftErrors(draft: AssignmentDraft): AssignmentDraftError[] {
  const errors: AssignmentDraftError[] = [];
  if (draft.membershipId === '') errors.push('member');
  if (!/^(category|sport):.+/.test(draft.target)) errors.push('target');
  if (!isLocalDate(draft.validFrom)) errors.push('validFrom');
  if (draft.validTo !== '' && !isLocalDate(draft.validTo)) errors.push('validTo');
  if (isLocalDate(draft.validFrom) && isLocalDate(draft.validTo)) {
    if (draft.validTo <= draft.validFrom) errors.push('order');
  }
  return errors;
}

/** The body of `POST /v1/staff-assignments` for a valid draft. */
export function assignmentBody(draft: AssignmentDraft, clientUuid: string) {
  const [kind, value = ''] = draft.target.split(':') as [string, string | undefined];
  return {
    clientUuid,
    membershipId: draft.membershipId as Uuid,
    target:
      kind === 'sport'
        ? { kind: 'sport' as const, sport: value as Sport }
        : { kind: 'category' as const, categoryId: value as CategoryId },
    validFrom: draft.validFrom as LocalDate,
    ...(draft.validTo === '' ? {} : { validTo: draft.validTo as LocalDate }),
  };
}

function targetLabel(
  t: ReturnType<typeof useT>,
  target: StaffAssignment['target'],
  categories: readonly Category[],
): string {
  if (target.kind === 'sport') {
    return t('admin.assignments.wholeSport', { sport: t(`sport.${target.sport}`) });
  }
  const category = categories.find((c) => c.id === target.categoryId);
  return category === undefined
    ? t('common.notAvailable')
    : `${category.name} · ${t(`sport.${category.sport}`)}`;
}

/**
 * Staff assignments (B-411 over B-314): what each coach, S&C coach or
 * medical staff member sees. One category, or a whole sport (medical);
 * a validity of club days, the end excluded. Ended, never deleted.
 */
export function AssignmentsSection() {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const format = useClubFormat();
  const [status, setStatus] = useState<StaffAssignmentStatusFilter>('active');
  const assignments = useInfiniteQuery(assignmentsQuery(api, selection, status));
  const categories = useQuery(allCategoriesQuery(api, selection));
  const items = assignments.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: adminKey(selection, 'assignments') });

  return (
    <>
      <AdminSection
        id="admin-assign"
        title={t('admin.assignments.new')}
        intro={t('admin.assignments.intro')}
      >
        <AssignmentForm onCreated={refresh} />
      </AdminSection>
      <AdminSection id="admin-assignments" title={t('admin.assignments.title')}>
        <div className="sp-filters">
          <SelectField
            label={t('admin.assignments.status')}
            value={status}
            options={STAFF_ASSIGNMENT_STATUS_FILTERS.map((value) => ({
              value,
              label: t(`admin.assignments.filter.${value}`),
            }))}
            onChange={(event) => {
              setStatus(event.target.value as StaffAssignmentStatusFilter);
            }}
          />
        </div>
        {assignments.isPending ? <Loading /> : null}
        {assignments.isError ? <ErrorNotice error={assignments.error} /> : null}
        {assignments.isSuccess && items.length === 0 ? (
          <Notice level="info" role="status">
            <p>{t('admin.assignments.empty')}</p>
          </Notice>
        ) : null}
        {items.length === 0 ? null : (
          <div className="sp-table-wrap">
            <table className="sp-table">
              <caption className="sp-visually-hidden">{t('admin.assignments.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.members.person')}</th>
                  <th scope="col">{t('admin.members.role')}</th>
                  <th scope="col">{t('admin.assignments.target')}</th>
                  <th scope="col">{t('admin.assignments.validity')}</th>
                  <th scope="col">{t('admin.assignments.status')}</th>
                  <th scope="col">{t('admin.members.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    target={targetLabel(t, assignment.target, categories.data ?? [])}
                    validity={
                      assignment.validTo === null
                        ? t('admin.assignments.from', { from: format.date(assignment.validFrom) })
                        : t('admin.assignments.range', {
                            from: format.date(assignment.validFrom),
                            to: format.date(assignment.validTo),
                          })
                    }
                    onChanged={refresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore
          hasNextPage={assignments.hasNextPage}
          isFetchingNextPage={assignments.isFetchingNextPage}
          fetchNextPage={assignments.fetchNextPage}
        />
      </AdminSection>
    </>
  );
}

function AssignmentRow(props: {
  assignment: StaffAssignment;
  target: string;
  validity: string;
  onChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const { api } = useServices();
  const { assignment } = props;
  const end = useMutation({
    mutationFn: () => api.endStaffAssignment({ params: { assignmentId: assignment.id } }),
    onSettled: props.onChanged,
  });
  const name = assignment.member.name.trim();
  return (
    <tr>
      <th scope="row">{name === '' ? t('admin.assignments.noName') : name}</th>
      <td>{t(`role.${assignment.member.role}`)}</td>
      <td>{props.target}</td>
      <td>{props.validity}</td>
      <td>
        <StatusLabel level={STATUS_LEVELS[assignment.status]}>
          {t(`admin.assignments.status.${assignment.status}`)}
        </StatusLabel>
      </td>
      <td>
        {assignment.status === 'ended' ? null : (
          <ConfirmAction
            label={t('admin.assignments.end')}
            question={
              assignment.status === 'upcoming'
                ? t('admin.assignments.cancelQuestion')
                : t('admin.assignments.endQuestion')
            }
            pending={end.isPending}
            onConfirm={() => {
              end.mutate();
            }}
          />
        )}
        <ActionError error={end.error} />
      </td>
    </tr>
  );
}

function AssignmentForm(props: { onCreated: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const today = useClubToday();
  const members = useQuery(assignableMembersQuery(api, selection));
  const categories = useQuery(allCategoriesQuery(api, selection));
  const branches = useQuery(branchesQuery(api, selection));
  const [draft, setDraft] = useState<AssignmentDraft>({
    membershipId: '',
    target: '',
    validFrom: today,
    validTo: '',
  });
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const errors = assignmentDraftErrors(draft);
  const has = (error: AssignmentDraftError) => submitted && errors.includes(error);

  const sports = useMemo(
    () =>
      SPORTS.filter((sport) =>
        (branches.data ?? []).some((b) => b.sport === sport && b.archivedAt === null),
      ),
    [branches.data],
  );
  const activeCategories = (categories.data ?? []).filter((c) => c.archivedAt === null);

  const create = useMutation({
    mutationFn: () => api.createStaffAssignment({ body: assignmentBody(draft, clientUuid) }),
    onSuccess: () => {
      setDraft({ membershipId: '', target: '', validFrom: today, validTo: '' });
      setClientUuid(crypto.randomUUID());
      setSubmitted(false);
    },
    onSettled: props.onCreated,
  });

  const update = (patch: Partial<AssignmentDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    // Another assignment: a new idempotency key.
    setClientUuid(crypto.randomUUID());
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length > 0) return;
    create.mutate();
  };

  const loadError = members.error ?? categories.error ?? branches.error;

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      {loadError === null ? null : <ErrorNotice error={loadError} />}
      <div className="sp-form__row">
        <SelectField
          label={t('admin.assignments.member')}
          value={draft.membershipId}
          error={has('member') ? t('error.validation.required') : null}
          options={[
            { value: '', label: t('admin.assignments.pickMember') },
            ...(members.data ?? []).map((member) => ({
              value: member.id,
              label: `${member.user.name.trim() === '' ? member.user.email : member.user.name} · ${t(`role.${member.role}`)}`,
            })),
          ]}
          onChange={(event) => {
            update({ membershipId: event.target.value });
          }}
        />
        <SelectField
          label={t('admin.assignments.target')}
          value={draft.target}
          error={has('target') ? t('error.validation.required') : null}
          options={[
            { value: '', label: t('admin.assignments.pickTarget') },
            ...activeCategories.map((category) => ({
              value: `category:${category.id}`,
              label: `${category.name} · ${t(`sport.${category.sport}`)} · ${t(`sex.${category.sex}`)}`,
            })),
            ...sports.map((sport) => ({
              value: `sport:${sport}`,
              label: t('admin.assignments.wholeSport', { sport: t(`sport.${sport}`) }),
            })),
          ]}
          onChange={(event) => {
            update({ target: event.target.value });
          }}
        />
        <TextField
          label={t('admin.assignments.validFrom')}
          type="date"
          value={draft.validFrom}
          error={has('validFrom') ? t('error.validation.required') : null}
          onChange={(event) => {
            update({ validFrom: event.target.value });
          }}
        />
        <TextField
          label={t('admin.assignments.validTo')}
          help={t('admin.assignments.validToHelp')}
          type="date"
          value={draft.validTo}
          error={
            has('order')
              ? t('admin.assignments.orderError')
              : has('validTo')
                ? t('admin.dateInvalid')
                : null
          }
          onChange={(event) => {
            update({ validTo: event.target.value });
          }}
        />
      </div>
      {members.isSuccess && members.data.length === 0 ? (
        <Notice level="info">
          <p>{t('admin.assignments.noStaff')}</p>
        </Notice>
      ) : null}
      <ActionError error={create.error} conflictText={t('admin.assignments.conflict')} />
      {create.isSuccess ? (
        <Notice level="ok" role="status">
          <p>{t('admin.assignments.created')}</p>
        </Notice>
      ) : null}
      <div className="sp-form__actions">
        <Button type="submit" disabled={create.isPending}>
          {t('admin.assignments.assign')}
        </Button>
      </div>
    </form>
  );
}
