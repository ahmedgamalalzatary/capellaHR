import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label, also the accessible name. */
  label: string;
}

/** An on/off setting that applies at once (use a Checkbox inside forms that save later). */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex min-h-(--control-h-sm) items-center gap-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150',
          checked ? 'bg-brand-strong' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute size-4 rounded-full bg-paper shadow-card transition-[inset-inline-start] duration-150',
            checked ? 'start-[1.125rem]' : 'start-0.5',
          )}
        />
      </span>
      <span>{label}</span>
    </button>
  ),
);
Switch.displayName = 'Switch';
