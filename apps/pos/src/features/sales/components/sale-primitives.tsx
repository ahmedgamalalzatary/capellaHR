/**
 * The small shared pieces of the sale flow: error text, payment methods,
 * checkout blockers, the basket line shape, and exact cents arithmetic.
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

export type SaleCheckoutState = {
  hasClient: boolean;
  sellerOnRoster: boolean;
  hasLines: boolean;
  serviceLinesAssigned: boolean;
  servicePricesValid: boolean;
  quoteReady: boolean;
  remaining: bigint | null;
  hasServiceLines: boolean;
};

/** Why Complete is disabled. Empty means the till can post. */
export function saleCheckoutBlockers(state: SaleCheckoutState): string[] {
  const blockers: string[] = [];
  if (!state.hasClient) blockers.push('اختر العميل');
  if (!state.sellerOnRoster) blockers.push('اختر الكاشير');
  if (!state.hasLines) blockers.push('أضف خدمة أو منتجًا');
  if (state.hasLines && !state.servicePricesValid) {
    blockers.push('أدخل سعرًا صالحًا لكل خدمة مفتوحة السعر');
  }
  if (state.hasLines && !state.serviceLinesAssigned) blockers.push('عيّن موظفًا لكل خدمة');
  if (state.hasLines && state.servicePricesValid && !state.quoteReady) {
    blockers.push('انتظر حساب الإجمالي');
  }
  if (state.remaining !== null && state.remaining < BigInt(0)) {
    blockers.push('المدفوع أكبر من الإجمالي');
  }
  if (state.hasServiceLines && state.remaining !== null && state.remaining > BigInt(0)) {
    blockers.push('سدد إجمالي الخدمات بالكامل');
  }
  return blockers;
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
