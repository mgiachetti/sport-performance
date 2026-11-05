import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * The way back to a list, above the page title: a quiet link with a
 * chevron (the page's primary action stays the only filled button).
 */
export function BackLink(props: { to: NonNullable<LinkProps['to']>; children: ReactNode }) {
  return (
    <Link to={props.to} className="sp-back-link">
      <Icon name="chevronLeft" />
      <span>{props.children}</span>
    </Link>
  );
}
