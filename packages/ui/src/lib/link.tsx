'use client';

import { createContext, useContext, type ComponentType, type MouseEventHandler, type ReactNode } from 'react';

/** What shared components pass to a link (kept small so Next's `Link` fits it as-is). */
export interface UiLinkProps {
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  'aria-current'?: 'page';
  'aria-label'?: string;
  title?: string;
}

const PlainLink = (props: UiLinkProps) => <a {...props} />;

const LinkContext = createContext<ComponentType<UiLinkProps>>(PlainLink);

/**
 * Lets shared components render the app's router link (Next `Link`) without this package
 * depending on Next. Each app wraps its tree once: `<UiLinkProvider component={Link}>`.
 */
export function UiLinkProvider({ component, children }: { component: ComponentType<UiLinkProps>; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export function useUiLink() {
  return useContext(LinkContext);
}
