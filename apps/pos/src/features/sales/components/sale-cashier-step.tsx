'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Label } from '@capella/ui';

import { Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';

import type { BranchCashierRosterMember } from '@/features/cashier-accounts';

import { errorMessage, StepTitle } from './sale-primitives';

/** Step 2: which cashier on the branch roster is ringing the sale up. */
export function SaleCashierStep({
  seller,
  setSeller,
  roster,
}: {
  seller: BranchCashierRosterMember | null;
  setSeller: (next: BranchCashierRosterMember | null) => void;
  roster: {
    data: BranchCashierRosterMember[] | undefined;
    error: unknown;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    refetch: () => void;
  };
}) {
  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle><StepTitle step={2} label="الكاشير" /></CardTitle></CardHeader>
      <CardContent className="p-5">
        <div className="space-y-1.5">
          <Label htmlFor="sale-seller">الكاشير</Label>
          <Select
            id="sale-seller"
            disabled={roster.isPending || roster.isError}
            value={seller?.id ?? ''}
            onChange={(event) => {
              const id = Number(event.target.value);
              setSeller(roster.data?.find((member) => member.id === id) ?? null);
            }}
          >
            <option value="">اختر اسمك</option>
            {(roster.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>{member.fullName}</option>
            ))}
          </Select>
          {roster.isError ? (
            <Notice tone="danger" role="alert">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{errorMessage(roster.error)}</span>
                <Button variant="secondary" onClick={roster.refetch}>
                  إعادة المحاولة
                </Button>
              </div>
            </Notice>
          ) : null}
          {roster.isSuccess && (roster.data ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">
              لا يوجد موظفون في وردية هذا الفرع؛ اطلب من المسؤول إضافتهم من صفحة حسابات كاشير الفروع.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
