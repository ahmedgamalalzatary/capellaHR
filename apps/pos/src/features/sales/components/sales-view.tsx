'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Label,
} from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';

import { useSession } from '@/features/auth';
import {
  getCurrentCashierSession,
  listCashierSessionBranches,
} from '@/features/cashier-sessions';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { readPending } from './pending-sale-storage';
import { PendingSaleRecovery } from './pending-sale-recovery';
import { errorMessage } from './sale-primitives';
import { SaleWorkspace } from './sale-workspace';

export function SalesView({ bookingId }: { bookingId?: number }) {
  const auth = useSession();
  const actor = auth.data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [selectedBranchId, setSelectedBranchId] = useState<number>();

  const branches = useQuery({
    queryKey: ['erp-sales', 'branches'],
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
    enabled: isAdmin,
  });
  const branchId = isAdmin ? selectedBranchId : undefined;
  const session = useQuery({
    queryKey: ['erp-sales', 'cashier-session', branchId ?? null],
    queryFn: () => getCurrentCashierSession(branchId),
    enabled: actor?.type === 'cashier' || (isAdmin && branchId !== undefined),
  });

  /**
   * The branch stays on screen for the whole visit, like every other admin page:
   * a wrong pick is corrected in place instead of forcing a reload, and a branch
   * with no open shift no longer strands the admin on a dead-end screen.
   */
  const branchPicker = !isAdmin ? null : branches.isError ? (
    <Card className="shadow-card"><CardContent className="p-4 sm:p-5">
      <EmptyState
        title="تعذر تحميل الفروع"
        description={errorMessage(branches.error)}
        action={
          <Button variant="secondary" size="sm" onClick={() => void branches.refetch()}>
            إعادة المحاولة
          </Button>
        }
      />
    </CardContent></Card>
  ) : branches.isSuccess && branches.data.length === 0 ? (
    <Card className="shadow-card"><CardContent className="p-4 sm:p-5">
      <EmptyState title="لا توجد فروع متاحة" />
    </CardContent></Card>
  ) : (
    <Card className="shadow-card"><CardContent className="space-y-1.5 p-4 sm:p-5">
      <Label htmlFor="sale-branch">الفرع</Label>
      <Select
        id="sale-branch"
        className="max-w-sm"
        disabled={branches.isPending}
        value={selectedBranchId ?? ''}
        onChange={(event) => setSelectedBranchId(Number(event.target.value) || undefined)}
      >
        <option value="">اختر الفرع</option>
        {(branches.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>
    </CardContent></Card>
  );

  /** Every state below the picker shares one frame, so the branch never moves. */
  const shell = (content: ReactNode, description = 'اختر الفرع الذي ستُسجَّل عليه العملية.') => (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader title="بيع جديد" description={description} />
      {branchPicker}
      {content}
    </section>
  );

  if (isAdmin && branchId === undefined) return shell(null);

  if (auth.isPending) {
    return shell(<Card className="shadow-card"><LoadingState label="جارٍ تحميل وردية الكاشير…" className="py-10" /></Card>);
  }
  if (!actor || actor.type === 'employee') {
    return shell(<Card className="shadow-card"><EmptyState title="هذا الحساب غير مخول لاستخدام نقطة البيع" /></Card>);
  }
  if (session.isPending) {
    return shell(<Card className="shadow-card"><LoadingState label="جارٍ تحميل وردية الكاشير…" className="py-10" /></Card>);
  }
  if (session.isError) {
    return shell(
      <EmptyState
        title="تعذر تحميل وردية الكاشير"
        description={errorMessage(session.error)}
        action={
          <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
            إعادة المحاولة
          </Button>
        }
      />,
    );
  }
  if (!session.data || (actor?.type === 'cashier' && session.data.openedByAccountId !== actor.accountId)) {
    const actorAccountId = actor.type === 'cashier' ? actor.accountId : null;
    const pending = readPending((item) => item.owner.role === actor.type
      && item.owner.accountId === actorAccountId
      && (actor.type === 'cashier' || item.owner.branchId === branchId));
    const canRecover = pending
      && pending.owner.role === actor.type
      && pending.owner.accountId === actorAccountId
      && (actor.type === 'cashier' || pending.owner.branchId === branchId);
    if (canRecover) return shell(<PendingSaleRecovery pending={pending} />);
    return shell(
      <EmptyState
        title="لا توجد وردية بيع متاحة لهذا الحساب"
        description={isAdmin
          ? 'اختر فرعًا آخر، أو افتح وردية هذا الفرع من الصفحة الرئيسية.'
          : 'افتح ورديتك من الصفحة الرئيسية قبل إتمام أي عملية بيع.'}
      />,
    );
  }

  if (isAdmin) {
    return (
      <section className="space-y-5">
        {branchPicker}
        <SaleWorkspace
          key={`admin:${session.data.branchId}:${session.data.id}`}
          {...(branchId === undefined ? {} : { branchId })}
          workspaceBranchId={session.data.branchId}
          cashierSessionId={session.data.id}
          accountId={null}
          role="admin"
          {...(bookingId === undefined ? {} : { bookingId })}
        />
      </section>
    );
  }

  return (
    <SaleWorkspace
      key={`${actor.type}:${actor.type === 'cashier' ? actor.accountId : 'admin'}:${session.data.branchId}:${session.data.id}`}
      {...(branchId === undefined ? {} : { branchId })}
      workspaceBranchId={session.data.branchId}
      cashierSessionId={session.data.id}
      accountId={actor.type === 'cashier' ? actor.accountId : null}
      role={actor.type}
      {...(bookingId === undefined ? {} : { bookingId })}
    />
  );
}
