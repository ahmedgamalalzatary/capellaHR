import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Arabic empty state for filtered/search results (locked global requirement). */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
