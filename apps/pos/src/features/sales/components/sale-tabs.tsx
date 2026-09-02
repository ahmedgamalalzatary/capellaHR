'use client';

import { Plus, X } from 'lucide-react';

import { Button, cn } from '@capella/ui';

import type { StoredSaleDraft, StoredSaleDraftRecord } from '../sale-draft-storage';
import { money, toCents } from './sale-primitives';

/** More than a handful of sales at one till is a queue, not a counter. */
export const MAX_OPEN_SALES = 6;

export type SaleTab = {
  /** The request key the sale is stored and submitted under. */
  id: string;
  /** A sale still empty: nothing is stored for it yet, so there is nothing to drop. */
  isNew: boolean;
  record: StoredSaleDraftRecord | null;
};

/**
 * What the sale holds, taken from the draft itself. The stored copy carries the
 * catalog names but never the client's, so a parked sale is recognised by its
 * items — never by personal data kept in the browser.
 */
const itemSummary = (draft: StoredSaleDraft) => {
  const [first] = draft.lines;
  if (!first) return 'بيع فارغ';
  const others = draft.lines.length - 1;
  return others > 0 ? `${first.service.name} +${others}` : first.service.name;
};

const draftTotal = (draft: StoredSaleDraft) => {
  const cents = draft.lines.reduce((sum, line) => {
    const unit = toCents(line.unitPrice || line.service.price || '0');
    return unit === null ? sum : sum + unit * BigInt(line.quantity);
  }, BigInt(0));
  return money(cents);
};

export function SaleTabs({
  tabs,
  activeId,
  onOpen,
  onNew,
  onRequestClose,
}: {
  tabs: SaleTab[];
  activeId: string | null;
  onOpen: (tab: SaleTab) => void;
  onNew: () => void;
  onRequestClose: (tab: SaleTab) => void;
}) {
  // Nothing is parked, so there is nothing to switch to and nothing to park beside:
  // the bar appears with the first sale the cashier actually starts.
  if (!tabs.some((tab) => !tab.isNew)) return null;

  const atCapacity = tabs.length >= MAX_OPEN_SALES;
  // A sale with nothing in it is already the empty slot another sale would open into.
  const activeIsEmpty = tabs.some((tab) => tab.id === activeId && tab.isNew);

  return (
    <nav aria-label="المبيعات المفتوحة" className="scroll-thin overflow-x-auto">
      <ul className="flex min-w-0 items-stretch gap-2">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const position = index + 1;
          // The ordinal sits inside the label so a tab never reads as a bare catalog
          // name, which would be indistinguishable from the basket line below it.
          const label = `${position}. ${tab.record ? itemSummary(tab.record.draft) : 'بيع جديد'}`;
          return (
            <li
              key={tab.id}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-control border px-1 transition-colors',
                active ? 'border-ink bg-surface' : 'border-line bg-paper hover:bg-surface',
              )}
            >
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onOpen(tab)}
                className="flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-ink"
              >
                <span className={cn('max-w-[12rem] truncate', active && 'font-semibold')}>
                  {label}
                </span>
                {tab.record ? (
                  <span className="tabular text-[12px] text-muted">
                    {draftTotal(tab.record.draft)} ج.م
                  </span>
                ) : null}
              </button>
              {tab.record ? (
                <button
                  type="button"
                  aria-label={`حذف البيع ${position}`}
                  onClick={() => onRequestClose(tab)}
                  className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
        <li className="shrink-0">
          <Button
            variant="secondary"
            size="sm"
            disabled={atCapacity || activeIsEmpty}
            onClick={onNew}
          >
            <Plus className="size-4" aria-hidden />
            بيع آخر
          </Button>
        </li>
      </ul>
      {atCapacity ? (
        <p className="mt-2 text-[12px] text-muted">
          {`لا يمكن فتح أكثر من ${MAX_OPEN_SALES} مبيعات في الوقت نفسه. أتمم أو احذف بيعًا لفتح غيره.`}
        </p>
      ) : null}
    </nav>
  );
}
