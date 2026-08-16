'use client';

import { Button } from '@capella/ui';

/**
 * Offers back the form the counter left half-filled. It asks rather than refills:
 * an old draft appearing on its own would be indistinguishable from a bug.
 */
export function DraftNotice({
  label = 'لديك مسودة غير محفوظة من قبل.',
  onRestore,
  onDiscard,
}: {
  label?: string;
  onRestore(): void;
  onDiscard(): void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface/70 px-3 py-2"
    >
      <p className="text-[13px] text-ink">{label}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onRestore}>استعادة</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>تجاهل</Button>
      </div>
    </div>
  );
}
