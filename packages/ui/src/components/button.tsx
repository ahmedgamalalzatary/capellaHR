import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';

import { cn } from '../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** The one main action of a screen or dialog: rose-gold. */
        primary: 'bg-brand-strong text-paper hover:bg-brand-strong/90',
        secondary: 'border border-line bg-paper text-ink hover:border-ink/25 hover:bg-surface',
        ghost: 'text-ink hover:bg-ink/5',
        danger: 'bg-danger text-paper hover:bg-danger/90',
        /** Actions sitting on the espresso board. */
        board: 'border border-board-line bg-flap text-board-ink hover:bg-board-line',
      },
      size: {
        /** 36px with a mouse, 44px on touch screens. */
        sm: 'h-(--control-h-sm) px-3 text-[13px]',
        /** 40px with a mouse, 44px on touch screens. */
        md: 'h-(--control-h) px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        /** Square, for an icon alone (give it an aria-label). */
        icon: 'size-(--control-h) p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button while an action runs. The label stays, so the name is stable. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'aria-label'> {
  /** Required: an icon has no visible name. Also shown as the hover hint. */
  label: string;
}

/** A square icon-only button whose name is always set. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = 'ghost', title, ...props }, ref) => (
    <Button ref={ref} size="icon" variant={variant} aria-label={label} title={title ?? label} {...props} />
  ),
);
IconButton.displayName = 'IconButton';
