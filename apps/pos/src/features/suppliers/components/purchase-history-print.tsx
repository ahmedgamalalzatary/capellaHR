'use client';

import { useMutation } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@capella/ui';
import { FieldError } from '@/components/feedback/notice';
import { PrintSheet, type PrintableReport } from '@/features/erp-reports';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { notifyError } from '@/lib/notify';
import { listPurchases } from '../api/suppliers-api';

export function PurchaseHistoryPrint({ filters, subtitle, disabled }: {
  filters: NonNullable<Parameters<typeof listPurchases>[0]>;
  subtitle: string;
  disabled: boolean;
}) {
  const [sheet, setSheet] = useState<PrintableReport>();
  const finish = useCallback(() => setSheet(undefined), []);
  const print = useMutation({
    mutationFn: async () => ({ subtitle, purchases: await fetchAllPages((page) => listPurchases({ ...filters, page, pageSize: 100 })) }),
    onSuccess: ({ purchases, subtitle: heading }) => {
      const total = (status: 'posted' | 'cancelled') => {
        const cents = purchases.filter((row) => row.status === status).reduce((sum, row) => sum + BigInt(row.total.replace('.', '')), BigInt(0));
        return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`;
      };
      setSheet({
        title: 'سجل المشتريات', subtitle: heading,
        columns: [
          { key: 'id', label: 'رقم المشتريات' }, { key: 'date', label: 'التاريخ' },
          { key: 'supplier', label: 'المورد' }, { key: 'lines', label: 'البنود' },
          { key: 'total', label: 'الإجمالي' }, { key: 'status', label: 'الحالة' },
        ],
        rows: purchases.map((row) => ({
          id: row.id, date: row.purchaseDate, supplier: row.supplierName,
          lines: row.lines.map((line) => `${line.productNameSnapshot} · صلاحية ${line.expiryDate ?? 'غير محددة'}: ${line.quantity} × ${line.unitCost} = ${line.lineTotal}`).join(' | '),
          total: row.total, status: row.status === 'posted' ? 'مُرحّلة' : `ملغاة — ${row.cancellationReason ?? ''}`,
        })),
        summary: [{ label: 'إجمالي المشتريات المُرحّلة', value: total('posted') }, { label: 'إجمالي المشتريات الملغاة', value: total('cancelled') }],
      });
    },
    onError: (error: unknown) => notifyError(error, 'تعذر تجهيز طباعة المشتريات.'),
  });
  return <div>
    <Button size="sm" variant="secondary" disabled={disabled || print.isPending || sheet !== undefined} onClick={() => print.mutate()}><Printer className="size-4" />{print.isPending ? 'جارٍ تجهيز الطباعة…' : 'طباعة سجل المشتريات'}</Button>
    {print.isError ? <FieldError>تعذر تجهيز طباعة المشتريات. أعد المحاولة.</FieldError> : null}
    {sheet ? <PrintSheet report={sheet} onPrinted={finish} /> : null}
  </div>;
}
