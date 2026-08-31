'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Label } from '@capella/ui';

import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { useSession } from '@/features/auth';

import { listCashierSessionBranches, listCashierSessions } from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';
import { formatShiftDuration, formatShiftMoney } from './shift-money';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

/**
 * Past shifts for a till. A Cashier sees only the shifts they opened themselves;
 * the API enforces that, so this screen never has to.
 *
 * `branchId` is passed when the surrounding screen already asks the Admin which
 * branch they mean, so the two never ask twice.
 */
export function ShiftHistoryView({ branchId: fixedBranchId }: { branchId?: number } = {}) {
  const actor = useSession().data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [ownBranchId, setOwnBranchId] = useState<number | undefined>();
  const branchId = fixedBranchId ?? ownBranchId;
  const [page, setPage] = useState(1);

  const branches = useQuery({
    queryKey: cashierSessionQueryKeys.branches,
    queryFn: () => listCashierSessionBranches(1),
    enabled: isAdmin && fixedBranchId === undefined,
  });

  const shifts = useQuery({
    queryKey: cashierSessionQueryKeys.list(isAdmin ? branchId : undefined, page),
    queryFn: () => listCashierSessions({ ...(branchId ? { branchId } : {}), page }),
    enabled: Boolean(actor) && (!isAdmin || branchId !== undefined),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-ink">سجل الورديات</h2>

      {isAdmin && fixedBranchId === undefined ? (
        <Card className="shadow-card">
          <CardContent className="space-y-1.5 p-4 sm:p-5">
            <Label htmlFor="shift-history-branch">الفرع</Label>
            <Select
              id="shift-history-branch"
              className="max-w-sm"
              value={branchId ?? ''}
              disabled={branches.isPending || branches.isError}
              onChange={(event) => {
                setOwnBranchId(event.target.value ? Number(event.target.value) : undefined);
                setPage(1);
              }}
            >
              <option value="">اختر الفرع</option>
              {branches.data?.items.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </Select>
            {/* No branch list means no branch can be chosen, and the shifts query below stays
                switched off, so this failure has to be visible and recoverable here. */}
            {branches.isError ? (
              <Notice tone="danger" role="alert">
                <p>تعذر تحميل الفروع.</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => void branches.refetch()}>
                  إعادة تحميل الفروع
                </Button>
              </Notice>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {shifts.isPending && (!isAdmin || branchId !== undefined) ? (
        <LoadingState label="جارٍ تحميل الورديات…" align="start" className="p-0" />
      ) : null}
      {shifts.isError ? (
        <Notice tone="danger" role="alert">
          <p>تعذر تحميل الورديات.</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void shifts.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}
      {shifts.data?.items.length === 0 ? (
        <Card className="shadow-card">
          <EmptyState
            title="لا توجد ورديات سابقة"
            description="ستظهر كل وردية هنا بعد إغلاقها."
          />
        </Card>
      ) : null}

      <ul className="space-y-2">
        {shifts.data?.items.map((shift) => (
          <li key={shift.id}>
            <Card className="shadow-card transition-shadow hover:shadow-raised">
              <CardContent className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-semibold text-ink underline underline-offset-4"
                      href={`/cashier-sessions/${shift.id}`}
                    >
                      تفاصيل الوردية {shift.id}
                    </Link>
                    {shift.closedAt ? (
                      <Link
                        className="text-sm font-medium text-ink underline underline-offset-4"
                        href={`/cashier-sessions/${shift.id}/report`}
                      >
                        تقرير نهاية الوردية
                      </Link>
                    ) : null}
                    {shift.closedAt === null ? <Badge variant="success">مفتوحة</Badge> : null}
                    {shift.autoClosedAt ? <Badge variant="warning">أُغلقت تلقائيًا</Badge> : null}
                  </div>
                  <p className="truncate text-sm text-ink">
                    {shift.openedByUsername} · <span className="tabular">{shift.saleCount}</span> مبيعات
                    · <span className="tabular">{formatShiftDuration(shift.durationMinutes)}</span>
                  </p>
                  <time className="block text-[13px] text-muted" dateTime={shift.openedAt}>
                    {formatCairoDateTime(shift.openedAt)}
                  </time>
                </div>
                <strong className="tabular text-lg font-semibold text-ink sm:text-start">
                  {formatShiftMoney(shift.net)}
                </strong>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {shifts.data && shifts.data.meta.totalPages > 1 ? (
        <Card className="overflow-hidden shadow-card">
          <Pagination
            summary={(
              <>
                صفحة <span className="tabular">{page}</span> من{' '}
                <span className="tabular">{shifts.data.meta.totalPages}</span>
              </>
            )}
            previousDisabled={page <= 1}
            nextDisabled={page >= shifts.data.meta.totalPages}
            className="border-t-0"
            onPrevious={() => setPage((value) => value - 1)}
            onNext={() => setPage((value) => value + 1)}
          />
        </Card>
      ) : null}
    </section>
  );
}
