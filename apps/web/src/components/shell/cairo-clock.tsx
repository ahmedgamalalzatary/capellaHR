'use client';

import { useEffect, useState } from 'react';

import { formatCairoDate, formatCairoTime } from '@/lib/utils/format';

/**
 * Signature element: live Africa/Cairo date and time. The whole domain
 * (attendance days, payroll months) runs on Cairo time.
 */
export function CairoClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) {
    return <div className={className} aria-hidden />;
  }

  return (
    <div className={className}>
      <time
        dateTime={now.toISOString()}
        className="tabular flex items-baseline gap-2 whitespace-nowrap text-sm text-ink"
      >
        <span className="font-semibold">{formatCairoTime(now)}</span>
        <span className="text-muted">{formatCairoDate(now)}</span>
      </time>
    </div>
  );
}
