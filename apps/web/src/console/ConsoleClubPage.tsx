import {
  ApiError,
  emailSchema,
  type Club,
  type ClubBranch,
  type ClubModuleSettings,
} from '@sport-performance/contracts';
import {
  CLUB_MODULES,
  SEXES,
  SPORTS,
  type ClubId,
  type ClubModule,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { formatDate, type MessageKey } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { translate, useT } from '../i18n/i18n';
import { CheckboxField } from '../ui/choice';
import { Button, ErrorNotice, Loading, Notice, Page, TextField } from '../ui/components';
import { SelectField } from '../ui/fields';
import { Icon } from '../ui/icons';
import { clubSupportHeaders } from './console-reason';
import { useConsole } from './ConsoleLayout';
import {
  consoleClubBranchesQuery,
  consoleClubInvitationsQuery,
  consoleClubModulesQuery,
  consoleClubProfileQuery,
  consoleKeys,
} from './queries';

const route = getRouteApi('/_authed/console/clubs/$clubId');

/**
 * One club as the superadmin supports it (B-414): profile, branches, active
 * modules and the invitation of its administration. Every request carries
 * `X-Support-Club-Id` and the session's reason, so each one is recorded in
 * the support access log; the API authorizes them with the matrix as for
 * the club's own `admin` (ADR 0025).
 */
export function ConsoleClubPage() {
  const t = useT();
  const { clubId } = route.useParams();
  const { api, reason } = useConsole();
  const profile = useQuery(consoleClubProfileQuery(api, reason, clubId));

  if (profile.isPending) return <Loading />;
  if (profile.isError) {
    return (
      <Page title={t('console.club.profile')}>
        <ErrorNotice
          error={profile.error}
          action={
            <Button variant="secondary" onClick={() => void profile.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Page>
    );
  }
  const club = profile.data;
  return (
    <Page title={club.name} subtitle={club.slug} actions={<EnterSupport club={club} />}>
      <ProfileSection club={club} />
      <BranchesSection clubId={clubId} />
      <ModulesSection clubId={clubId} />
      <AdministrationSection clubId={clubId} timeZone={club.timeZone} />
      <p className="sp-card">
        <Link to="/console/support-access" search={{ clubId }}>
          {t('console.club.supportAccess.link')}
        </Link>
      </p>
    </Page>
  );
}

/** Into the club's own screens in support mode, with the same reason. */
function EnterSupport(props: { club: Club }) {
  const t = useT();
  const { reason } = useConsole();
  const { selection, queryClient } = useServices();
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        selection.select({ kind: 'support', clubId: props.club.id, reason });
        queryClient.removeQueries({ queryKey: ['club'] });
        void navigate({ to: '/' });
      }}
    >
      <Icon name="support" />
      <span>{t('console.club.enterSupport', { clubName: props.club.name })}</span>
    </Button>
  );
}

