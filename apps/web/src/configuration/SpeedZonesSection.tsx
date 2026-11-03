import type { SpeedZoneConfigDto } from '@sport-performance/contracts';
import {
  DomainValidationError,
  validateSpeedZoneSet,
  type LocalDate,
  type Sex,
  type SpeedZoneSet,
  type Sport,
} from '@sport-performance/domain';
import { formatNumber, formatUnit, PLACEHOLDER } from '@sport-performance/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import {
  effectiveZonesQuery,
  invalidateConfiguration,
  zoneConfigsQuery,
  type SpeedZoneKind,
} from './queries';
import {
  PhaseLabel,
  newClientUuid,
  parseDateInput,
  parseDecimal,
  useClubToday,
  validityPhase,
  validityText,
  zoneLabel,
} from './shared';

const KINDS: readonly SpeedZoneKind[] = ['absolute', 'relative'];

interface ZoneRow {
  readonly code: string;
  readonly min: number;
}

function rowsOf(zoneSet: SpeedZoneSet): ZoneRow[] {
  return zoneSet.kind === 'absolute'
    ? zoneSet.zones.map((zone) => ({ code: zone.code, min: zone.minSpeedMs }))
    : zoneSet.zones.map((zone) => ({ code: zone.code, min: zone.minVmaxPct }));
}

function formatBound(kind: SpeedZoneKind, value: number): string {
  return kind === 'absolute'
    ? formatUnit(value, 'ms', { maxDecimals: 2 })
    : formatUnit(value, 'pct', { maxDecimals: 1 });
}

/** The group row of exactly this sport and branch (the one an edit replaces). */
function sameGroup(config: SpeedZoneConfigDto | null, sport: Sport, sex: Sex) {
  return (
    config !== null && config.playerId === null && config.sport === sport && config.sex === sex
  );
}

export function SpeedZonesSection(props: { sport: Sport; sex: Sex; canEdit: boolean }) {
  return (
    <div className="sp-config__zones">
      {KINDS.map((kind) => (
        <ZoneCard key={kind} kind={kind} {...props} />
      ))}
    </div>
  );
}

