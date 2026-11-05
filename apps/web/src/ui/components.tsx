import type { StatusLevel } from '@sport-performance/ui-tokens';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { describeError } from '../api/errors';
import { useT } from '../i18n/i18n';
import { Icon, type IconName } from './icons';

/**
 * Building blocks of the shell, styled by `styles/app.css` with the `--sp-*`
 * tokens. Screens compose these; anything chart-like lives in the chart
 * library (#65).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * Class names of a button, for links that look like one (`<Link className={buttonClass(…)}>`).
 * Primary: brand fill with its ink; secondary: outline; ghost: text only; danger: critical.
 */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return [
    'sp-button',
    `sp-button--${variant}`,
    size === 'md' ? null : `sp-button--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** A labelled input with its help and error text wired by `aria-describedby`. */
export function TextField({
  label,
  hideLabel,
  help,
  error,
  ...input
}: {
  label: string;
  /** Keep the label for assistive technology only (a search beside a card title). */
  hideLabel?: boolean;
  help?: string | undefined;
  error?: string | null | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help === undefined ? null : helpId, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="sp-field">
      <label htmlFor={id} className={hideLabel === true ? 'sp-visually-hidden' : 'sp-field__label'}>
        {label}
      </label>
      <input
        id={id}
        className="sp-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...input}
      />
      {help === undefined ? null : (
        <p id={helpId} className="sp-field__help">
          {help}
        </p>
      )}
      {error ? (
        <p id={errorId} className="sp-field__error">
          <Icon name="critical" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const STATUS_ICONS: Record<StatusLevel | 'info', IconName> = {
  ok: 'ok',
  warning: 'warning',
  critical: 'critical',
  info: 'info',
};

/** A message with its status: always icon + text, never color alone. */
export function Notice(props: {
  level: StatusLevel | 'info';
  children: ReactNode;
  /** `alert` for errors that interrupt, `status` for polite updates. */
  role?: 'alert' | 'status';
  action?: ReactNode;
}) {
  return (
    <div className={`sp-notice sp-notice--${props.level}`} role={props.role}>
      <Icon name={STATUS_ICONS[props.level]} className="sp-notice__icon" />
      <div className="sp-notice__body">{props.children}</div>
      {props.action === undefined ? null : <div className="sp-notice__action">{props.action}</div>}
    </div>
  );
}

/** The error envelope as the user sees it: one message and the request id for support. */
export function ErrorNotice(props: { error: unknown; action?: ReactNode }) {
  const t = useT();
  const description = describeError(props.error);
  return (
    <Notice level="critical" role="alert" action={props.action}>
      <p>{t(description.messageKey)}</p>
      {description.requestId === undefined ? null : (
        <p className="sp-notice__meta">
          {t('error.requestId', { requestId: description.requestId })}
        </p>
      )}
    </Notice>
  );
}

export function Loading(props: { label?: string }) {
  const t = useT();
  return (
    <div className="sp-loading" role="status">
      <span className="sp-loading__spinner" aria-hidden="true" />
      <span>{props.label ?? t('common.loading')}</span>
    </div>
  );
}

let initialPageRendered = false;

/**
 * Page frame: sets the document title and, after a client-side navigation,
 * moves focus to the heading so screen readers announce the new page.
 */
export function Page(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('app.documentTitle', { page: props.title, appName: t('app.name') });
  }, [props.title, t]);
  useEffect(() => {
    if (initialPageRendered) heading.current?.focus();
    initialPageRendered = true;
  }, []);
  return (
    <section className="sp-page" aria-labelledby="page-title">
      <header className="sp-page__header">
        <div>
          <h1 id="page-title" ref={heading} tabIndex={-1} className="sp-page__title">
            {props.title}
          </h1>
          {props.subtitle === undefined ? null : (
            <p className="sp-page__subtitle">{props.subtitle}</p>
          )}
        </div>
        {props.actions === undefined ? null : (
          <div className="sp-page__actions">{props.actions}</div>
        )}
      </header>
      {props.children}
    </section>
  );
}

/**
 * Jersey stripes (brand primary/secondary), the visual seal of the club.
 * Decorative only. `bands`: the horizontal bands of the jersey (standalone
 * screens); `rail`: a thin vertical strip of bands (edge of the navigation);
 * `seal`: a thin line of alternating segments (under a header).
 */
export function Stripes(props: { size?: 'sm' | 'md' | 'lg'; variant?: 'bands' | 'rail' | 'seal' }) {
  const variant = props.variant ?? 'bands';
  const className =
    variant === 'bands'
      ? `sp-stripes sp-stripes--${props.size ?? 'sm'}`
      : `sp-stripes sp-stripes--${variant}`;
  return <div className={className} aria-hidden="true" />;
}

type HeadingLevel = 2 | 3;

/**
 * A panel of the page: condensed title, muted subtitle, actions on the right.
 * With a title it is a named region (`aria-labelledby`), so assistive
 * technology can jump between cards.
 */
export function Card(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  headingLevel?: HeadingLevel;
  /** `flush`: no inner padding below the header (tables that run edge to edge). */
  variant?: 'default' | 'flush' | 'highlight';
  className?: string;
  children?: ReactNode;
}) {
  const headingId = useId();
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  const hasHeader =
    props.title !== undefined || props.subtitle !== undefined || props.actions !== undefined;
  return (
    <section
      className={[
        'sp-card',
        props.variant === undefined || props.variant === 'default'
          ? null
          : `sp-card--${props.variant}`,
        props.className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={props.title === undefined ? undefined : headingId}
    >
      {hasHeader ? (
        <header className="sp-card__header">
          <div className="sp-card__heading">
            {props.title === undefined ? null : (
              <Heading id={headingId} className="sp-card__title">
                {props.title}
              </Heading>
            )}
            {props.subtitle === undefined ? null : (
              <p className="sp-card__subtitle-text">{props.subtitle}</p>
            )}
          </div>
          {props.actions === undefined ? null : (
            <div className="sp-card__actions">{props.actions}</div>
          )}
        </header>
      ) : null}
      {props.children}
    </section>
  );
}

/**
 * A key figure: muted label, a big condensed tabular value with its unit,
 * a muted caption. `highlighted` marks the tile that needs a look (brand
 * outline and tint); the label and caption say why, never the color alone.
 */
export function KpiTile(props: {
  label: string;
  value: string;
  unit?: string | undefined;
  caption?: string | undefined;
  highlighted?: boolean;
  /** A status on its own row under the figure (`StatusChip`, `StatusBadge`): icon + text, never color alone. */
  status?: ReactNode;
}) {
  return (
    <div className={`sp-kpi${props.highlighted === true ? ' sp-kpi--highlighted' : ''}`}>
      <p className="sp-kpi__label">{props.label}</p>
      <p className="sp-kpi__value">
        <span className="sp-kpi__figure">{props.value}</span>
        {props.unit === undefined ? null : <span className="sp-kpi__unit"> {props.unit}</span>}
      </p>
      {props.status === undefined ? null : <div className="sp-kpi__status">{props.status}</div>}
      {props.caption === undefined ? null : <p className="sp-kpi__caption">{props.caption}</p>}
    </div>
  );
}

export interface SegmentOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

/**
 * A few mutually exclusive options as a row of pills (a native radio group:
 * arrow keys move and select, the group is named by its label). Use it
 * instead of a `<select>` when the options are few and short.
 */
export function SegmentedControl<V extends string>(props: {
  label: string;
  /** Keep the label for assistive technology only. */
  hideLabel?: boolean;
  /** `inline`: the label beside the options, to line up in a row of controls. */
  labelPlacement?: 'above' | 'inline';
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** `stack`: one option per row (long labels, menus). */
  layout?: 'row' | 'stack';
  size?: ButtonSize;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div
      className={[
        'sp-segmented',
        props.layout === 'stack' ? 'sp-segmented--stack' : null,
        props.labelPlacement === 'inline' ? 'sp-segmented--inline' : null,
        props.size === 'sm' ? 'sp-segmented--sm' : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        id={labelId}
        className={props.hideLabel === true ? 'sp-visually-hidden' : 'sp-segmented__label'}
      >
        {props.label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="sp-segmented__options">
        {props.options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <span key={option.value} className="sp-segmented__option">
              <input
                id={optionId}
                type="radio"
                name={id}
                value={option.value}
                checked={option.value === props.value}
                onChange={() => {
                  props.onChange(option.value);
                }}
              />
              <label htmlFor={optionId}>{option.label}</label>
            </span>
          );
        })}
      </div>
    </div>
  );
}

const CHIP_ICONS: Record<StatusLevel | 'info', IconName> = {
  ok: 'ok',
  warning: 'warning',
  critical: 'critical',
  info: 'info',
};

/** A status as a tinted pill: always icon + text, never color alone. */
export function StatusChip(props: { level: StatusLevel | 'info'; children: ReactNode }) {
  return (
    <span className={`sp-status sp-status--${props.level}`}>
      <Icon name={CHIP_ICONS[props.level]} />
      <span>{props.children}</span>
    </span>
  );
}

/** Nothing to show yet: an icon, what is missing and, if any, the next step. */
export function EmptyState(props: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sp-empty">
      <span className="sp-empty__icon" aria-hidden="true">
        <Icon name={props.icon ?? 'info'} size={24} />
      </span>
      <p className="sp-empty__title">{props.title}</p>
      {props.children === undefined ? null : <div className="sp-empty__body">{props.children}</div>}
      {props.action === undefined ? null : <div className="sp-empty__action">{props.action}</div>}
    </div>
  );
}

/**
 * A round badge with a jersey number or initials. Decorative (the name is
 * next to it): drawn by CSS from `data-label`, so it is neither announced nor
 * part of the row's text (copying a name, reading a cell).
 */
export function Avatar(props: {
  label: string;
  variant?: 'default' | 'brand';
  /** `lg`: the head of a profile. */
  size?: 'md' | 'lg';
}) {
  return (
    <span
      className={[
        'sp-avatar',
        props.variant === 'brand' ? 'sp-avatar--brand' : null,
        props.size === 'lg' ? 'sp-avatar--lg' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      data-label={props.label}
      aria-hidden="true"
    />
  );
}