function ProfileSection(props: { club: Club }) {
  const t = useT();
  const { club } = props;
  const rows: [MessageKey, string][] = [
    ['console.club.field.name', club.name],
    ['console.club.field.shortName', club.shortName],
    ['console.club.field.slug', club.slug],
    ['console.club.field.timeZone', club.timeZone],
    [
      'console.club.field.locale',
      translate(t, `console.locale.${club.locale.replace('-', '_')}` as MessageKey),
    ],
    [
      'console.club.field.colors',
      [
        t('console.club.color', {
          name: t('console.newClub.colors.primary'),
          hex: club.colors.primary,
        }),
        t('console.club.color', {
          name: t('console.newClub.colors.secondary'),
          hex: club.colors.secondary,
        }),
      ].join(' · '),
    ],
    [
      'console.club.field.createdAt',
      formatDate(new Date(club.createdAt), { timeZone: club.timeZone }),
    ],
  ];
  return (
    <section className="sp-card" aria-labelledby="console-club-profile">
      <h2 id="console-club-profile" className="sp-card__title">
        {t('console.club.profile')}
      </h2>
      <dl className="sp-definitions">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{translate(t, label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function branchName(t: ReturnType<typeof useT>, branch: { sport: Sport; sex: Sex }): string {
  return t('console.branch.name', {
    sport: t(`sport.${branch.sport}`),
    sex: t(`sex.${branch.sex}`),
  });
}

function BranchesSection(props: { clubId: ClubId }) {
  const t = useT();
  const { api, reason } = useConsole();
  const queryClient = useQueryClient();
  const branches = useQuery(consoleClubBranchesQuery(api, reason, props.clubId));
  const headers = clubSupportHeaders(props.clubId, reason);
  const [adding, setAdding] = useState('');
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [...consoleKeys.club(props.clubId), 'branches'] });

  const toggle = useMutation({
    mutationFn: (branch: ClubBranch) =>
      branch.archivedAt === null
        ? api.archiveClubBranch({ params: { branchId: branch.id } }, { headers })
        : api.restoreClubBranch({ params: { branchId: branch.id } }, { headers }),
    onSuccess: refresh,
  });
  const enable = useMutation({
    mutationFn: (branch: { sport: Sport; sex: Sex }) =>
      api.enableClubBranch({ body: { clientUuid, ...branch } }, { headers }),
    onSuccess: async () => {
      setAdding('');
      setClientUuid(crypto.randomUUID());
      await refresh();
    },
  });

  const existing = new Set((branches.data ?? []).map((b) => `${b.sport}:${b.sex}`));
  const missing = SPORTS.flatMap((sport) => SEXES.map((sex) => ({ sport, sex }))).filter(
    (b) => !existing.has(`${b.sport}:${b.sex}`),
  );

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branch = missing.find((b) => `${b.sport}:${b.sex}` === adding);
    if (branch !== undefined) enable.mutate(branch);
  };

  return (
    <section className="sp-card" aria-labelledby="console-club-branches">
      <h2 id="console-club-branches" className="sp-card__title">
        {t('console.club.branches.title')}
      </h2>
      {branches.isPending ? <Loading /> : null}
      {branches.isError ? <ErrorNotice error={branches.error} /> : null}
      {branches.data === undefined || branches.data.length === 0 ? null : (
        <table className="sp-table">
          <caption className="sp-visually-hidden">{t('console.club.branches.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('console.club.branches.column.branch')}</th>
              <th scope="col">{t('console.club.branches.column.status')}</th>
              <th scope="col">{t('console.club.branches.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {branches.data.map((branch) => {
              const archived = branch.archivedAt !== null;
              const label = branchName(t, branch);
              return (
                <tr key={branch.id}>
                  <th scope="row">{label}</th>
                  <td>
                    <span className={`sp-status sp-status--${archived ? 'info' : 'ok'}`}>
                      <Icon name={archived ? 'info' : 'ok'} />
                      <span>
                        {archived
                          ? t('console.club.branches.status.archived')
                          : t('console.club.branches.status.active')}
                      </span>
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      disabled={toggle.isPending}
                      onClick={() => {
                        toggle.mutate(branch);
                      }}
                    >
                      {archived
                        ? t('console.club.branches.restore', { branch: label })
                        : t('console.club.branches.archive', { branch: label })}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {toggle.isError ? <ErrorNotice error={toggle.error} /> : null}
      {branches.isSuccess && missing.length === 0 ? (
        <p className="sp-field__help">{t('console.club.branches.allEnabled')}</p>
      ) : null}
      {branches.isSuccess && missing.length > 0 ? (
        <form className="sp-filters" onSubmit={submit}>
          <SelectField
            label={t('console.club.branches.add.label')}
            help={t('console.club.branches.add.help')}
            name="branch"
            value={adding}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
            options={[
              { value: '', label: '—' },
              ...missing.map((branch) => ({
                value: `${branch.sport}:${branch.sex}`,
                label: branchName(t, branch),
              })),
            ]}
          />
          <Button type="submit" variant="secondary" disabled={adding === '' || enable.isPending}>
            {t('console.club.branches.add.submit')}
          </Button>
        </form>
      ) : null}
      {enable.isError ? <ErrorNotice error={enable.error} /> : null}
    </section>
  );
}

type ModuleState = Readonly<Record<ClubModule, boolean>>;

function ModulesSection(props: { clubId: ClubId }) {
  const t = useT();
  const { api, reason } = useConsole();
  const queryClient = useQueryClient();
  const modulesKey = [...consoleKeys.club(props.clubId), 'modules'] as const;
  const modules = useQuery(consoleClubModulesQuery(api, reason, props.clubId));
  const [draft, setDraft] = useState<ModuleState | null>(null);
  const [notice, setNotice] = useState<'saved' | 'unchanged' | 'conflict' | null>(null);

  const save = useMutation({
    mutationFn: (input: { version: string; modules: Partial<Record<ClubModule, boolean>> }) =>
      api.updateClubModules({ body: input }, { headers: clubSupportHeaders(props.clubId, reason) }),
    onSuccess: (saved: ClubModuleSettings) => {
      queryClient.setQueryData(modulesKey, saved);
      setDraft(null);
      setNotice('saved');
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'conflict') {
        setDraft(null);
        setNotice('conflict');
        await queryClient.invalidateQueries({ queryKey: modulesKey });
      }
    },
  });

  if (modules.isPending) {
    return (
      <section className="sp-card" aria-labelledby="console-club-modules">
        <h2 id="console-club-modules" className="sp-card__title">
          {t('console.club.modules.title')}
        </h2>
        <Loading />
      </section>
    );
  }
  if (modules.isError) {
    return (
      <section className="sp-card" aria-labelledby="console-club-modules">
        <h2 id="console-club-modules" className="sp-card__title">
          {t('console.club.modules.title')}
        </h2>
        <ErrorNotice error={modules.error} />
      </section>
    );
  }
  const current = modules.data.modules;
  const shown = draft ?? current;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const changed = Object.fromEntries(
      CLUB_MODULES.filter((module) => shown[module] !== current[module]).map((module) => [
        module,
        shown[module],
      ]),
    ) as Partial<Record<ClubModule, boolean>>;
    if (Object.keys(changed).length === 0) {
      setNotice('unchanged');
      return;
    }
    setNotice(null);
    save.mutate({ version: modules.data.version, modules: changed });
  };

  return (
    <section className="sp-card" aria-labelledby="console-club-modules">
      <h2 id="console-club-modules" className="sp-card__title">
        {t('console.club.modules.title')}
      </h2>
      <p className="sp-field__help">{t('console.club.modules.help')}</p>
      <form className="sp-form" onSubmit={submit}>
        {CLUB_MODULES.map((module) => (
          <CheckboxField
            key={module}
            label={translate(t, `console.module.${module}` as MessageKey)}
            checked={shown[module]}
            onChange={(event) => {
              setNotice(null);
              setDraft({ ...shown, [module]: event.target.checked });
            }}
          />
        ))}
        {notice === 'saved' ? (
          <Notice level="ok" role="status">
            <p>{t('console.club.modules.saved')}</p>
          </Notice>
        ) : null}
        {notice === 'unchanged' ? (
          <Notice level="info" role="status">
            <p>{t('console.club.modules.unchanged')}</p>
          </Notice>
        ) : null}
        {notice === 'conflict' ? (
          <Notice level="warning" role="alert">
            <p>{t('console.club.modules.conflict')}</p>
          </Notice>
        ) : null}
        {save.isError && !(save.error instanceof ApiError && save.error.code === 'conflict') ? (
          <ErrorNotice error={save.error} />
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {t('console.club.modules.save')}
        </Button>
      </form>
    </section>
  );
}

function AdministrationSection(props: { clubId: ClubId; timeZone: Club['timeZone'] }) {
  const t = useT();
  const { api, reason } = useConsole();
  const queryClient = useQueryClient();
  const headers = clubSupportHeaders(props.clubId, reason);
  const invitationsKey = [...consoleKeys.club(props.clubId), 'invitations'] as const;
  const invitations = useQuery(consoleClubInvitationsQuery(api, reason, props.clubId));
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (to: string) =>
      api.createInvitation({ body: { email: to, role: 'admin' } }, { headers }),
    onSuccess: async (created) => {
      setSentTo(created.invitation.email);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: invitationsKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api.revokeInvitation({ params: { invitationId } }, { headers }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey }),
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError(t('console.newClub.error.invalid'));
      return;
    }
    setError(null);
    setSentTo(null);
    invite.mutate(parsed.data);
  };

  return (
    <section className="sp-card" aria-labelledby="console-club-admins">
      <h2 id="console-club-admins" className="sp-card__title">
        {t('console.club.admins.title')}
      </h2>
      <p className="sp-field__help">{t('console.club.admins.help')}</p>
      <form className="sp-filters" onSubmit={submit} noValidate>
        <TextField
          label={t('console.club.admins.email')}
          type="email"
          name="email"
          autoComplete="off"
          required
          value={email}
          error={error}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Button type="submit" disabled={invite.isPending}>
          {t('console.club.admins.invite')}
        </Button>
      </form>
      {sentTo === null ? null : (
        <Notice level="ok" role="status">
          <p>{t('console.club.admins.sent', { email: sentTo })}</p>
        </Notice>
      )}
      {invite.isError ? <ErrorNotice error={invite.error} /> : null}
      <h3 className="sp-card__subtitle">{t('console.club.invitations.title')}</h3>
      {invitations.isPending ? <Loading /> : null}
      {invitations.isError ? <ErrorNotice error={invitations.error} /> : null}
      {invitations.data?.length === 0 ? <p>{t('console.club.invitations.none')}</p> : null}
      {invitations.data === undefined || invitations.data.length === 0 ? null : (
        <ul className="sp-plain-list">
          {invitations.data.map((invitation) => (
            <li key={invitation.id} className="sp-plain-list__item">
              <span>
                {t('console.club.invitations.item', {
                  email: invitation.email,
                  role: t(`role.${invitation.role}`),
                  date: formatDate(new Date(invitation.expiresAt), { timeZone: props.timeZone }),
                })}
              </span>
              <Button
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => {
                  revoke.mutate(invitation.id);
                }}
              >
                {t('console.club.invitations.revoke', { email: invitation.email })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
    </section>
  );
}
