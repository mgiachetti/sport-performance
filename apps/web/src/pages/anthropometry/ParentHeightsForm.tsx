import {
  PARENT_HEIGHT_MAX_CM,
  PARENT_HEIGHT_MIN_CM,
  type ParentHeight,
  type Player,
} from '@sport-performance/contracts';
import { HEIGHT_SOURCES, type HeightSource } from '@sport-performance/domain';
import { formatNumber, parseNumber } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type SubmitEvent } from 'react';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useT } from '../../i18n/i18n';
import { Button, ErrorNotice, Loading, TextField } from '../../ui/components';
import { anthropometryKey, parentHeightsQuery } from './queries';

const PARENTS = ['mother', 'father'] as const;
type ParentKind = (typeof PARENTS)[number];

function initialText(height: ParentHeight | null | undefined): string {
  return height === null || height === undefined
    ? ''
    : formatNumber(height.heightCm, { maxDecimals: 1, grouping: false });
}

/**
 * The parents' heights of a player, for Khamis-Roche (B-203): the staff
 * measures or records them on the measurement day, without leaving the
 * sheet. Replacing a height sends its version (`409` if it changed).
 */
export function ParentHeightsForm(props: {
  player: Player;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const queryClient = useQueryClient();
  const sourceId = useId();
  const name = `${props.player.firstName} ${props.player.lastName}`;
  const query = useQuery(parentHeightsQuery(api, active.selection, props.player.id));
  const [text, setText] = useState<Partial<Record<ParentKind, string>>>({});
  const [source, setSource] = useState<HeightSource>('measured');
  const [invalid, setInvalid] = useState<ReadonlySet<ParentKind>>(new Set());

  const save = useMutation({
    mutationFn: async (changes: { parent: ParentKind; heightCm: number }[]) => {
      for (const change of changes) {
        const current = query.data?.[change.parent] ?? null;
        await api.setPlayerParentHeight({
          params: { playerId: props.player.id, parent: change.parent },
          body: {
            heightCm: change.heightCm,
            source,
            ...(current === null ? {} : { version: current.version }),
          },
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: parentHeightsQuery(api, active.selection, props.player.id).queryKey,
      });
      // The preview of the sheet now has the parents: % of adult height appears.
      await queryClient.invalidateQueries({ queryKey: anthropometryKey(active.selection) });
      props.onSaved();
    },
  });

  if (query.isPending) return <Loading />;
  if (query.error !== null) return <ErrorNotice error={query.error} />;

  const valueOf = (parent: ParentKind) => text[parent] ?? initialText(query.data[parent]);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const wrong = new Set<ParentKind>();
    const changes: { parent: ParentKind; heightCm: number }[] = [];
    for (const parent of PARENTS) {
      const typed = valueOf(parent);
      if (typed.trim() === '') continue;
      const heightCm = parseNumber(typed, { allowGrouping: false });
      if (heightCm === null || heightCm < PARENT_HEIGHT_MIN_CM || heightCm > PARENT_HEIGHT_MAX_CM) {
        wrong.add(parent);
        continue;
      }
      const current = query.data?.[parent] ?? null;
      if (current?.heightCm !== heightCm || current.source !== source) {
        changes.push({ parent, heightCm });
      }
    }
    setInvalid(wrong);
    if (wrong.size > 0) return;
    if (changes.length === 0) {
      props.onCancel();
      return;
    }
    save.mutate(changes);
  }

  const help = t('anthropometry.parents.help', {
    min: PARENT_HEIGHT_MIN_CM,
    max: PARENT_HEIGHT_MAX_CM,
  });
  return (
    <form
      className="sp-anthro__parents"
      aria-label={t('anthropometry.parents.title', { player: name })}
      onSubmit={onSubmit}
    >
      <h3 className="sp-anthro__parents-title">
        {t('anthropometry.parents.title', { player: name })}
      </h3>
      <div className="sp-anthro__parents-fields">
        {PARENTS.map((parent) => (
          <TextField
            key={parent}
            label={t(
              parent === 'mother' ? 'anthropometry.parents.mother' : 'anthropometry.parents.father',
            )}
            help={help}
            inputMode="decimal"
            autoComplete="off"
            value={valueOf(parent)}
            error={invalid.has(parent) ? help : null}
            onChange={(event) => {
              setText((current) => ({ ...current, [parent]: event.target.value }));
            }}
          />
        ))}
        <div className="sp-field">
          <label htmlFor={sourceId} className="sp-field__label">
            {t('anthropometry.parents.source')}
          </label>
          <select
            id={sourceId}
            value={source}
            onChange={(event) => {
              const value = HEIGHT_SOURCES.find((s) => s === event.target.value);
              if (value !== undefined) setSource(value);
            }}
          >
            {HEIGHT_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(
                  value === 'measured'
                    ? 'anthropometry.parents.source.measured'
                    : 'anthropometry.parents.source.reported',
                )}
              </option>
            ))}
          </select>
        </div>
      </div>
      {save.error === null ? null : <ErrorNotice error={save.error} />}
      <div className="sp-form__secondary">
        <Button type="submit" disabled={save.isPending}>
          {t('anthropometry.parents.save')}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
