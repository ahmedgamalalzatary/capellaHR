import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label; the whole row is the touch target. Omit it only when a table column labels the box. */
  label?: ReactNode;
}

/** Native checkbox in the brand colour, with a label row at least as tall as a control. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({ label, className, ...props }, ref) => {
  const box = (
    <input
      ref={ref}
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer accent-brand-strong disabled:cursor-not-allowed', !label && className)}
      {...props}
    />
  );
  if (!label) return box;
  return (
    <label
      className={cn(
        'inline-flex min-h-(--control-h-sm) cursor-pointer items-center gap-2 text-sm text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      {box}
      <span>{label}</span>
    </label>
  );
});
Checkbox.displayName = 'Checkbox';
