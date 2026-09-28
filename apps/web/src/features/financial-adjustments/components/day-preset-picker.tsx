'use client';

import { Button } from '@capella/ui';

/**
 * The sizes the business actually awards. Half a month is fifteen days, priced by the
 * server against the employee's own day rate, so a preset carries no money of its own.
 */
export const dayPresets = [
  { days: 1, label: 'يوم واحد' },
  { days: 2, label: 'يومان' },
  { days: 5, label: '5 أيام' },
  { days: 15, label: 'نصف شهر' },
] as const;

export const dayCountLabel = (days: number) => {
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  if (days <= 10) return `${days} أيام`;
  return `${days} يوم`;
};

export function DayPresetPicker({
  selected,
  onSelect,
}: {
  selected?: string | undefined;
  onSelect: (days: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="مقدار بالأيام">
      {dayPresets.map((preset) => (
        <Button
          key={preset.days}
          type="button"
          size="sm"
          aria-pressed={selected === String(preset.days)}
          onClick={() => onSelect(preset.days)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
