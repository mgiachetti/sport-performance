import type { StatusLevel } from '@sport-performance/ui-tokens';
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useT } from '../i18n/i18n';
import { StatusChip } from './components';
import { Icon } from './icons';

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
  hideLabel,
  help,
  error,
  options,
  ...select
}: {
  label: string;
  /** Keep the label for assistive technology only (a select inside a table row). */
  hideLabel?: boolean;
  help?: string | undefined;
  error?: string | null | undefined;
  options: readonly SelectOption[];
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>) {
  const id = useId();
  return (
    <div className="sp-field">
      <label htmlFor={id} className={hideLabel === true ? 'sp-visually-hidden' : 'sp-field__label'}>
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

/**
 * A labelled file picker in es-AR: the browser draws its own button and
 * "no file" text in the browser's language, so the native input stays (same
 * label, focus, keyboard and screen-reader announcement) but transparent, on
 * top of our own button and file name, which are only visual.
 * `fileName` shows the parent's chosen file when it clears the input itself;
 * without it, the field shows what was last picked.
 */
export function FileField({
  label,
  help,
  error,
  fileName,
  onChange,
  ...input
}: {
  label: string;
  help?: string | undefined;
  error?: string | null | undefined;
  fileName?: string | null | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const t = useT();
  const id = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const shown = fileName === undefined ? picked : fileName;
  return (
    <div className="sp-field">
      <label htmlFor={id} className="sp-field__label">
        {label}
      </label>
      <span className="sp-file" data-invalid={error ? true : undefined}>
        <input
          id={id}
          type="file"
          className="sp-file__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, help, error)}
          onChange={(event) => {
            setPicked(event.target.files?.[0]?.name ?? null);
            onChange?.(event);
          }}
          {...input}
        />
        <span className="sp-file__button" aria-hidden="true">
          {t('field.file.choose')}
        </span>
        <span className="sp-file__name" aria-hidden="true">
          {shown ?? t('field.file.none')}
        </span>
      </span>
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

/** An inline status (a table cell, a list row): the status chip, icon + text. */
export function StatusLabel(props: { level: StatusLevel | 'info'; children: ReactNode }) {
  return <StatusChip level={props.level}>{props.children}</StatusChip>;
}
