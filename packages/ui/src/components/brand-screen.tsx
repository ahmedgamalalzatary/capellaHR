import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface BrandScreenProps {
  /** e.g. "نقطة البيع", "الحضور". */
  product: string;
  logoSrc: string;
  /** Screen heading, e.g. "تسجيل الدخول". */
  title: string;
  description?: string;
  children: ReactNode;
  /** Small print under the card (version, help line). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Full-screen branded layout for login, kiosk, personal-device and pairing screens.
 * Wide screens: the espresso brand panel beside an ivory work side. Phones: a short espresso band
 * with the mark, and the card right under it (thumb-reachable, no scrolling to the button).
 */
export function BrandScreen({ product, logoSrc, title, description, children, footer, className }: BrandScreenProps) {
  return (
    <div className={cn('grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', className)}>
      <div className="flex items-center gap-3 bg-board px-5 py-5 text-board-ink lg:flex-col lg:justify-center lg:gap-6 lg:px-10">
        {/* Decorative: the name is spelled out beside it. */}
        <img src={logoSrc} alt="" width={160} height={160} className="size-12 rounded-full lg:size-40" />
        <div className="lg:text-center">
          <p className="type-display text-2xl leading-tight font-bold text-champagne lg:text-5xl">كابيلا</p>
          <p className="text-[13px] text-board-muted lg:mt-2 lg:text-base">{product}</p>
        </div>
      </div>
      <main className="flex items-start justify-center px-4 py-6 sm:items-center sm:py-10">
        <div className="w-full max-w-md">
          <div className="rounded-card border border-line bg-paper p-5 shadow-raised sm:p-7">
            <h1 className="text-2xl font-bold text-ink">{title}</h1>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
            <div className="mt-5 space-y-4">{children}</div>
          </div>
          {footer ? <div className="mt-4 text-center text-[12px] text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
