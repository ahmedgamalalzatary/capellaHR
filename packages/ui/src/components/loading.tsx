import { LoaderCircle } from 'lucide-react';

import { cn } from '../lib/cn';

/** Decorative spinner; pair it with visible or screen-reader text. */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-4 shrink-0 animate-spin', className)} aria-hidden />;
}

/** Waiting state. The label is the accessible name, so a screen reader says exactly what is loading. */
export function LoadingState({
  label,
  align = 'center',
  className,
}: {
  label: string;
  /** `start` inside a form column; `center` for a whole panel. */
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
      <Spinner />
      {label}
    </p>
  );
}

/** A placeholder block in the shape of the content that is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-line/60', className)} />;
}

/** Placeholder rows for a list that is still loading. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} className="h-10" />
      ))}
    </div>
  );
}
