import {
  CATEGORY_NAME_MAX_LENGTH,
  SORT_ORDER_MAX,
  type Category,
  type ClubBranch,
} from '@sport-performance/contracts';
import { DEFAULT_AGE_BANDS, SEXES, SPORTS, type Sex, type Sport } from '@sport-performance/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { categoriesQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { ActionError, AdminSection, ConfirmAction } from './parts';
import { PositionsSection } from './PositionsSection';
import { adminKey, allCategoriesQuery, branchesQuery } from './queries';

type AgeBandCode = (typeof DEFAULT_AGE_BANDS)[number]['code'];

const branchKey = (sport: Sport, sex: Sex) => `${sport}:${sex}`;

/** Branches the club could still enable (sport × sex not yet in the club). */
export function missingBranches(branches: readonly Pick<ClubBranch, 'sport' | 'sex'>[]) {
  const present = new Set(branches.map((b) => branchKey(b.sport, b.sex)));
  return SPORTS.flatMap((sport) => SEXES.map((sex) => ({ sport, sex }))).filter(
    (b) => !present.has(branchKey(b.sport, b.sex)),
  );
}

/** A sort order typed by the staff: an integer in range, or `null` (empty = the default). */
export function parseSortOrder(text: string): number | null | 'invalid' {
  const value = text.trim();
  if (value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= SORT_ORDER_MAX ? number : 'invalid';
}

/** One refresh for the section and the layout's category selector. */
function useRefreshCategories() {
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'categories') }),
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'branches') }),
      queryClient.invalidateQueries({ queryKey: categoriesQuery(api, selection).queryKey }),
    ]);
}

/**
 * Branches, categories and positions (B-411 over B-313, B-801): which
 * sports and sexes the club runs, its categories per branch and age band,
 * and the positions of its sports. The branch and
 * band of a category never change (history stays comparable): another
 * category is created. Archived, never deleted.
 */
export function CategoriesSection() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const branches = useQuery(branchesQuery(api, selection));
  const categories = useQuery(allCategoriesQuery(api, selection));

  if (branches.isPending || categories.isPending) return <Loading />;
  if (branches.isError) return <ErrorNotice error={branches.error} />;
  if (categories.isError) return <ErrorNotice error={categories.error} />;

  return (
    <>
      <BranchesSection branches={branches.data} />
      <AdminSection
        id="admin-category-new"
        title={t('admin.categories.new')}
        intro={t('admin.categories.intro')}
      >
        <CategoryForm branches={branches.data.filter((b) => b.archivedAt === null)} />
      </AdminSection>
      {branches.data.map((branch) => (
        <BranchCategories
          key={branch.id}
          branch={branch}
          categories={categories.data.filter(
            (c) => c.sport === branch.sport && c.sex === branch.sex,
          )}
        />
      ))}
      <PositionsSection branches={branches.data} />
    </>
  );
}

function BranchesSection(props: { branches: readonly ClubBranch[] }) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCategories();
  const missing = missingBranches(props.branches);
  const [choice, setChoice] = useState('');
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const enable = useMutation({
    mutationFn: (branch: { sport: Sport; sex: Sex }) =>
      api.enableClubBranch({ body: { clientUuid, ...branch } }),
    onSuccess: () => {
      setChoice('');
      setClientUuid(crypto.randomUUID());
    },
    onSettled: refresh,
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branch = missing.find((b) => branchKey(b.sport, b.sex) === choice);
    if (branch !== undefined) enable.mutate(branch);
  };

  return (
    <AdminSection
      id="admin-branches"
      title={t('admin.branches.title')}
      intro={t('admin.branches.intro')}
    >
      <div className="sp-table-wrap">
        <table className="sp-table">
          <caption className="sp-visually-hidden">{t('admin.branches.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.branches.branch')}</th>
              <th scope="col">{t('admin.categories.status')}</th>
              <th scope="col">{t('admin.members.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {props.branches.map((branch) => (
              <BranchRow key={branch.id} branch={branch} onChanged={refresh} />
            ))}
          </tbody>
        </table>
      </div>
      {missing.length === 0 ? null : (
        <form className="sp-filters" onSubmit={submit}>
          <SelectField
            label={t('admin.branches.enable')}
            value={choice}
            options={[
              { value: '', label: t('admin.branches.pick') },
              ...missing.map((b) => ({
                value: branchKey(b.sport, b.sex),
                label: `${t(`sport.${b.sport}`)} · ${t(`sex.${b.sex}`)}`,
              })),
            ]}
            onChange={(event) => {
              setChoice(event.target.value);
              setClientUuid(crypto.randomUUID());
            }}
          />
          <div className="sp-admin__filter-submit">
            <Button type="submit" disabled={choice === '' || enable.isPending}>
              {t('admin.branches.enableAction')}
            </Button>
          </div>
        </form>
      )}
      <p className="sp-field__help">{t('admin.branches.enableHelp')}</p>
      <ActionError error={enable.error} conflictText={t('admin.branches.conflict')} />
    </AdminSection>
  );
}

