import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-paper shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-line px-4 py-3 sm:px-5 sm:py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold text-ink', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3 sm:px-5 sm:py-4', className)} {...props} />;
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: string;
  description?: string | undefined;
  /** Section-level actions, shown at the end of the heading row. */
  actions?: ReactNode;
  headingId?: string;
}

/** A titled block inside a page; always an `h2` under the page `h1`. */
export function Section({ title, description, actions, headingId, className, children, ...props }: SectionProps) {
  return (
    <section aria-labelledby={headingId} className={cn('space-y-3', className)} {...props}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
