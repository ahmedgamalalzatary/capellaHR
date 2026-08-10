import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@capella/ui';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const toneStyles: Record<NoticeTone, string> = {
  info: 'border-line bg-surface text-ink',
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
};

const toneIcons: Record<NoticeTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/**
 * Banner for something the counter must read before continuing. `role` stays a
 * caller decision: an error interrupts (`alert`), a background result does not
 * (`status`).
 */
export function Notice({
  tone = 'info',
  role = 'status',
  icon = true,
  children,
  className,
}: {
  tone?: NoticeTone;
  role?: 'alert' | 'status';
  icon?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2 rounded-control border px-3 py-2 text-[13px]',
        toneStyles[tone],
        className,
      )}
    >
      {icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Compact inline error text under a field or beside a control. */
export function FieldError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('text-[13px] text-danger', className)}>
      {children}
    </p>
  );
}