function BranchRow(props: { branch: ClubBranch; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const { branch } = props;
  const archive = useMutation({
    mutationFn: () => api.archiveClubBranch({ params: { branchId: branch.id } }),
    onSettled: props.onChanged,
  });
  const restore = useMutation({
    mutationFn: () => api.restoreClubBranch({ params: { branchId: branch.id } }),
    onSettled: props.onChanged,
  });
  const label = `${t(`sport.${branch.sport}`)} · ${t(`sex.${branch.sex}`)}`;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {branch.archivedAt === null ? (
          <StatusLabel level="ok">{t('admin.status.active')}</StatusLabel>
        ) : (
          <StatusLabel level="info">{t('admin.status.archived')}</StatusLabel>
        )}
      </td>
      <td>
        {branch.archivedAt === null ? (
          <ConfirmAction
            label={t('admin.archive')}
            question={t('admin.branches.archiveQuestion', { branch: label })}
            pending={archive.isPending}
            onConfirm={() => {
              archive.mutate();
            }}
          />
        ) : (
          <Button
            variant="secondary"
            disabled={restore.isPending}
            onClick={() => {
              restore.mutate();
            }}
          >
            {t('admin.restore')}
          </Button>
        )}
        <ActionError error={archive.error ?? restore.error} />
      </td>
    </tr>
  );
}

function CategoryForm(props: { branches: readonly ClubBranch[] }) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCategories();
  const [branch, setBranch] = useState('');
  const [band, setBand] = useState<AgeBandCode | ''>('');
  const [name, setName] = useState('');
  const [order, setOrder] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const sortOrder = parseSortOrder(order);
  const trimmed = name.trim();
  const invalid =
    branch === '' ||
    band === '' ||
    sortOrder === 'invalid' ||
    trimmed.length > CATEGORY_NAME_MAX_LENGTH;

  const create = useMutation({
    mutationFn: () => {
      const [sport, sex] = branch.split(':') as [Sport, Sex];
      return api.createCategory({
        body: {
          clientUuid,
          sport,
          sex,
          ageBandCode: band as AgeBandCode,
          ...(trimmed === '' ? {} : { name: trimmed }),
          ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
        },
      });
    },
    onSuccess: () => {
      setName('');
      setOrder('');
      setBand('');
      setSubmitted(false);
      setClientUuid(crypto.randomUUID());
    },
    onSettled: refresh,
  });
  const touch = () => {
    setClientUuid(crypto.randomUUID());
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid) create.mutate();
  };

  if (props.branches.length === 0) {
    return (
      <Notice level="info">
        <p>{t('admin.categories.noBranches')}</p>
      </Notice>
    );
  }

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <div className="sp-form__row">
        <SelectField
          label={t('admin.branches.branch')}
          value={branch}
          error={submitted && branch === '' ? t('error.validation.required') : null}
          options={[
            { value: '', label: t('admin.branches.pick') },
            ...props.branches.map((b) => ({
              value: branchKey(b.sport, b.sex),
              label: `${t(`sport.${b.sport}`)} · ${t(`sex.${b.sex}`)}`,
            })),
          ]}
          onChange={(event) => {
            setBranch(event.target.value);
            touch();
          }}
        />
        <SelectField
          label={t('admin.categories.ageBand')}
          value={band}
          error={submitted && band === '' ? t('error.validation.required') : null}
          options={[
            { value: '', label: t('admin.categories.pickBand') },
            ...DEFAULT_AGE_BANDS.map((b) => ({ value: b.code, label: b.label })),
          ]}
          onChange={(event) => {
            setBand(event.target.value as AgeBandCode | '');
            touch();
          }}
        />
        <TextField
          label={t('admin.categories.name')}
          help={t('admin.categories.nameHelp')}
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            touch();
          }}
        />
        <TextField
          label={t('admin.categories.order')}
          help={t('admin.categories.orderHelp')}
          inputMode="numeric"
          value={order}
          error={
            submitted && sortOrder === 'invalid'
              ? t('error.validation.range', { min: 0, max: SORT_ORDER_MAX })
              : null
          }
          onChange={(event) => {
            setOrder(event.target.value);
            touch();
          }}
        />
      </div>
      <ActionError error={create.error} conflictText={t('admin.categories.nameConflict')} />
      <div className="sp-form__actions">
        <Button type="submit" disabled={create.isPending}>
          {t('admin.categories.create')}
        </Button>
      </div>
    </form>
  );
}

