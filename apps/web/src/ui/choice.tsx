import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Checkboxes of the forms: one labelled box, and a group of them under a
 * `<fieldset>` with its legend and help (the screen reader announces the
 * group before each option).
 */

export function CheckboxField({
  label,
  ...input
}: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const id = useId();
  return (
    <div className="sp-check">
      <input id={id} type="checkbox" className="sp-check__input" {...input} />
      <label htmlFor={id} className="sp-check__label">
        {label}
      </label>
    </div>
  );
}

export interface CheckboxOption<V extends string | number> {
  readonly value: V;
  readonly label: string;
  readonly disabled?: boolean;
}

export function CheckboxGroup<V extends string | number>(props: {
  legend: string;
  help?: string;
  options: readonly CheckboxOption<V>[];
  value: readonly V[];
  onChange: (value: V[]) => void;
  disabled?: boolean;
}) {
  const helpId = useId();
  const toggle = (option: V, checked: boolean) => {
    const next = props.options
      .map((candidate) => candidate.value)
      .filter((value) => (value === option ? checked : props.value.includes(value)));
    props.onChange(next);
  };
  return (
    <fieldset
      className="sp-check-group"
      aria-describedby={props.help === undefined ? undefined : helpId}
      disabled={props.disabled}
    >
      <legend className="sp-field__label">{props.legend}</legend>
      <div className="sp-check-group__options">
        {props.options.map((option) => (
          <CheckboxField
            key={option.value}
            label={option.label}
            checked={props.value.includes(option.value)}
            disabled={option.disabled}
            onChange={(event) => {
              toggle(option.value, event.currentTarget.checked);
            }}
          />
        ))}
      </div>
      {props.help === undefined ? null : (
        <p id={helpId} className="sp-field__help">
          {props.help}
        </p>
      )}
    </fieldset>
  );
}
