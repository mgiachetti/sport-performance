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

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      type={type}
      className={['sp-button', `sp-button--${variant}`, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}

/** A labelled input with its help and error text wired by `aria-describedby`. */
export function TextField({
  label,
  help,
  error,
  ...input
}: { label: string; help?: string | undefined; error?: string | null | undefined } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id'
>) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help === undefined ? null : helpId, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="sp-field">
      <label htmlFor={id} className="sp-field__label">
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

/** Jersey stripes (brand primary/secondary), the visual seal of the club. */
export function Stripes(props: { size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`sp-stripes sp-stripes--${props.size ?? 'sm'}`} aria-hidden="true" />;
}
