import type { StatusLevel } from '@sport-performance/ui-tokens';
import {
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './icons';

/**
 * Form fields and inline status of the screens, next to `TextField` in
 * `components.tsx`: same label, help and error wiring (`aria-describedby`),
 * same `sp-field` styles.
 */

function describedBy(id: string, help: string | undefined, error: string | null | undefined) {
  const ids = [help === undefined ? null : `${id}-help`, error ? `${id}-error` : null].filter(
    Boolean,
  );
  return ids.length === 0 ? undefined : ids.join(' ');
}

function FieldFoot(props: { id: string; help?: string | undefined; error?: string | null }) {
  return (
    <>
      {props.help === undefined ? null : (
        <p id={`${props.id}-help`} className="sp-field__help">
          {props.help}
        </p>
      )}
      {props.error ? (
        <p id={`${props.id}-error`} className="sp-field__error">
          <Icon name="critical" />
          <span>{props.error}</span>
        </p>
      ) : null}
    </>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** A labelled `<select>` with its options. */
export function SelectField({
  label,
  help,
  error,
  options,
  ...select
}: {
  label: string;
  help?: string | undefined;
  error?: string | null | undefined;
  options: readonly SelectOption[];
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>) {
  const id = useId();
  return (
    <div className="sp-field">
      <label htmlFor={id} className="sp-field__label">
        {label}
      </label>
      <select
        id={id}
        className="sp-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldFoot id={id} help={help} error={error ?? null} />
    </div>
  );
}

/** A labelled `<textarea>`. */
export function TextAreaField({
  label,
  help,
  error,
  ...textarea
}: {
  label: string;
  help?: string | undefined;
  error?: string | null | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  const id = useId();
  return (
    <div className="sp-field">
      <label htmlFor={id} className="sp-field__label">
        {label}
      </label>
      <textarea
        id={id}
        className="sp-field__input sp-field__textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        {...textarea}
      />
      <FieldFoot id={id} help={help} error={error ?? null} />
    </div>
  );
}

/** A group of fields under one legend, with the group's help and error. */
export function FieldGroup(props: {
  legend: string;
  help?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="sp-fieldset" aria-describedby={describedBy(id, props.help, props.error)}>
      <legend className="sp-field__label">{props.legend}</legend>
      {props.help === undefined ? null : (
        <p id={`${id}-help`} className="sp-field__help">
          {props.help}
        </p>
      )}
      <div className="sp-fieldset__body">{props.children}</div>
      <FieldFoot id={id} error={props.error ?? null} />
    </fieldset>
  );
}

const LEVEL_ICONS: Record<StatusLevel | 'info', IconName> = {
  ok: 'ok',
  warning: 'warning',
  critical: 'critical',
  info: 'info',
};

/** An inline status (a table cell, a list row): always icon + text, never color alone. */
export function StatusLabel(props: { level: StatusLevel | 'info'; children: ReactNode }) {
  return (
    <span className={`sp-status sp-status--${props.level}`}>
      <Icon name={LEVEL_ICONS[props.level]} />
      <span>{props.children}</span>
    </span>
  );
}
