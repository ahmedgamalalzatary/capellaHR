import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-control border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted',
      'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70',
      'aria-invalid:border-danger',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
