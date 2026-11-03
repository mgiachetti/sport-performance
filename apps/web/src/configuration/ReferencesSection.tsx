import type { CatalogMetric, Position, ReferenceValue } from '@sport-performance/contracts';
import {
  MEASUREMENT_METHODS,
  type LocalDate,
  type MeasurementMethod,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import {
  formatLocalDate,
  formatNumber,
  formatUnit,
  isMessageKey,
  unitLabelEsAr,
  type Translator,
} from '@sport-performance/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField } from '../ui/fields';
import {
  catalogMetricsQuery,
  invalidateConfiguration,
  positionsQuery,
  referencesQuery,
} from './queries';
import { metricLabel, newClientUuid, parseDateInput, parseDecimal, useClubToday } from './shared';

type T = Translator['t'];
type Scope = 'squad' | 'line' | 'position';

/** The catalog's text for a code of the sport, or the code itself when there is none. */
function codeLabel(t: T, key: string, code: string): string {
  return isMessageKey(key) ? translate(t, key) : code;
}

/** The club's label of the position, else the catalog's name of the default one, else its code. */
function positionName(t: T, position: Pick<Position, 'sport' | 'code' | 'label'>): string {
  if (position.label !== null) return position.label;
  return codeLabel(t, `configuration.position.${position.sport}.${position.code}`, position.code);
}

function lineName(t: T, sport: Sport, line: string): string {
  return codeLabel(t, `configuration.line.${sport}.${line}`, line);
}

function scopeText(t: T, reference: ReferenceValue, positions: readonly Position[]): string {
  if (reference.scope === 'position') {
    const position = positions.find((candidate) => candidate.code === reference.positionCode);
    return t('configuration.references.scope.position', {
      position: position === undefined ? (reference.positionCode ?? '') : positionName(t, position),
    });
  }
  if (reference.scope === 'line') {
    return t('configuration.references.scope.line', {
      line: lineName(t, reference.sport, reference.lineCode ?? ''),
    });
  }
  return t('configuration.references.scope.squad');
}

const methodOptions = (t: T) => [
  { value: '', label: t('configuration.references.methodUnknown') },
  ...MEASUREMENT_METHODS.map((method) => ({ value: method, label: t(`method.${method}`) })),
];

export function ReferencesSection(props: { sport: Sport; sex: Sex; canEdit: boolean }) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<ReferenceValue | 'new' | null>(null);
  const [saved, setSaved] = useState(false);
  const references = useQuery(
    referencesQuery(api, selection, { sport: props.sport, sex: props.sex, status }),
  );
  const metrics = useQuery(catalogMetricsQuery(api, selection, props.sport));
  const positions = useQuery(positionsQuery(api, selection, props.sport));

  const toggleArchive = useMutation({
    mutationFn: (reference: ReferenceValue) =>
      reference.archivedAt === null
        ? api.archiveReferenceValue({ params: { referenceValueId: reference.id } })
        : api.restoreReferenceValue({ params: { referenceValueId: reference.id } }),
    onSuccess: async () => {
      setSaved(true);
      await invalidateConfiguration(queryClient, selection);
    },
  });

  const failed = references.error ?? metrics.error ?? positions.error;
  const positionList = positions.data ?? [];

  return (
    <section className="sp-card" aria-labelledby="references-title">
      <h2 id="references-title" className="sp-card__title">
        {t('configuration.references.title')}
      </h2>
      <p className="sp-field__help">{t('configuration.references.help')}</p>
      <div className="sp-form__row sp-config__group">
        <SelectField
          label={t('configuration.status.label')}
          value={status}
          options={[
            { value: 'active', label: t('configuration.status.active') },
            { value: 'archived', label: t('configuration.status.archived') },
          ]}
          onChange={(event) => {
            setStatus(event.currentTarget.value === 'archived' ? 'archived' : 'active');
          }}
        />
      </div>
      {saved ? (
        <Notice level="ok" role="status">
          <p>{t('configuration.saved')}</p>
        </Notice>
      ) : null}
      {toggleArchive.error === null ? null : <ErrorNotice error={toggleArchive.error} />}
      {failed !== null ? (
        <ErrorNotice error={failed} />
      ) : references.data === undefined || metrics.data === undefined ? (
        <Loading />
      ) : references.data.length === 0 ? (
        <p>{t('configuration.references.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('configuration.references.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('configuration.references.metric')}</th>
                <th scope="col">{t('configuration.references.scope')}</th>
                <th scope="col" className="sp-num">
                  {t('configuration.references.value')}
                </th>
                <th scope="col">{t('configuration.references.method')}</th>
                <th scope="col">{t('configuration.validFrom')}</th>
                <th scope="col">{t('configuration.references.source')}</th>
                {props.canEdit ? <th scope="col">{t('configuration.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {references.data.map((reference) => {
                const metric = metricLabel(t, reference.metricCode);
                return (
                  <tr key={reference.id}>
                    <th scope="row">{metric}</th>
                    <td>{scopeText(t, reference, positionList)}</td>
                    <td className="sp-num">{formatUnit(reference.value, reference.unit)}</td>
                    <td>
                      {reference.method === null
                        ? t('configuration.references.methodUnknown')
                        : t(`method.${reference.method}`)}
                    </td>
                    <td>{formatLocalDate(reference.validFrom)}</td>
                    <td>{reference.source}</td>
                    {props.canEdit ? (
                      <td className="sp-config__row-actions">
                        {reference.archivedAt === null ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSaved(false);
                              setEditing(reference);
                            }}
                          >
                            {t('configuration.references.edit', { metric })}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          disabled={toggleArchive.isPending}
                          onClick={() => {
                            setSaved(false);
                            toggleArchive.mutate(reference);
                          }}
                        >
                          {reference.archivedAt === null
                            ? t('configuration.references.archive', { metric })
                            : t('configuration.references.restore', { metric })}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {props.canEdit && editing === null && metrics.data !== undefined ? (
        <div className="sp-form__actions sp-config__after-table">
          <Button
            variant="secondary"
            onClick={() => {
              setSaved(false);
              setEditing('new');
            }}
          >
            {t('configuration.references.new')}
          </Button>
        </div>
      ) : null}
      {editing === 'new' && metrics.data !== undefined ? (
        <ReferenceCreator
          sport={props.sport}
          sex={props.sex}
          metrics={metrics.data}
          positions={positionList}
          onCancel={() => {
            setEditing(null);
          }}
          onDone={() => {
            setEditing(null);
            setSaved(true);
          }}
        />
      ) : editing !== null && editing !== 'new' ? (
        <ReferenceEditor
          key={editing.id}
          reference={editing}
          onCancel={() => {
            setEditing(null);
          }}
          onDone={() => {
            setEditing(null);
            setSaved(true);
          }}
        />
      ) : null}
    </section>
  );
}

interface CommonDraft {
  value: string;
  method: string;
  validFrom: string;
  source: string;
}

/** Value, method, validity and source: what both forms ask and check the same way. */
function useCommonFields(initial: CommonDraft) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<CommonDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  return { draft, set };
}

function checkCommon(t: T, draft: CommonDraft, errors: Record<string, string>) {
  const value = parseDecimal(draft.value);
  if (value === null) errors.value = t('configuration.numberInvalid');
  const validFrom = parseDateInput(draft.validFrom);
  if (validFrom === null) errors.validFrom = t('configuration.dateRequired');
  const source = draft.source.trim();
  if (source === '') errors.source = t('configuration.references.sourceRequired');
  const method = (MEASUREMENT_METHODS as readonly string[]).includes(draft.method)
    ? (draft.method as MeasurementMethod)
    : null;
  return { value, validFrom, source, method };
}

function CommonFields(props: {
  t: T;
  unit: string;
  draft: CommonDraft;
  set: (patch: Partial<CommonDraft>) => void;
  errors: Record<string, string>;
  busy: boolean;
}) {
  const { t, draft, set, errors, busy } = props;
  return (
    <>
      <div className="sp-form__row">
        <TextField
          label={
            props.unit === ''
              ? t('configuration.references.value')
              : t('configuration.references.valueIn', { unit: props.unit })
          }
          inputMode="decimal"
          value={draft.value}
          error={errors.value}
          disabled={busy}
          onChange={(event) => {
            set({ value: event.currentTarget.value });
          }}
        />
        <SelectField
          label={t('configuration.references.method')}
          value={draft.method}
          options={methodOptions(t)}
          disabled={busy}
          onChange={(event) => {
            set({ method: event.currentTarget.value });
          }}
        />
        <TextField
          label={t('configuration.validFrom')}
          type="date"
          value={draft.validFrom}
          error={errors.validFrom}
          disabled={busy}
          onChange={(event) => {
            set({ validFrom: event.currentTarget.value });
          }}
        />
      </div>
      <TextField
        label={t('configuration.references.source')}
        help={t('configuration.references.sourceHelp')}
        value={draft.source}
        error={errors.source}
        maxLength={200}
        disabled={busy}
        onChange={(event) => {
          set({ source: event.currentTarget.value });
        }}
      />
    </>
  );
}

function ReferenceCreator(props: {
  sport: Sport;
  sex: Sex;
  metrics: readonly CatalogMetric[];
  positions: readonly Position[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const today = useClubToday();
  const [metricCode, setMetricCode] = useState('');
  const [scope, setScope] = useState<Scope>('squad');
  const [lineCode, setLineCode] = useState('');
  const [positionCode, setPositionCode] = useState('');
  const { draft, set } = useCommonFields({ value: '', method: '', validFrom: today, source: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const metric = props.metrics.find((candidate) => candidate.code === metricCode);
  const lines = [
    ...new Set(
      props.positions
        .map((position) => position.lineCode)
        .filter((line): line is string => line !== null),
    ),
  ];

  const create = useMutation({
    mutationFn: (input: {
      metric: CatalogMetric;
      value: number;
      validFrom: LocalDate;
      source: string;
      method: MeasurementMethod | null;
      clientUuid: string;
    }) =>
      api.createReferenceValue({
        body: {
          clientUuid: input.clientUuid,
          metricCode: input.metric.code,
          sport: props.sport,
          sex: props.sex,
          ...(scope === 'line' ? { lineCode } : {}),
          ...(scope === 'position' ? { positionCode } : {}),
          value: input.value,
          // The unit is the metric's: never chosen (ADR 0040).
          unit: input.metric.unit,
          ...(input.method === null ? {} : { method: input.method }),
          validFrom: input.validFrom,
          source: input.source,
        },
      }),
    onSuccess: async () => {
      await invalidateConfiguration(queryClient, selection);
      props.onDone();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (metric === undefined) next.metric = t('configuration.references.metricRequired');
    if (scope === 'line' && lineCode === '') next.line = t('configuration.references.lineRequired');
    if (scope === 'position' && positionCode === '') {
      next.position = t('configuration.references.positionRequired');
    }
    const common = checkCommon(t, draft, next);
    setErrors(next);
    if (
      Object.keys(next).length > 0 ||
      metric === undefined ||
      common.value === null ||
      common.validFrom === null
    ) {
      return;
    }
    create.mutate({
      metric,
      value: common.value,
      validFrom: common.validFrom,
      source: common.source,
      method: common.method,
      clientUuid: newClientUuid(),
    });
  };

  const busy = create.isPending;
  return (
    <section className="sp-config__editor" aria-labelledby="reference-new-title">
      <h3 id="reference-new-title" className="sp-config__subtitle">
        {t('configuration.references.new')}
      </h3>
      {create.error === null ? null : <ErrorNotice error={create.error} />}
      <form className="sp-form" onSubmit={submit} noValidate>
        <div className="sp-form__row">
          <SelectField
            label={t('configuration.references.metric')}
            value={metricCode}
            error={errors.metric}
            disabled={busy}
            options={[
              { value: '', label: '' },
              ...props.metrics.map((candidate) => ({
                value: candidate.code,
                label: metricLabel(t, candidate.code),
              })),
            ]}
            onChange={(event) => {
              setMetricCode(event.currentTarget.value);
            }}
          />
          <SelectField
            label={t('configuration.references.scope')}
            value={scope}
            disabled={busy}
            options={(['squad', 'line', 'position'] as const).map((value) => ({
              value,
              label: t(`configuration.references.scopeKind.${value}`),
            }))}
            onChange={(event) => {
              setScope(event.currentTarget.value as Scope);
            }}
          />
          {scope === 'line' ? (
            <SelectField
              label={t('configuration.references.line')}
              value={lineCode}
              error={errors.line}
              disabled={busy}
              options={[
                { value: '', label: '' },
                ...lines.map((line) => ({ value: line, label: lineName(t, props.sport, line) })),
              ]}
              onChange={(event) => {
                setLineCode(event.currentTarget.value);
              }}
            />
          ) : null}
          {scope === 'position' ? (
            <SelectField
              label={t('configuration.references.position')}
              value={positionCode}
              error={errors.position}
              disabled={busy}
              options={[
                { value: '', label: '' },
                ...props.positions.map((position) => ({
                  value: position.code,
                  label: positionName(t, position),
                })),
              ]}
              onChange={(event) => {
                setPositionCode(event.currentTarget.value);
              }}
            />
          ) : null}
        </div>
        <CommonFields
          t={t}
          unit={metric === undefined ? '' : unitLabelEsAr(metric.unit)}
          draft={draft}
          set={set}
          errors={errors}
          busy={busy}
        />
        <div className="sp-form__actions">
          <Button type="submit" disabled={busy}>
            {t('configuration.references.create')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ReferenceEditor(props: {
  reference: ReferenceValue;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const { reference } = props;
  const { draft, set } = useCommonFields({
    value: formatNumber(reference.value, { maxDecimals: 4, grouping: false }),
    method: reference.method ?? '',
    validFrom: reference.validFrom,
    source: reference.source,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = useMutation({
    mutationFn: (input: {
      value: number;
      validFrom: LocalDate;
      source: string;
      method: MeasurementMethod | null;
    }) =>
      api.updateReferenceValue({
        params: { referenceValueId: reference.id },
        body: { version: reference.version, ...input },
      }),
    onSuccess: async () => {
      await invalidateConfiguration(queryClient, selection);
      props.onDone();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const common = checkCommon(t, draft, next);
    setErrors(next);
    if (Object.keys(next).length > 0 || common.value === null || common.validFrom === null) return;
    update.mutate({
      value: common.value,
      validFrom: common.validFrom,
      source: common.source,
      method: common.method,
    });
  };

  const metric = metricLabel(t, reference.metricCode);
  const busy = update.isPending;
  return (
    <section className="sp-config__editor" aria-labelledby="reference-edit-title">
      <h3 id="reference-edit-title" className="sp-config__subtitle">
        {t('configuration.references.editor.title', { metric })}
      </h3>
      <p>{t('configuration.references.editor.help')}</p>
      {update.error === null ? null : <ErrorNotice error={update.error} />}
      <form className="sp-form" onSubmit={submit} noValidate>
        <CommonFields
          t={t}
          unit={unitLabelEsAr(reference.unit)}
          draft={draft}
          set={set}
          errors={errors}
          busy={busy}
        />
        <div className="sp-form__actions">
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
