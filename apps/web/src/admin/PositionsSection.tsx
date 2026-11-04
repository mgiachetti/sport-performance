import {
  POSITION_LABEL_MAX_LENGTH,
  type ClubBranch,
  type Position,
} from '@sport-performance/contracts';
import {
  DEFAULT_POSITION_LINES,
  POSITION_LINE_CODES,
  SPORTS,
  isWellFormedCode,
  type Sport,
} from '@sport-performance/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { clubQueryKey } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { lineName, positionName } from '../lib/positions';
import { Button, ErrorNotice, Loading, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { parseSortOrder } from './CategoriesSection';
import { ActionError, AdminSection, ConfirmAction } from './parts';
import { adminKey, allPositionsQuery } from './queries';

/** Sports of the club's active branches, in the domain's order. */
export function clubSports(branches: readonly Pick<ClubBranch, 'sport' | 'archivedAt'>[]): Sport[] {
  return SPORTS.filter((sport) => branches.some((b) => b.sport === sport && b.archivedAt === null));
}

/** Whether a position is one of the defaults of its sport (it has a catalog name). */
export function isDefaultPosition(position: Pick<Position, 'sport' | 'code'>): boolean {
  return DEFAULT_POSITION_LINES.some(
    (p) => p.sport === position.sport && p.positionCode === position.code,
  );
}

/** A label typed by the staff: trimmed, `null` when empty; too long is not `ok`. */
export function parsePositionLabel(
  text: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const value = text.trim();
  if (value.length > POSITION_LABEL_MAX_LENGTH) return { ok: false };
  return { ok: true, value: value === '' ? null : value };
}

/** One refresh for the section and every screen that names positions. */
function useRefreshPositions() {
  const { queryClient } = useServices();
  const { selection } = useActiveClub();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'positions') }),
      queryClient.invalidateQueries({ queryKey: clubQueryKey(selection, 'positions') }),
      queryClient.invalidateQueries({
        queryKey: clubQueryKey(selection, 'configuration', 'positions'),
      }),
    ]);
}

/**
 * Positions of the club (B-801, ADR 0087), per sport of its branches: the
 * seeded ones with the club's names, order and lines, plus the club's own
 * inside the lines of the sport. Archived, never deleted.
 */
export function PositionsSection(props: { branches: readonly ClubBranch[] }) {
  const { api } = useServices();
  const { selection } = useActiveClub();
  const positions = useQuery(allPositionsQuery(api, selection));
  const sports = clubSports(props.branches);
  if (sports.length === 0) return null;
  if (positions.isPending) return <Loading />;
  if (positions.isError) return <ErrorNotice error={positions.error} />;
  return (
    <>
      {sports.map((sport) => (
        <SportPositions
          key={sport}
          sport={sport}
          positions={positions.data.filter((p) => p.sport === sport)}
        />
      ))}
    </>
  );
}

function lineOptions(t: ReturnType<typeof useT>, sport: Sport) {
  return POSITION_LINE_CODES[sport].map((line) => ({
    value: line,
    label: lineName(t, sport, line),
  }));
}

