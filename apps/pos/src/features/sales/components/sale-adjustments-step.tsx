'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@capella/ui';

import { AdjustmentInput } from './sale-adjustment-input';
import { StepTitle, type AdjustmentKind } from './sale-primitives';

export function SaleAdjustmentsStep({
  step,
  discountKind,
  discountValue,
  onDiscountKind,
  onDiscountValue,
  taxKind,
  taxValue,
  onTaxKind,
  onTaxValue,
}: {
  step: number;
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
    <Card className="shadow-card">
      <CardHeader><CardTitle><StepTitle step={step} label="الخصم والضريبة" /></CardTitle></CardHeader>
      <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
        <AdjustmentInput label="الخصم" kind={discountKind} value={discountValue} onKind={onDiscountKind} onValue={onDiscountValue} />
        <AdjustmentInput label="الضريبة" kind={taxKind} value={taxValue} onKind={onTaxKind} onValue={onTaxValue} />
      </CardContent>
    </Card>
  );
}