function BranchCategories(props: { branch: ClubBranch; categories: readonly Category[] }) {
  const t = useT();
  const refresh = useRefreshCategories();
  const { branch } = props;
  const title = `${t(`sport.${branch.sport}`)} · ${t(`sex.${branch.sex}`)}`;
  return (
    <AdminSection
      id={`admin-categories-${branch.id}`}
      title={t('admin.categories.ofBranch', { branch: title })}
    >
      {branch.archivedAt === null ? null : (
        <Notice level="info">
          <p>{t('admin.categories.branchArchived')}</p>
        </Notice>
      )}
      {props.categories.length === 0 ? (
        <p className="sp-admin__meta">{t('admin.categories.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">
              {t('admin.categories.ofBranch', { branch: title })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.categories.name')}</th>
                <th scope="col">{t('admin.categories.ageBand')}</th>
                <th scope="col">{t('admin.categories.stage')}</th>
                <th scope="col" className="sp-table__number">
                  {t('admin.categories.order')}
                </th>
                <th scope="col">{t('admin.categories.status')}</th>
                <th scope="col">{t('admin.members.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {props.categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  branchArchived={branch.archivedAt !== null}
                  onChanged={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  );
}

function CategoryRow(props: {
  category: Category;
  branchArchived: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const { api } = useServices();
  const { category } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [order, setOrder] = useState(String(category.sortOrder));
  const sortOrder = parseSortOrder(order);
  const trimmed = name.trim();
  const band = DEFAULT_AGE_BANDS.find((b) => b.code === category.ageBandCode);
  const archived = category.archivedAt !== null;

  const update = useMutation({
    mutationFn: () =>
      api.updateCategory({
        params: { categoryId: category.id },
        body: {
          version: category.version,
          ...(trimmed === category.name ? {} : { name: trimmed }),
          ...(typeof sortOrder === 'number' && sortOrder !== category.sortOrder
            ? { sortOrder }
            : {}),
        },
      }),
    onSuccess: () => {
      setEditing(false);
    },
    onSettled: props.onChanged,
  });
  const archive = useMutation({
    mutationFn: () => api.archiveCategory({ params: { categoryId: category.id } }),
    onSettled: props.onChanged,
  });
  const restore = useMutation({
    mutationFn: () => api.restoreCategory({ params: { categoryId: category.id } }),
    onSettled: props.onChanged,
  });
  const invalid =
    trimmed === '' || trimmed.length > CATEGORY_NAME_MAX_LENGTH || typeof sortOrder !== 'number';

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invalid) update.mutate();
  };

  return (
    <tr>
      <th scope="row">
        {editing ? (
          <form className="sp-admin__inline" onSubmit={save} noValidate>
            <TextField
              label={t('admin.categories.name')}
              maxLength={CATEGORY_NAME_MAX_LENGTH}
              value={name}
              error={trimmed === '' ? t('error.validation.required') : null}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <TextField
              label={t('admin.categories.order')}
              inputMode="numeric"
              value={order}
              error={
                typeof sortOrder === 'number'
                  ? null
                  : t('error.validation.range', { min: 0, max: SORT_ORDER_MAX })
              }
              onChange={(event) => {
                setOrder(event.target.value);
              }}
            />
            <div className="sp-form__actions">
              <Button type="submit" disabled={invalid || update.isPending}>
                {t('common.save')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setName(category.name);
                  setOrder(String(category.sortOrder));
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          category.name
        )}
      </th>
      <td>{band?.label ?? category.ageBandCode}</td>
      <td>{t(`admin.stage.${category.defaultStage}`)}</td>
      <td className="sp-table__number">{category.sortOrder}</td>
      <td>
        {archived ? (
          <StatusLabel level="info">{t('admin.status.archived')}</StatusLabel>
        ) : (
          <StatusLabel level="ok">{t('admin.status.active')}</StatusLabel>
        )}
      </td>
      <td>
        <div className="sp-admin__row-actions">
          {archived ? (
            <Button
              variant="secondary"
              disabled={restore.isPending || props.branchArchived}
              onClick={() => {
                restore.mutate();
              }}
            >
              {t('admin.restore')}
            </Button>
          ) : (
            <>
              {editing ? null : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  {t('common.edit')}
                </Button>
              )}
              <ConfirmAction
                label={t('admin.archive')}
                question={t('admin.categories.archiveQuestion', { name: category.name })}
                pending={archive.isPending}
                onConfirm={() => {
                  archive.mutate();
                }}
              />
            </>
          )}
        </div>
        <ActionError
          error={update.error ?? archive.error ?? restore.error}
          conflictText={t('admin.categories.conflict')}
        />
      </td>
    </tr>
  );
}
