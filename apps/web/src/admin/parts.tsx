import { ApiError } from '@sport-performance/contracts';
import { localDateInTimeZone, type LocalDate } from '@sport-performance/domain';
import { formatDateTime, formatLocalDate } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice } from '../ui/components';

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
  onConfirm: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        variant="secondary"
        disabled={props.disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {props.label}
      </Button>
    );
  }
  return (
    <div className="sp-admin__confirm" role="group" aria-label={props.label}>
      <p>{props.question}</p>
      <div className="sp-form__actions">
        <Button
          disabled={props.pending}
          onClick={() => {
            props.onConfirm();
            setOpen(false);
          }}
        >
          {props.confirmLabel ?? props.label}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </div>
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

/** A section of the administration: heading, intro and content. */
export function AdminSection(props: {
  id: string;
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sp-card sp-admin__section" aria-labelledby={props.id}>
      <header className="sp-admin__section-head">
        <div>
          <h2 id={props.id} className="sp-card__title">
            {props.title}
          </h2>
          {props.intro === undefined ? null : <p className="sp-admin__intro">{props.intro}</p>}
        </div>
        {props.actions === undefined ? null : (
          <div className="sp-form__actions">{props.actions}</div>
        )}
      </header>
      {props.children}
    </section>
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