function SportPositions(props: { sport: Sport; positions: readonly Position[] }) {
  const t = useT();
  const refresh = useRefreshPositions();
  const { sport } = props;
  const title = t('admin.positions.title', { sport: t(`sport.${sport}`) });
  return (
    <AdminSection id={`admin-positions-${sport}`} title={title} intro={t('admin.positions.intro')}>
      {props.positions.length === 0 ? (
        <p className="sp-admin__meta">{t('admin.positions.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.positions.name')}</th>
                <th scope="col">{t('admin.positions.line')}</th>
                <th scope="col" className="sp-table__number">
                  {t('admin.positions.order')}
                </th>
                <th scope="col">{t('admin.positions.status')}</th>
                <th scope="col">{t('admin.members.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {props.positions.map((position) => (
                <PositionRow key={position.id} position={position} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PositionForm sport={sport} onChanged={refresh} />
    </AdminSection>
  );
}

function PositionForm(props: { sport: Sport; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [line, setLine] = useState('');
  const [order, setOrder] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const trimmedCode = code.trim();
  const parsedLabel = parsePositionLabel(label);
  const sortOrder = parseSortOrder(order);
  const codeError =
    trimmedCode === ''
      ? t('error.validation.required')
      : isWellFormedCode(trimmedCode)
        ? null
        : t('admin.positions.codeInvalid');
  const newLabel = parsedLabel.ok ? parsedLabel.value : null;
  const labelError = !parsedLabel.ok
    ? t('admin.positions.labelTooLong', { max: POSITION_LABEL_MAX_LENGTH })
    : newLabel === null
      ? t('error.validation.required')
      : null;
  const lineError = line === '' ? t('error.validation.required') : null;
  const orderError =
    sortOrder === 'invalid' ? t('error.validation.range', { min: 0, max: 32_767 }) : null;
  const invalid =
    codeError !== null || labelError !== null || lineError !== null || orderError !== null;

  const create = useMutation({
    mutationFn: () =>
      api.createPosition({
        body: {
          clientUuid,
          sport: props.sport,
          code: trimmedCode,
          label: newLabel ?? '',
          lineCode: line,
          ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
        },
      }),
    onSuccess: () => {
      setCode('');
      setLabel('');
      setLine('');
      setOrder('');
      setSubmitted(false);
      setClientUuid(crypto.randomUUID());
    },
    onSettled: props.onChanged,
  });
  const touch = () => {
    setClientUuid(crypto.randomUUID());
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid) create.mutate();
  };

  return (
    <form
      className="sp-form"
      onSubmit={submit}
      noValidate
      aria-label={`${t('admin.positions.new')} (${t(`sport.${props.sport}`)})`}
    >
      <h3 className="sp-admin__subtitle">{t('admin.positions.new')}</h3>
      <div className="sp-form__row">
        <TextField
          label={t('admin.positions.name')}
          maxLength={POSITION_LABEL_MAX_LENGTH}
          value={label}
          error={submitted ? labelError : null}
          onChange={(event) => {
            setLabel(event.target.value);
            touch();
          }}
        />
        <TextField
          label={t('admin.positions.code')}
          help={t('admin.positions.codeHelp')}
          value={code}
          error={submitted ? codeError : null}
          onChange={(event) => {
            setCode(event.target.value);
            touch();
          }}
        />
        <SelectField
          label={t('admin.positions.line')}
          value={line}
          error={submitted ? lineError : null}
          options={[
            { value: '', label: t('admin.positions.pickLine') },
            ...lineOptions(t, props.sport),
          ]}
          onChange={(event) => {
            setLine(event.target.value);
            touch();
          }}
        />
        <TextField
          label={t('admin.positions.order')}
          help={t('admin.categories.orderHelp')}
          inputMode="numeric"
          value={order}
          error={submitted ? orderError : null}
          onChange={(event) => {
            setOrder(event.target.value);
            touch();
          }}
        />
      </div>
      <ActionError error={create.error} conflictText={t('admin.positions.codeConflict')} />
      <div className="sp-form__actions">
        <Button type="submit" disabled={create.isPending}>
          {t('admin.positions.create')}
        </Button>
      </div>
    </form>
  );
}

function PositionRow(props: { position: Position; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const { api } = useServices();
  const { position } = props;
  const name = positionName(t, position);
  const ownPosition = !isDefaultPosition(position);
  const catalogName = positionName(t, { ...position, label: null });
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(position.label ?? '');
  const [line, setLine] = useState(position.lineCode ?? '');
  const [order, setOrder] = useState(String(position.sortOrder));
  const parsedLabel = parsePositionLabel(label);
  const sortOrder = parseSortOrder(order);
  const archived = position.archivedAt !== null;
  const newLabel = parsedLabel.ok ? parsedLabel.value : null;
  const labelError = !parsedLabel.ok
    ? t('admin.positions.labelTooLong', { max: POSITION_LABEL_MAX_LENGTH })
    : newLabel === null && ownPosition
      ? t('error.validation.required')
      : null;
  const invalid = labelError !== null || typeof sortOrder !== 'number' || line === '';

  const reset = () => {
    setLabel(position.label ?? '');
    setLine(position.lineCode ?? '');
    setOrder(String(position.sortOrder));
  };
  const update = useMutation({
    mutationFn: () =>
      api.updatePosition({
        params: { positionId: position.id },
        body: {
          version: position.version,
          ...(newLabel === position.label ? {} : { label: newLabel }),
          ...(line === (position.lineCode ?? '') ? {} : { lineCode: line }),
          ...(typeof sortOrder === 'number' && sortOrder !== position.sortOrder
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
    mutationFn: () => api.archivePosition({ params: { positionId: position.id } }),
    onSettled: props.onChanged,
  });
  const restore = useMutation({
    mutationFn: () => api.restorePosition({ params: { positionId: position.id } }),
    onSettled: props.onChanged,
  });

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
              label={t('admin.positions.name')}
              help={ownPosition ? undefined : t('admin.positions.nameHelp', { name: catalogName })}
              maxLength={POSITION_LABEL_MAX_LENGTH}
              value={label}
              error={labelError}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
            <SelectField
              label={t('admin.positions.line')}
              value={line}
              error={line === '' ? t('error.validation.required') : null}
              options={[
                ...(line === '' ? [{ value: '', label: t('admin.positions.pickLine') }] : []),
                ...lineOptions(t, position.sport),
              ]}
              onChange={(event) => {
                setLine(event.target.value);
              }}
            />
            <TextField
              label={t('admin.positions.order')}
              inputMode="numeric"
              value={order}
              error={
                typeof sortOrder === 'number'
                  ? null
                  : t('error.validation.range', { min: 0, max: 32_767 })
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
                  reset();
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          name
        )}
      </th>
      <td>{position.lineCode === null ? '—' : lineName(t, position.sport, position.lineCode)}</td>
      <td className="sp-table__number">{position.sortOrder}</td>
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
              disabled={restore.isPending}
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
                question={t('admin.positions.archiveQuestion', { name })}
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
          conflictText={t('admin.positions.conflict')}
        />
      </td>
    </tr>
  );
}
