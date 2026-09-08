'use client';

import { AdjustmentInput } from './sale-adjustment-input';
import { type AdjustmentKind } from './sale-primitives';

export function SaleAdjustmentsStep({
  discountKind,
  discountValue,
  onDiscountKind,
  onDiscountValue,
  taxKind,
  taxValue,
  onTaxKind,
  onTaxValue,
}: {
  discountKind: AdjustmentKind;
  discountValue: string;
  onDiscountKind: (kind: AdjustmentKind) => void;
  onDiscountValue: (value: string) => void;
  taxKind: AdjustmentKind;
  taxValue: string;
  onTaxKind: (kind: AdjustmentKind) => void;
  onTaxValue: (value: string) => void;
}) {
  return (
    <details className="rounded-card border border-line bg-paper shadow-card">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">
        خصم / ضريبة
      </summary>
      <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
        <AdjustmentInput label="الخصم" kind={discountKind} value={discountValue} onKind={onDiscountKind} onValue={onDiscountValue} />
        <AdjustmentInput label="الضريبة" kind={taxKind} value={taxValue} onKind={onTaxKind} onValue={onTaxValue} />
      </div>
    </details>
  );
}
