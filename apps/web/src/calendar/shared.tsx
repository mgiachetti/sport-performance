import { ApiError } from '@sport-performance/contracts';
import { useEffect, useRef, type ReactNode } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Notice } from '../ui/components';
import { calendarKey } from './queries';

/** Refetches everything of the calendar (grid, lists and seasons) after a change. */
export function useRefreshCalendar(): () => Promise<void> {
  const { queryClient } = useServices();
  const { selection } = useActiveClub();
  return () => queryClient.invalidateQueries({ queryKey: calendarKey(selection) });
}

/** Key of an editor: a new version (refetched after a `409`) opens it again on it. */
export function versionKey(
  entity: { readonly id: string; readonly version: string } | null,
): string {
  return entity === null ? 'new' : `${entity.id}@${entity.version}`;
}

/** `409`: someone changed it meanwhile, or it collides with the calendar (ADR 0032). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'conflict';
}

/**
 * The error of a save: a conflict explains itself (the data was refetched),
 * anything else is the error envelope with its request id. `reloaded`: the
 * editor was opened again on the refetched data after a conflict, so the
 * explanation stays until the next error.
 */
export function SaveError(props: { error: unknown; reloaded?: boolean }) {
  const t = useT();
  const none = props.error === null || props.error === undefined;
  if (none && props.reloaded !== true) return null;
  if (none || isConflict(props.error)) {
    return (
      <Notice level="warning" role="alert">
        <p>{t('calendar.conflict')}</p>
      </Notice>
    );
  }
  return <ErrorNotice error={props.error} />;
}

/**
 * Frame of an editor (a test day, a match, a season, a window): a titled
 * card that takes the focus when it opens, so keyboard and screen reader
 * users land on it, and a close button.
 */
export function EditorFrame(props: {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [props.id]);
  return (
    <section className="sp-card sp-cal__editor" aria-labelledby={props.id}>
      <header className="sp-cal__editor-head">
        <h2 id={props.id} ref={heading} tabIndex={-1} className="sp-card__title">
          {props.title}
        </h2>
        <Button variant="ghost" onClick={props.onClose}>
          {t('calendar.editor.close')}
        </Button>
      </header>
      {props.children}
    </section>
  );
}
