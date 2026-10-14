import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@capella/ui';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line control matching `Input`'s border, radius and disabled treatment. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted',
        'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
