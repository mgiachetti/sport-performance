import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { membershipsQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { useSignOut } from '../session/use-sign-out';
import { Avatar, buttonClass, Button, ErrorNotice } from '../ui/components';
import { Icon } from '../ui/icons';
import { initialsOf } from '../lib/initials';
import { ThemeSwitcher } from './ThemeSwitcher';

/**
 * The account in the sidebar footer (ADR 0097): who is signed in and with
 * which role; it opens a panel with the colors (dark or light high-contrast),
 * the club switch and sign-out. A disclosure, not an ARIA menu: the panel
 * holds a radio group. Escape and a click outside close it.
 */
export function UserMenu() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const signOut = useSignOut();
  const memberships = useQuery(membershipsQuery(api));
  const canSwitch = active.user.isSuperadmin || (memberships.data?.items.length ?? 0) > 1;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const name = active.user.name.trim() === '' ? active.user.email : active.user.name;
  const role = t(`role.${active.role}`);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        // Handled here: the drawer around the menu (narrow screens) stays open.
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase: it runs before the drawer's listener (bubble phase), which then sees it handled.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="sp-user-menu" ref={root}>
      <div
        id={panelId}
        className="sp-user-menu__panel"
        role="group"
        aria-label={t('account.menu')}
        hidden={!open}
      >
        <ThemeSwitcher />
        <div className="sp-user-menu__actions">
          {canSwitch ? (
            <Link to="/clubs" className={buttonClass('ghost', 'sm', 'sp-user-menu__action')}>
              <Icon name="club" />
              <span>{t('club.switch')}</span>
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="sp-user-menu__action"
            onClick={() => {
              signOut.mutate();
            }}
            disabled={signOut.isPending}
          >
            <Icon name="signOut" />
            <span>{t('auth.signOut')}</span>
          </Button>
        </div>
        {signOut.isError ? <ErrorNotice error={signOut.error} /> : null}
      </div>
      <button
        ref={button}
        type="button"
        className="sp-user-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Avatar label={initialsOf(name)} variant="brand" />
        <span className="sp-user-menu__who">
          <span className="sp-visually-hidden">{t('account.menu')}: </span>
          <span className="sp-user-menu__name">{name}</span>
          <span className="sp-user-menu__role">{role}</span>
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size={18} />
      </button>
    </div>
  );
}
