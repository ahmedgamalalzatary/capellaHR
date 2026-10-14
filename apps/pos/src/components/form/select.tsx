import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '@capella/ui';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native select, styled to sit on the same baseline as `Input`. Native is kept on
 * purpose: the counter runs on touch tills where the platform picker is faster
 * and more reliable than any custom listbox.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 w-full rounded-control border border-line bg-paper px-3 text-sm text-ink',
      'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70',
      'aria-invalid:border-danger',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
