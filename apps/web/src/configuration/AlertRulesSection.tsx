import type { AlertRuleDto } from '@sport-performance/contracts';
import {
  ALERT_RULE_KINDS,
  AlertRuleValidationError,
  DEFAULT_ALERT_RULES,
  SEXES,
  SPORTS,
  STAGES,
  isWellFormedCode,
  parseAlertRule,
  type AlertRule,
  type AlertRuleKind,
  type AlertRuleParamsByKind,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { formatNumber, isMessageKey, PLACEHOLDER, type Translator } from '@sport-performance/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { CheckboxField, CheckboxGroup } from '../ui/choice';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { alertRulesQuery, invalidateConfiguration } from './queries';
import { newClientUuid, parseDecimal, stageLabel } from './shared';

type T = Translator['t'];
type Params = Readonly<Record<string, number | null>>;
interface Scope {
  readonly sports?: readonly Sport[] | undefined;
  readonly sexes?: readonly Sex[] | undefined;
  readonly stages?: readonly Stage[] | undefined;
}

const kindLabel = (t: T, kind: AlertRuleKind) => translate(t, `configuration.rules.kind.${kind}`);

function paramLabel(t: T, param: string): string {
  const key = `configuration.rules.param.${param}`;
  return isMessageKey(key) ? translate(t, key) : param;
}

/** Thresholds are the nullable params; the rest are counts of days or samples. */
const isThreshold = (param: string) => param.startsWith('warning') || param.startsWith('critical');

/** The threshold params of each kind, by severity (typed against the domain's params). */
const THRESHOLD_PARAMS: {
  readonly [K in AlertRuleKind]: {
    readonly warning: keyof AlertRuleParamsByKind[K] & string;
    readonly critical: keyof AlertRuleParamsByKind[K] & string;
  };
} = {
  acwr_high: { warning: 'warningAboveRatio', critical: 'criticalAboveRatio' },
  acwr_low: { warning: 'warningBelowRatio', critical: 'criticalBelowRatio' },
  wellness_low: { warning: 'warningBelowScore', critical: 'criticalBelowScore' },
  wellness_zscore_low: { warning: 'warningBelowZScore', critical: 'criticalBelowZScore' },
  cmj_drop: { warning: 'warningDropPct', critical: 'criticalDropPct' },
  growth_peak: { warning: 'warningAtOrAboveCmYear', critical: 'criticalAtOrAboveCmYear' },
};

function thresholdOf(
  kind: AlertRuleKind,
  params: Params,
  severity: 'warning' | 'critical',
): number | null {
  return params[THRESHOLD_PARAMS[kind][severity]] ?? null;
}

function scopeText(t: T, scope: Scope): string {
  const parts = [
    scope.sports?.map((sport) => t(`sport.${sport}`)).join(', '),
    scope.sexes?.map((sex) => t(`sex.${sex}`)).join(', '),
    scope.stages?.map((stage) => stageLabel(t, stage)).join(', '),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? t('configuration.everyone') : parts.join(' · ');
}

function formatParam(value: number | null): string {
  return value === null ? PLACEHOLDER : formatNumber(value, { maxDecimals: 2 });
}

export function AlertRulesSection(props: { canEdit: boolean }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const rules = useQuery(alertRulesQuery(api, selection));
  const [editing, setEditing] = useState<AlertRuleDto | 'new' | null>(null);
  const [saved, setSaved] = useState(false);

  const done = () => {
    setEditing(null);
    setSaved(true);
  };

  return (
    <section className="sp-card" aria-labelledby="rules-title">
      <h2 id="rules-title" className="sp-card__title">
        {t('configuration.rules.title')}
      </h2>
      <Notice level="info">
        <p>{t('configuration.rules.disclaimer')}</p>
      </Notice>
      {saved ? (
        <Notice level="ok" role="status">
          <p>{t('configuration.saved')}</p>
        </Notice>
      ) : null}
      {rules.error !== null ? (
        <ErrorNotice error={rules.error} />
      ) : rules.data === undefined ? (
        <Loading />
      ) : rules.data.length === 0 ? (
        <p>{t('configuration.rules.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('configuration.rules.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('configuration.rules.rule')}</th>
                <th scope="col">{t('configuration.rules.appliesTo')}</th>
                <th scope="col" className="sp-num">
                  {t('configuration.rules.warning')}
                </th>
                <th scope="col" className="sp-num">
                  {t('configuration.rules.critical')}
                </th>
                <th scope="col">{t('configuration.rules.state')}</th>
                {props.canEdit ? <th scope="col">{t('configuration.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rules.data.map((rule) => {
                const params = rule.params as Params;
                return (
                  <tr key={rule.id}>
                    <th scope="row">
                      <span>{kindLabel(t, rule.kind)}</span>
                      <span className="sp-config__code">{rule.code}</span>
                      {rule.isDefault ? (
                        <span className="sp-tag sp-matrix__tag">
                          {t('configuration.rules.default')}
                        </span>
                      ) : null}
                    </th>
                    <td>{scopeText(t, rule.appliesTo)}</td>
                    <td className="sp-num">
                      {formatParam(thresholdOf(rule.kind, params, 'warning'))}
                    </td>
                    <td className="sp-num">
                      {formatParam(thresholdOf(rule.kind, params, 'critical'))}
                    </td>
                    <td>
                      {rule.enabled ? (
                        <StatusLabel level="ok">{t('configuration.rules.enabled')}</StatusLabel>
                      ) : (
                        <StatusLabel level="warning">
                          {t('configuration.rules.disabled')}
                        </StatusLabel>
                      )}
                    </td>
                    {props.canEdit ? (
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSaved(false);
                            setEditing(rule);
                          }}
                        >
                          {t('common.edit')}
                          <span className="sp-visually-hidden">{` ${rule.code}`}</span>
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
      {props.canEdit && editing === null ? (
        <div className="sp-form__actions sp-config__after-table">
          <Button
            variant="secondary"
            onClick={() => {
              setSaved(false);
              setEditing('new');
            }}
          >
            {t('configuration.rules.new')}
          </Button>
        </div>
      ) : null}
      {editing === null ? null : (
        <RuleEditor
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          onCancel={() => {
            setEditing(null);
          }}
          onDone={done}
        />
      )}
    </section>
  );
}

/** The domain rule as a create body: same fields, with a fresh params object. */
function withMutableParams(rule: AlertRule) {
  return { code: rule.code, enabled: rule.enabled, ...kindAndParams(rule) };
}

function kindAndParams(rule: AlertRule) {
  switch (rule.kind) {
    case 'acwr_high':
      return { kind: rule.kind, params: { ...rule.params } };
    case 'acwr_low':
      return { kind: rule.kind, params: { ...rule.params } };
    case 'wellness_low':
      return { kind: rule.kind, params: { ...rule.params } };
    case 'wellness_zscore_low':
      return { kind: rule.kind, params: { ...rule.params } };
    case 'cmj_drop':
      return { kind: rule.kind, params: { ...rule.params } };
    case 'growth_peak':
      return { kind: rule.kind, params: { ...rule.params } };
  }
}

function defaultsOf(kind: AlertRuleKind): Params {
  const rule = DEFAULT_ALERT_RULES.find((candidate) => candidate.kind === kind);
  return (rule?.params ?? {}) as Params;
}

const toText = (params: Params) =>
  Object.fromEntries(
    Object.entries(params).map(([param, value]) => [
      param,
      value === null ? '' : formatNumber(value, { maxDecimals: 4, grouping: false }),
    ]),
  );

function RuleEditor(props: {
  rule: AlertRuleDto | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const { rule } = props;
  const [kind, setKind] = useState<AlertRuleKind>(rule?.kind ?? 'acwr_high');
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [values, setValues] = useState<Record<string, string>>(() =>
    toText(rule === null ? defaultsOf('acwr_high') : rule.params),
  );
  const [sports, setSports] = useState<Sport[]>([...(rule?.appliesTo.sports ?? [])]);
  const [sexes, setSexes] = useState<Sex[]>([...(rule?.appliesTo.sexes ?? [])]);
  const [stages, setStages] = useState<Stage[]>([...(rule?.appliesTo.stages ?? [])]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (input: { rule: AlertRule; appliesTo: Scope; clientUuid: string }) => {
      const appliesTo = {
        ...(input.appliesTo.sports === undefined ? {} : { sports: [...input.appliesTo.sports] }),
        ...(input.appliesTo.sexes === undefined ? {} : { sexes: [...input.appliesTo.sexes] }),
        ...(input.appliesTo.stages === undefined ? {} : { stages: [...input.appliesTo.stages] }),
      };
      if (rule !== null) {
        return api.updateAlertRule({
          params: { alertRuleId: rule.id },
          body: {
            version: rule.version,
            enabled: input.rule.enabled,
            appliesTo: Object.keys(appliesTo).length === 0 ? null : appliesTo,
            params: { ...input.rule.params },
          },
        });
      }
      return api.createAlertRule({
        body: { ...withMutableParams(input.rule), clientUuid: input.clientUuid, appliesTo },
      });
    },
    onSuccess: async () => {
      await invalidateConfiguration(queryClient, selection);
      props.onDone();
    },
  });

  const paramNames = Object.keys(rule === null ? defaultsOf(kind) : rule.params);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const params: Record<string, number | null> = {};
    for (const param of paramNames) {
      const text = (values[param] ?? '').trim();
      if (text === '' && isThreshold(param)) {
        params[param] = null;
        continue;
      }
      const value = parseDecimal(text);
      if (value === null) {
        next[param] = t('configuration.numberInvalid');
        continue;
      }
      if (!isThreshold(param) && !Number.isInteger(value)) {
        next[param] = t('configuration.integerInvalid');
        continue;
      }
      params[param] = value;
    }
    if (rule === null && !isWellFormedCode(code.trim())) {
      next.code = t('configuration.rules.new.codeInvalid');
    }
    const appliesTo: Scope = {
      ...(sports.length === 0 ? {} : { sports }),
      ...(sexes.length === 0 ? {} : { sexes }),
      ...(stages.length === 0 ? {} : { stages }),
    };
    let parsed: AlertRule | null = null;
    if (Object.keys(next).length === 0) {
      try {
        // The same semantic check the API runs (severity order, ranges, windows).
        parsed = parseAlertRule({
          code: rule?.code ?? code.trim(),
          kind: rule?.kind ?? kind,
          enabled,
          ...(Object.keys(appliesTo).length === 0 ? {} : { appliesTo }),
          params,
        });
      } catch (error) {
        if (!(error instanceof AlertRuleValidationError)) throw error;
        const param = /^params\.(\w+)/.exec(error.path)?.[1];
        if (param !== undefined && paramNames.includes(param)) {
          next[param] = t('configuration.rules.invalid');
        } else next.rule = t('configuration.rules.invalidRule');
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || parsed === null) return;
    save.mutate({ rule: parsed, appliesTo, clientUuid: newClientUuid() });
  };

  const busy = save.isPending;
  const title =
    rule === null
      ? t('configuration.rules.new')
      : t('configuration.rules.editor.title', {
          rule: `${kindLabel(t, rule.kind)} (${rule.code})`,
        });

  return (
    <section className="sp-config__editor" aria-labelledby="rule-editor-title">
      <h3 id="rule-editor-title" className="sp-config__subtitle">
        {title}
      </h3>
      {save.error === null ? null : <ErrorNotice error={save.error} />}
      {errors.rule === undefined ? null : (
        <Notice level="warning" role="alert">
          <p>{errors.rule}</p>
        </Notice>
      )}
      <form className="sp-form" onSubmit={submit} noValidate>
        {rule === null ? (
          <div className="sp-form__row">
            <SelectField
              label={t('configuration.rules.new.kind')}
              value={kind}
              disabled={busy}
              options={ALERT_RULE_KINDS.map((value) => ({ value, label: kindLabel(t, value) }))}
              onChange={(event) => {
                const value = event.currentTarget.value as AlertRuleKind;
                setKind(value);
                setValues(toText(defaultsOf(value)));
                setErrors({});
              }}
            />
            <TextField
              label={t('configuration.rules.new.code')}
              help={t('configuration.rules.new.codeHelp')}
              value={code}
              error={errors.code}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => {
                setCode(event.currentTarget.value);
              }}
            />
          </div>
        ) : null}
        <CheckboxField
          label={t('configuration.rules.enabledLabel')}
          checked={enabled}
          disabled={busy}
          onChange={(event) => {
            setEnabled(event.currentTarget.checked);
          }}
        />
        <div className="sp-form__row">
          {paramNames.map((param) => (
            <TextField
              key={param}
              label={paramLabel(t, param)}
              help={isThreshold(param) ? t('configuration.rules.thresholdHelp') : undefined}
              inputMode="decimal"
              value={values[param] ?? ''}
              error={errors[param]}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setValues((current) => ({ ...current, [param]: value }));
              }}
            />
          ))}
        </div>
        <div className="sp-form__row">
          <CheckboxGroup
            legend={t('configuration.rules.scope.sports')}
            help={t('configuration.rules.scope.help')}
            options={SPORTS.map((value) => ({ value, label: t(`sport.${value}`) }))}
            value={sports}
            onChange={setSports}
            disabled={busy}
          />
          <CheckboxGroup
            legend={t('configuration.rules.scope.sexes')}
            options={SEXES.map((value) => ({ value, label: t(`sex.${value}`) }))}
            value={sexes}
            onChange={setSexes}
            disabled={busy}
          />
          <CheckboxGroup
            legend={t('configuration.rules.scope.stages')}
            options={STAGES.map((value) => ({ value, label: stageLabel(t, value) }))}
            value={stages}
            onChange={setStages}
            disabled={busy}
          />
        </div>
        <div className="sp-form__actions">
          <Button type="submit" disabled={busy}>
            {rule === null ? t('configuration.rules.new.create') : t('configuration.rules.save')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
