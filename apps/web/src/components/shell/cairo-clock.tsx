'use client';

import { useDisplayFormatters } from '@/providers/runtime-config';
import { useTickingNow } from '@/lib/use-ticking-now';

/** Live date and time rendered with the backend-provided locale and time zone. */
export function CairoClock({ className }: { className?: string }) {
  const nowMs = useTickingNow();
  const now = nowMs > 0 ? new Date(nowMs) : null;
  const formatters = useDisplayFormatters();

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
