import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-surface text-ink',
        brand: 'border-brand/25 bg-brand-soft text-brand-strong',
        info: 'border-info/20 bg-info-soft text-info',
        success: 'border-success/20 bg-success-soft text-success',
        warning: 'border-warning/20 bg-warning-soft text-warning',
        danger: 'border-danger/20 bg-danger-soft text-danger',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** status dot preceding the label */
  dot?: boolean;
}

export function Badge({ className, variant, dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** One entry per domain status: its Arabic label and the tone it carries. */
export type StatusMap<Status extends string> = Record<Status, { label: string; tone: BadgeTone }>;

export interface StatusBadgeProps<Status extends string> extends Omit<BadgeProps, 'variant' | 'children'> {
  status: Status;
  map: StatusMap<Status>;
}

/**
 * The only way a domain status is drawn. Each domain (invoice, booking, payroll…) declares one
 * `StatusMap`, so the same status reads the same on every page; no hand-made coloured spans.
 */
export function StatusBadge<Status extends string>({ status, map, ...props }: StatusBadgeProps<Status>) {
  const entry = map[status];
  return (
    <Badge variant={entry.tone} {...props}>
      {entry.label}
    </Badge>
  );
}
