import { LoaderCircle } from 'lucide-react';

import { cn } from '@capella/ui';

/**
 * Waiting state. The spinner is decorative; the label is the accessible name so
 * a screen reader announces exactly what is loading.
 */
export function LoadingState({
  label,
  align = 'center',
  className,
}: {
  label: string;
  /** `start` for a spinner sitting inside a form column; `center` for a whole panel. */
  align?: 'center' | 'start';
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 p-6 text-sm text-muted',
        align === 'start' ? 'justify-start' : 'justify-center',
        className,
      )}
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
      {label}
    </p>
  );
}

/** Placeholder rows for a table or list that is still loading. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: rows }, (_unused, index) => (
        <div key={index} className="h-9 animate-pulse rounded-control bg-surface" />
      ))}
    </div>
  );
}
