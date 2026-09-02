/**
 * The small shared pieces of the sale flow: error text, payment methods, the
 * numbered step marker, the basket line shape, and exact cents arithmetic.
 * One module because each part is a handful of lines and they always travel together.
 */
import type { CompleteSaleInput, PaymentMethod } from '@capella/contracts';

import type { ServiceListItem } from '@/features/catalog';
import type { AssignableEmployee } from '@/features/employee-assignment';
import type { ProductSaleItem } from '@/features/products';
import { ApiError } from '@/lib/api/client';

import type { SaleDraftOwner, StoredSaleDraft } from '../sale-draft-storage';

export const errorMessage = (error: unknown) => (
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.'
);

export const paymentMethods: Array<{ method: PaymentMethod; label: string }> = [
  { method: 'cash', label: 'نقدي' },
  { method: 'visa', label: 'فيزا' },
  { method: 'instapay', label: 'إنستا باي' },
  { method: 'vodafone_cash', label: 'فودافون كاش' },
];

/** Numbered step marker shared by the five sale panels. */
export function StepTitle({ step, label }: { step: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-paper"
      >
        {step}
      </span>
      {label}
    </span>
  );
}

export type Line = {
  service: ServiceListItem | ProductSaleItem;
  quantity: number;
  unitPrice: string;
  itemType?: 'service' | 'product';
  /** Who performed this service. A product line names nobody. */
  employee?: AssignableEmployee | null;
};

/**
 * A draft saved before per-line assignment — or by a counter that picked only the
 * default — carries the employee once, at the top. Restore it onto the services.
 */
export const restoredLines = (draft: { employee: AssignableEmployee | null; lines: Line[] }): Line[] => (
  draft.lines.map((line) => (
    line.itemType === 'product' || line.employee
      ? line
      : { ...line, employee: draft.employee }
  ))
);

export type AdjustmentKind = 'percentage' | 'fixed';
/** Admin is a database-enforced singleton and has no public account id. */
export type PendingSaleOwner = SaleDraftOwner;
export type PendingSale = { owner: PendingSaleOwner; input: CompleteSaleInput };

/**
 * How the sale on screen was opened.
 *
 * `initial` is the counter landing on the page: a saved draft is offered, never
 * applied behind the cashier's back. `new` and `resume` are deliberate choices from
 * the parked-sales bar, so they take effect immediately.
 */
export type SaleOpenIntent =
  | { mode: 'initial' }
  | { mode: 'new' }
  | { mode: 'resume'; draft: StoredSaleDraft };

/**
 * Cents arithmetic on the decimal strings the API speaks. Kept exact: money never
 * passes through a float.
 */
export const toCents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

export const money = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;

export const validServiceUnitPrice = (value: string) => {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return false;
  const cents = toCents(value);
  return cents !== null && cents > BigInt(0);
};
