import { cn } from '@capella/ui';

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <p
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cn('p-6 text-center text-sm text-muted', className)}
    >
      {label}
    </p>
  );
}
