'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Clock3, UserRound } from 'lucide-react';

import { Button, Card, CardContent } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { PageHeader } from '@/components/layout/page-header';

import { getCurrentCashierSession } from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

/**
 * Reception's home: the status of the branch shift it shares with the cashier.
 * Status only: no money, no drawer, and no way to open or close the shift.
 */
export function ReceptionShiftStatus() {
  const shift = useQuery({
    queryKey: cashierSessionQueryKeys.current(),
    queryFn: () => getCurrentCashierSession(),
  });

  return (
    <section className="space-y-6">
      <PageHeader title="الوردية" description="وردية الفرع التي يفتحها الكاشير، ويعمل عليها الاستقبال." />
      <Card className="mx-auto max-w-md shadow-card">
        <CardContent className="space-y-4 p-6" aria-live="polite">
          {shift.isPending ? (
            <LoadingState label="جارٍ التحقق من الوردية…" className="p-0" />
          ) : shift.isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-danger">تعذر التحقق من الوردية.</p>
              <Button variant="secondary" size="sm" onClick={() => void shift.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : shift.data ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <span aria-hidden className="size-2 rounded-full bg-success" />
                الوردية مفتوحة
              </p>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                  <dt className="text-muted">الفرع</dt>
                  <dd className="ms-auto font-medium text-ink">{shift.data.branchName}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                  <dt className="text-muted">فتحها</dt>
                  <dd className="ms-auto font-medium text-ink" dir="ltr">{shift.data.openedByUsername}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="size-4 shrink-0 text-muted" aria-hidden />
                  <dt className="text-muted">منذ</dt>
                  <dd className="ms-auto font-medium text-ink">
                    <time dateTime={shift.data.openedAt}>{formatCairoDateTime(shift.data.openedAt)}</time>
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted" />
              لا توجد وردية مفتوحة. اطلب من الكاشير فتح الوردية.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
