'use client';

import type { CompleteSaleInput } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { ApiError } from '@/lib/api/client';

import { completeSale } from '../api/sales-api';
import { listOfflineSales } from '../offline-sale-queue';
import { synchronizeOfflineSales } from '../offline-sale-sync';
import { errorMessage, type PendingSale } from './sale-primitives';

export function PendingSaleRecovery({ pending }: { pending: PendingSale }) {
  const attempted = useRef(false);
  const recovery = useMutation({
    mutationFn: async (input: CompleteSaleInput) => {
      const result = await synchronizeOfflineSales({
        owner: pending.owner,
        submit: completeSale,
        includeFailed: true,
      });
      const invoice = result.confirmed.find(
        (item) => item.idempotencyKey === input.idempotencyKey,
      )?.invoice;
      if (invoice) return invoice;
      const queued = listOfflineSales(pending.owner).find(
        (item) => item.input.idempotencyKey === input.idempotencyKey,
      );
      throw new ApiError(queued?.state === 'conflict' ? 409 : 0, {
        code: queued?.failure?.code ?? 'NETWORK_ERROR',
        message: queued?.failure?.message ?? 'تعذر تأكيد نتيجة البيع المعلق',
      });
    },
  });
  const recoverPending = recovery.mutate;
  const recoveryPending = recovery.isPending;

  useEffect(() => {
    const retry = () => {
      if (navigator.onLine && !recoveryPending) recoverPending(pending.input);
    };
    if (!attempted.current && navigator.onLine) {
      attempted.current = true;
      retry();
    }
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [pending.input, recoverPending, recoveryPending]);

  if (recovery.data) {
    return (
      <Card className="mx-auto max-w-lg shadow-card">
        <CardHeader><CardTitle>تم حفظ الفاتورة</CardTitle></CardHeader>
        <CardContent className="space-y-2 p-5 text-center">
          <p className="font-mono text-lg font-semibold">{recovery.data.invoiceNumber}</p>
          <p className="tabular text-2xl font-semibold text-ink">{recovery.data.totals.total} ج.م</p>
        </CardContent>
      </Card>
    );
  }

  if (recovery.isError) {
    const authoritative = recovery.error instanceof ApiError
      && recovery.error.status >= 400 && recovery.error.status < 500;
    return (
      <EmptyState
        title={authoritative ? 'تعذر استعادة البيع المعلق' : 'تعذر تأكيد نتيجة البيع المعلق'}
        description={errorMessage(recovery.error)}
        action={!authoritative ? (
          <Button variant="secondary" onClick={() => recovery.mutate(pending.input)}>
            إعادة المحاولة بنفس الطلب
          </Button>
        ) : undefined}
      />
    );
  }

  return (
    <Card className="mx-auto max-w-lg shadow-card">
      <LoadingState label="جارٍ استعادة نتيجة البيع المعلق…" className="py-10" />
    </Card>
  );
}