function ZoneCard(props: { kind: SpeedZoneKind; sport: Sport; sex: Sex; canEdit: boolean }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const today = useClubToday();
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const group = { kind: props.kind, sport: props.sport, sex: props.sex };
  const effective = useQuery(effectiveZonesQuery(api, selection, group));
  const history = useQuery(zoneConfigsQuery(api, selection, group));
  const title =
    props.kind === 'absolute'
      ? t('configuration.zones.absolute.title')
      : t('configuration.zones.relative.title');

  const data = effective.data;
  const rows = data === undefined ? [] : rowsOf(data.zoneSet);
  // A planned row of this group is edited in place; otherwise a new row starts on a date.
  const plannedConfig =
    (history.data ?? []).find(
      (config) => config.archivedAt === null && validityPhase(config, today) === 'planned',
    ) ?? null;

  return (
    <section className="sp-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="sp-card__title">
        {title}
      </h2>
      <p className="sp-field__help">
        {props.kind === 'absolute'
          ? t('configuration.zones.absolute.help')
          : t('configuration.zones.relative.help')}
      </p>
      {saved ? (
        <Notice level="ok" role="status">
          <p>{t('configuration.saved')}</p>
        </Notice>
      ) : null}
      {effective.error !== null ? (
        <ErrorNotice error={effective.error} />
      ) : data === undefined ? (
        <Loading />
      ) : (
        <>
          <p>
            {data.source === 'default' || data.config === null ? (
              <StatusLabel level="info">{t('configuration.zones.source.default')}</StatusLabel>
            ) : (
              <StatusLabel level="ok">
                {`${t('configuration.zones.source.club')} · ${validityText(t, data.config)}`}
              </StatusLabel>
            )}
          </p>
          <div className="sp-table-wrap">
            <table className="sp-table">
              <caption className="sp-visually-hidden">{title}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('configuration.zones.zone')}</th>
                  <th scope="col" className="sp-num">
                    {t('configuration.zones.from')}
                  </th>
                  <th scope="col" className="sp-num">
                    {t('configuration.zones.to')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const next = rows[index + 1];
                  const isHighSpeed = row.code === data.zoneSet.highSpeedZoneCode;
                  return (
                    <tr key={row.code}>
                      <th scope="row">
                        <span>{zoneLabel(t, row.code)}</span>
                        {isHighSpeed ? (
                          <span className="sp-tag sp-matrix__tag">
                            {t('configuration.zones.highSpeed')}
                          </span>
                        ) : null}
                      </th>
                      <td className="sp-num">{formatBound(props.kind, row.min)}</td>
                      <td className="sp-num">
                        {next === undefined ? PLACEHOLDER : formatBound(props.kind, next.min)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sp-field__help">
            {t('configuration.zones.highSpeedNote', {
              metric: props.kind === 'absolute' ? 'hsr_abs_m' : 'hsr_rel_m',
            })}
          </p>
          {props.canEdit && !editing ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              {t('configuration.zones.edit')}
              <span className="sp-visually-hidden">{` · ${title}`}</span>
            </Button>
          ) : null}
          {editing ? (
            <ZoneEditor
              kind={props.kind}
              sport={props.sport}
              sex={props.sex}
              today={today}
              initial={plannedConfig?.zoneSet ?? data.zoneSet}
              planned={plannedConfig}
              current={sameGroup(data.config, props.sport, props.sex) ? data.config : null}
              onCancel={() => {
                setEditing(false);
              }}
              onDone={() => {
                setEditing(false);
                setSaved(true);
              }}
            />
          ) : null}
        </>
      )}
      <h3 className="sp-config__subtitle">{t('configuration.zones.history', { title })}</h3>
      {history.error !== null ? (
        <ErrorNotice error={history.error} />
      ) : history.data === undefined ? (
        <Loading />
      ) : history.data.length === 0 ? (
        <p>{t('configuration.zones.historyEmpty')}</p>
      ) : (
        <ul className="sp-config__history">
          {history.data.map((config) => (
            <li key={config.id}>
              <PhaseLabel
                phase={config.archivedAt === null ? validityPhase(config, today) : 'archived'}
                t={t}
              />
              <span>{validityText(t, config)}</span>
              <span>
                {t('configuration.zones.zoneCount', { count: config.zoneSet.zones.length })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A zone set as the API takes it (mutable arrays). */
type ZoneSetBody =
  | {
      kind: 'absolute';
      zones: { code: string; minSpeedMs: number }[];
      highSpeedZoneCode: string;
    }
  | {
      kind: 'relative';
      zones: { code: string; minVmaxPct: number }[];
      highSpeedZoneCode: string;
    };

interface DraftZone {
  readonly key: string;
  readonly code: string;
  readonly min: string;
}

let draftKey = 0;
const nextKey = () => {
  draftKey += 1;
  return `zone-${String(draftKey)}`;
};

function ZoneEditor(props: {
  kind: SpeedZoneKind;
  sport: Sport;
  sex: Sex;
  today: LocalDate;
  initial: SpeedZoneSet;
  /** A planned row of the group: edited in place. */
  planned: SpeedZoneConfigDto | null;
  /** The current row of exactly this group, closed when the new one starts. */
  current: SpeedZoneConfigDto | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const unit = props.kind === 'absolute' ? 'm/s' : '%';
  const [zones, setZones] = useState<DraftZone[]>(() =>
    rowsOf(props.initial).map((row) => ({
      key: nextKey(),
      code: row.code,
      min: formatNumber(row.min, { maxDecimals: 2, grouping: false }),
    })),
  );
  const [highSpeed, setHighSpeed] = useState(props.initial.highSpeedZoneCode);
  const [fromText, setFromText] = useState<string>(props.planned?.validFrom ?? props.today);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (input: { zoneSet: ZoneSetBody; validFrom: LocalDate; clientUuid: string }) =>
      props.planned !== null
        ? api.updateSpeedZoneConfig({
            params: { speedZoneConfigId: props.planned.id },
            body: {
              version: props.planned.version,
              zoneSet: input.zoneSet,
              validFrom: input.validFrom,
            },
          })
        : api.createSpeedZoneConfig({
            body: {
              clientUuid: input.clientUuid,
              sport: props.sport,
              sex: props.sex,
              zoneSet: input.zoneSet,
              validFrom: input.validFrom,
              ...(props.current === null ? {} : { closePrevious: true }),
            },
          }),
    onSuccess: async () => {
      await invalidateConfiguration(queryClient, selection);
      props.onDone();
    },
  });

  const update = (key: string, patch: Partial<DraftZone>) => {
    setZones((current) => current.map((zone) => (zone.key === key ? { ...zone, ...patch } : zone)));
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const parsed = zones.map((zone) => {
      const min = parseDecimal(zone.min);
      if (min === null) next[zone.key] = t('configuration.numberInvalid');
      return { code: zone.code.trim(), min: min ?? Number.NaN };
    });
    const validFrom = parseDateInput(fromText);
    if (validFrom === null) next.from = t('configuration.dateRequired');
    else if (validFrom < props.today) next.from = t('configuration.dateFromToday');
    const zoneSet: ZoneSetBody =
      props.kind === 'absolute'
        ? {
            kind: 'absolute',
            zones: parsed.map((zone) => ({ code: zone.code, minSpeedMs: zone.min })),
            highSpeedZoneCode: highSpeed,
          }
        : {
            kind: 'relative',
            zones: parsed.map((zone) => ({ code: zone.code, minVmaxPct: zone.min })),
            highSpeedZoneCode: highSpeed,
          };
    if (Object.keys(next).length === 0) {
      try {
        // The same check the API runs (ADR 0062): the error shows here, not as a 400.
        validateSpeedZoneSet(zoneSet);
      } catch (error) {
        if (!(error instanceof DomainValidationError)) throw error;
        next.zones = t('configuration.zones.invalid');
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || validFrom === null) return;
    save.mutate({ zoneSet, validFrom, clientUuid: newClientUuid() });
  };

  const busy = save.isPending;
  return (
    <form className="sp-form sp-config__editor" onSubmit={submit} noValidate>
      <p>
        {props.planned === null
          ? t('configuration.zones.newFrom')
          : t('configuration.zones.plannedEdit')}
      </p>
      {save.error === null ? null : <ErrorNotice error={save.error} />}
      {errors.zones === undefined ? null : (
        <Notice level="warning" role="alert">
          <p>{errors.zones}</p>
        </Notice>
      )}
      <ol className="sp-config__zone-list">
        {zones.map((zone, index) => (
          <li key={zone.key} className="sp-form__row">
            <TextField
              label={`${t('configuration.zones.code')} ${String(index + 1)}`}
              value={zone.code}
              disabled={busy}
              onChange={(event) => {
                update(zone.key, { code: event.currentTarget.value });
              }}
            />
            <TextField
              label={`${t('configuration.zones.lowerBound', { unit })} ${String(index + 1)}`}
              inputMode="decimal"
              value={zone.min}
              error={errors[zone.key]}
              disabled={busy}
              onChange={(event) => {
                update(zone.key, { min: event.currentTarget.value });
              }}
            />
            <div className="sp-form__actions">
              <Button
                variant="ghost"
                disabled={busy || zones.length <= 1}
                onClick={() => {
                  setZones((current) => current.filter((candidate) => candidate.key !== zone.key));
                }}
              >
                {t('configuration.zones.remove', {
                  zone: zone.code === '' ? String(index + 1) : zoneLabel(t, zone.code),
                })}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="sp-form__actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setZones((current) => [...current, { key: nextKey(), code: '', min: '' }]);
          }}
        >
          {t('configuration.zones.add')}
        </Button>
      </div>
      <div className="sp-form__row">
        <SelectField
          label={t('configuration.zones.highSpeedFrom')}
          value={highSpeed}
          disabled={busy}
          options={zones
            .filter((zone) => zone.code.trim() !== '')
            .map((zone) => ({ value: zone.code.trim(), label: zoneLabel(t, zone.code.trim()) }))}
          onChange={(event) => {
            setHighSpeed(event.currentTarget.value);
          }}
        />
        <TextField
          label={t('configuration.validFrom')}
          type="date"
          min={props.today}
          value={fromText}
          error={errors.from}
          disabled={busy}
          onChange={(event) => {
            setFromText(event.currentTarget.value);
          }}
        />
      </div>
      <div className="sp-form__actions">
        <Button type="submit" disabled={busy}>
          {t('configuration.zones.save')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
