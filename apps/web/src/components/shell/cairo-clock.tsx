'use client';

import { useEffect, useState } from 'react';

import { useDisplayFormatters } from '@/providers/runtime-config';

/** Live date and time rendered with the backend-provided locale and time zone. */
export function CairoClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const formatters = useDisplayFormatters();

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now || !formatters) {
    return <div className={className} aria-hidden />;
  }

  return (
    <div className={className}>
      <time
        dateTime={now.toISOString()}
        className="tabular flex items-baseline gap-2 whitespace-nowrap text-sm text-ink"
      >
        <span className="font-semibold">{formatters.formatTime(now)}</span>
        <span className="text-muted">{formatters.formatDate(now)}</span>
      </time>
    </div>
  );
}
