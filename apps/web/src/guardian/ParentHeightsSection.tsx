import {
  ApiError,
  PARENT_HEIGHT_MAX_CM,
  PARENT_HEIGHT_MIN_CM,
  type Child,
  type ParentHeight,
  type Player,
  type PlayerConsents,
} from '@sport-performance/contracts';
import { PARENTS, can, type Parent } from '@sport-performance/domain';
import { formatDate, formatNumber, formatUnit, parseNumber } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { StatusLabel } from '../ui/fields';
import { childFacts } from './child';
import { parentHeightsQuery } from './queries';

export type HeightInput =
  | { readonly ok: true; readonly heightCm: number }
  | { readonly ok: false; readonly reason: 'invalid' | 'out_of_range' };

/**
 * A height typed in es-AR (`165` or `165,5`), checked against the range of
 * the contract before calling the API. A dot is never a decimal separator.
 */
export function parseHeightInput(input: string): HeightInput {
  const value = parseNumber(input, { allowGrouping: false });
  if (value === null) return { ok: false, reason: 'invalid' };
  if (value < PARENT_HEIGHT_MIN_CM || value > PARENT_HEIGHT_MAX_CM) {
    return { ok: false, reason: 'out_of_range' };
  }
  return { ok: true, heightCm: value };
}

/**
 * The parents' heights (Khamis-Roche, B-203 and ADR 0035): what is loaded,
 * where it came from and, for the guardian of a minor with a `data` consent,
 * reporting or correcting it. A height measured by the staff is not replaced
 * from here.
 */
export function ParentHeightsSection(props: {
  child: Child;
  player: Player;
  consents: PlayerConsents | undefined;
}) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { child } = props;
  const heights = useQuery(parentHeightsQuery(api, active.selection, child.playerId));
  const facts = childFacts(child, props.player, props.consents);
  const canReport = can(active.subject, 'report', {
    kind: 'parent_height',
    clubId: active.club.id,
    player: facts,
  });
  const needsDataConsent =
    !child.ofAge && facts.consents !== undefined && !facts.consents.includes('data');

  return (
    <section className="sp-card" aria-labelledby="child-heights">
      <h2 id="child-heights" className="sp-card__title">
        {t('guardian.heights.title')}
      </h2>
      <p className="sp-card__subtitle-text">
        {t('guardian.heights.intro', { name: child.firstName })}
      </p>
      {needsDataConsent ? (
        <Notice level="warning">
          <p>{t('guardian.heights.needsDataConsent')}</p>
        </Notice>
      ) : null}
      {heights.isPending ? <Loading /> : null}
      {heights.isError ? <ErrorNotice error={heights.error} /> : null}
      {heights.data === undefined ? null : (
        <ul className="sp-row-list">
          {PARENTS.map((parent) => (
            <li key={parent}>
              <ParentHeightRow
                child={child}
                parent={parent}
                height={heights.data[parent]}
                canReport={canReport}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ParentHeightRow(props: {
  child: Child;
  parent: Parent;
  height: ParentHeight | null;
  canReport: boolean;
}) {
  const t = useT();
  const active = useActiveClub();
  const { height, parent } = props;
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<'saved' | 'conflict' | null>(null);
  const titleId = useId();
  const measured = height?.source === 'measured';

  return (
    <article className="sp-row" aria-labelledby={titleId}>
      <div className="sp-row__head">
        <h3 id={titleId} className="sp-row__title">
          {t(`guardian.heights.parent.${parent}`)}
        </h3>
        {height === null ? (
          <StatusLabel level="info">{t('guardian.heights.missing')}</StatusLabel>
        ) : (
          <span className="sp-row__value">{formatUnit(height.heightCm, 'cm')}</span>
        )}
      </div>
      {height === null ? null : (
        <p className="sp-meta">
          {t(`guardian.heights.source.${height.source}`)} ·{' '}
          {t('guardian.heights.updatedOn', {
            date: formatDate(new Date(height.updatedAt), { timeZone: active.club.timeZone }),
          })}
        </p>
      )}
      {measured && props.canReport ? (
        <p className="sp-meta">{t('guardian.heights.measuredLocked')}</p>
      ) : null}
      {props.canReport && !measured && !editing ? (
        <div className="sp-row__actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOutcome(null);
              setEditing(true);
            }}
          >
            {height === null ? t('guardian.heights.report') : t('guardian.heights.edit')}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <HeightForm
          child={props.child}
          parent={parent}
          height={height}
          onDone={() => {
            setEditing(false);
            setOutcome('saved');
          }}
          onConflict={() => {
            setEditing(false);
            setOutcome('conflict');
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : null}
      {outcome === 'conflict' ? (
        <Notice level="warning" role="alert">
          <p>{t('guardian.heights.conflict')}</p>
        </Notice>
      ) : null}
      <div role="status">
        {outcome === 'saved' ? (
          <StatusLabel level="ok">{t('guardian.heights.saved')}</StatusLabel>
        ) : null}
      </div>
    </article>
  );
}

function HeightForm(props: {
  child: Child;
  parent: Parent;
  height: ParentHeight | null;
  onDone: () => void;
  onConflict: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const { child, parent, height } = props;
  const [value, setValue] = useState(
    height === null ? '' : formatNumber(height.heightCm, { maxDecimals: 1, grouping: false }),
  );
  const [inputError, setInputError] = useState<string | null>(null);
  const queryKey = parentHeightsQuery(api, active.selection, child.playerId).queryKey;

  const save = useMutation({
    mutationFn: (heightCm: number) =>
      api.setPlayerParentHeight({
        params: { playerId: child.playerId, parent },
        body: {
          heightCm,
          source: 'reported',
          // Replacing a loaded height needs the version that was read (ADR 0032).
          ...(height === null ? {} : { version: height.version }),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      props.onDone();
    },
    onError: async (error) => {
      // Changed meanwhile (or measured by the staff): show the current value, not the form.
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey });
        props.onConflict();
      }
    },
  });

  return (
    <form
      className="sp-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseHeightInput(value);
        if (!parsed.ok) {
          setInputError(
            parsed.reason === 'invalid'
              ? t('guardian.heights.input.invalid')
              : t('guardian.heights.input.outOfRange', {
                  min: PARENT_HEIGHT_MIN_CM,
                  max: PARENT_HEIGHT_MAX_CM,
                }),
          );
          return;
        }
        setInputError(null);
        save.mutate(parsed.heightCm);
      }}
    >
      <TextField
        label={t('guardian.heights.input.label', { parent })}
        help={t('guardian.heights.input.help')}
        error={inputError}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      {save.isError ? <ErrorNotice error={save.error} /> : null}
      <div className="sp-row__actions">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('guardian.heights.saving') : t('common.save')}
        </Button>
        <Button variant="ghost" onClick={props.onCancel} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
