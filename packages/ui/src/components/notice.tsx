import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const toneStyles: Record<NoticeTone, string> = {
  info: 'border-info/20 bg-info-soft text-info',
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

export interface NoticeProps {
  tone?: NoticeTone;
  /** An error interrupts (`alert`); a background result does not (`status`). */
  role?: 'alert' | 'status';
  icon?: boolean;
  /** Optional action at the end (e.g. "فتح الوردية"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Page-level banner, only for a condition that blocks the page (no open shift, branch list failed,
 * a locked month). Success uses a toast; form errors stay inline in the form.
 */
export function Notice({ tone = 'info', role = 'status', icon = true, action, children, className }: NoticeProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={role}
      className={cn('flex flex-wrap items-start gap-2 rounded-control border px-3 py-2.5 text-[13px]', toneStyles[tone], className)}
    >
      {icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
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

/** A query that failed to load: says what is missing and offers to try again. */
export function LoadError({ message, onRetry, className }: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Notice tone="danger" role="alert" {...(className === undefined ? {} : { className })}>
      <p>{message}</p>
      <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>إعادة المحاولة</Button>
    </Notice>
  );
}
