import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string | undefined;
  /**
   * The page's one main action. On phones it is also pinned above the bottom edge, so it stays
   * reachable after scrolling a long list.
   */
  primaryAction?: ReactNode;
  /** Secondary actions (export, print…), shown before the primary one. */
  actions?: ReactNode;
  /** Small line above the title (e.g. a back link or the branch name). */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * One title block for every page in both apps: what this screen is, what it does, and its one
 * primary action.
 */
export function PageHeader({ title, description, primaryAction, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-[13px] text-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-sm text-muted">{description}</p> : null}
      </div>
      {actions || primaryAction ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {primaryAction ? (
            // Phones: pinned above the bottom edge (and above the cashier tab bar); the shell's
            // main area keeps bottom padding so it never covers the last row.
            <div
              data-primary-action
              className={cn(
                'max-sm:fixed max-sm:inset-x-4 max-sm:bottom-[calc(var(--bottom-bar-h,0px)+env(safe-area-inset-bottom)+0.75rem)]',
                'max-sm:z-(--z-sticky) max-sm:[&>*]:w-full max-sm:[&>*]:shadow-raised',
              )}
            >
              {primaryAction}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
