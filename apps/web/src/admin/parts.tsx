import { ApiError } from '@sport-performance/contracts';
import { localDateInTimeZone, type LocalDate } from '@sport-performance/domain';
import { formatDateTime, formatLocalDate } from '@sport-performance/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import {
  Button,
  Card,
  ErrorNotice,
  Loading,
  Notice,
  type ButtonSize,
  type ButtonVariant,
} from '../ui/components';

/** `409`: someone changed it meanwhile, or a rule of the club forbids it (ADR 0032). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'conflict';
}

/**
 * The error of a change: a conflict explains itself (the list is read
 * again), anything else is the error envelope with its request id.
 */
export function ActionError(props: { error: unknown; conflictText?: string }) {
  const t = useT();
  if (props.error === null || props.error === undefined) return null;
  if (isConflict(props.error)) {
    return (
      <Notice level="warning" role="alert">
        <p>{props.conflictText ?? t('admin.conflict')}</p>
      </Notice>
    );
  }
  return <ErrorNotice error={props.error} />;
}

/**
 * The second step of a confirmed action, in place: the consequence in one
 * sentence, confirm and cancel. Escape cancels; with `autoFocus` the confirm
 * button takes the focus when it opens (the caller puts it back on cancel).
 */
export function ConfirmPanel(props: {
  label: string;
  /** What happens, in one sentence. */
  question: ReactNode;
  confirmLabel?: string | undefined;
  confirmVariant?: ButtonVariant;
  pending?: boolean | undefined;
  autoFocus?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const groupRef = useRef<HTMLDivElement>(null);
  const autoFocus = props.autoFocus === true;
  useEffect(() => {
    if (autoFocus) groupRef.current?.querySelector('button')?.focus();
  }, [autoFocus]);
  return (
    <div
      ref={groupRef}
      className="sp-admin__confirm"
      role="group"
      aria-label={props.label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onCancel();
        }
      }}
    >
      <p>{props.question}</p>
      <div className="sp-form__actions">
        <Button
          variant={props.confirmVariant ?? 'primary'}
          disabled={props.pending}
          onClick={props.onConfirm}
        >
          {props.confirmLabel ?? props.label}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * A destructive or irreversible action in two steps: the button, then
 * "¿Seguro?" with the consequence, confirm and cancel, in place.
 */
export function ConfirmAction(props: {
  label: string;
  /** What happens, in one sentence. */
  question: string;
  confirmLabel?: string;
  disabled?: boolean;
  pending?: boolean;
  /** The trigger's look (secondary by default; a quieter `ghost` beside a row's main action). */
  variant?: ButtonVariant;
  size?: ButtonSize | undefined;
  /** Why it is disabled, by id (`aria-describedby`). */
  describedBy?: string | undefined;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        variant={props.variant ?? 'secondary'}
        size={props.size ?? 'md'}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onClick={() => {
          setOpen(true);
        }}
      >
        {props.label}
      </Button>
    );
  }
  return (
    <ConfirmPanel
      label={props.label}
      question={props.question}
      confirmLabel={props.confirmLabel}
      pending={props.pending}
      onConfirm={() => {
        props.onConfirm();
        setOpen(false);
      }}
      onCancel={() => {
        setOpen(false);
      }}
    />
  );
}

/** Pager of a cursor list: "Ver más" while there is a next page. */
export function LoadMore(props: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}) {
  const t = useT();
  if (!props.hasNextPage) return null;
  return (
    <div className="sp-admin__more">
      {props.isFetchingNextPage ? (
        <Loading />
      ) : (
        <Button variant="secondary" onClick={() => void props.fetchNextPage()}>
          {t('admin.loadMore')}
        </Button>
      )}
    </div>
  );
}

/**
 * A section of the administration: a `Card` (condensed title, the intro as
 * its muted subtitle, actions on the right). `id` names the section for
 * anchors; the region's name is its title.
 */
export function AdminSection(props: {
  id: string;
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      id={props.id}
      className="sp-admin__section"
      title={props.title}
      subtitle={props.intro}
      actions={props.actions}
    >
      {props.children}
    </Card>
  );
}

/** Today in the club's time zone ("el día" is always the club's, CLAUDE.md). */
export function useClubToday(): LocalDate {
  const { club } = useActiveClub();
  return localDateInTimeZone(new Date(), club.timeZone);
}

/** Formatters of instants and days in the club's time zone. */
export function useClubFormat() {
  const { club } = useActiveClub();
  return {
    dateTime: (iso: string | null) =>
      formatDateTime(iso === null ? null : new Date(iso), { timeZone: club.timeZone }),
    date: (day: string | null) => formatLocalDate(day as LocalDate | null),
  };
}
