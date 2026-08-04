'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Label,
} from '@capella/ui';

import { useSession } from '@/features/auth';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import {
  closeCashierSession,
  getCurrentCashierSession,
  listCashierSessionBranches,
  openCashierSession,
  recoveryCloseCashierSession,
} from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';
import { RecoveryCloseDialog } from './recovery-close-dialog';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const errorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export function CashierSessionView() {
  const queryClient = useQueryClient();
  const authQuery = useSession();
  const actor = authQuery.data?.actor;
  const isAdmin = actor?.type === 'admin';
  const isCashier = actor?.type === 'cashier';
  const [selectedBranchId, setSelectedBranchId] = useState<number | undefined>();
  const [confirmClose, setConfirmClose] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const branchesQuery = useQuery({
    queryKey: cashierSessionQueryKeys.branches,
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
    enabled: isAdmin,
  });

  const currentKey = cashierSessionQueryKeys.current(isAdmin ? selectedBranchId : undefined);
  const currentQuery = useQuery({
    queryKey: currentKey,
    queryFn: () => getCurrentCashierSession(isAdmin ? selectedBranchId : undefined),
    enabled: isCashier || (isAdmin && selectedBranchId !== undefined),
  });

  const openMutation = useMutation({
    mutationFn: openCashierSession,
    onSuccess: (openedSession) => queryClient.setQueryData(currentKey, openedSession),
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'ERP_CASHIER_SESSION_ALREADY_OPEN') {
        await currentQuery.refetch();
      }
    },
  });

  const closeMutation = useMutation({
    mutationFn: closeCashierSession,
    onSuccess: () => {
      setConfirmClose(false);
      queryClient.setQueryData(currentKey, null);
    },
    onError: async (error) => {
      if (error instanceof ApiError && (
        error.code === 'ERP_CASHIER_SESSION_NOT_OPEN'
        || error.code === 'ERP_CASHIER_SESSION_NOT_OWNER'
      )) {
        await currentQuery.refetch();
        setConfirmClose(false);
      }
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: number; reason: string }) => (
      recoveryCloseCashierSession(sessionId, { reason })
    ),
    onSuccess: () => {
      setRecoveryOpen(false);
      queryClient.setQueryData(currentKey, null);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'ERP_CASHIER_SESSION_ALREADY_CLOSED') {
        await currentQuery.refetch();
        setRecoveryOpen(false);
      }
    },
  });

  const session = currentQuery.data;
  const actionError = errorMessage(
    openMutation.error ?? closeMutation.error ?? recoveryMutation.error,
  );
  const ownsSession = isCashier
    && session !== null
    && session !== undefined
    && session.openedByAccountId === actor.accountId;

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">وردية الكاشير</h1>
        <p className="mt-1 text-sm text-muted">فتح الوردية ومتابعة مالكها وإغلاقها بأمان.</p>
      </div>

      {isAdmin ? (
        <Card>
          <CardContent className="space-y-2">
            <Label htmlFor="cashier-session-branch">الفرع</Label>
            <select
              id="cashier-session-branch"
              value={selectedBranchId ?? ''}
              disabled={branchesQuery.isPending || branchesQuery.isError}
              className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm text-ink disabled:opacity-70"
              onChange={(event) => {
                setSelectedBranchId(event.target.value ? Number(event.target.value) : undefined);
                openMutation.reset();
                closeMutation.reset();
                recoveryMutation.reset();
              }}
            >
              <option value="">اختر الفرع</option>
              {(branchesQuery.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            {branchesQuery.isError ? (
              <div className="flex items-center gap-2">
                <p role="alert" className="text-[13px] text-danger">
                  {errorMessage(branchesQuery.error)}
                </p>
                <Button variant="ghost" size="sm" onClick={() => void branchesQuery.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!isAdmin && !isCashier ? (
        <Card><CardContent className="text-sm text-muted">جارٍ تحميل بيانات الحساب…</CardContent></Card>
      ) : isAdmin && selectedBranchId === undefined ? (
        <EmptyState title="اختر فرعًا لعرض وردية الكاشير" />
      ) : currentQuery.isPending ? (
        <Card><CardContent className="text-sm text-muted">جارٍ تحميل الوردية…</CardContent></Card>
      ) : currentQuery.isError ? (
        <Card>
          <EmptyState
            title="تعذر تحميل الوردية"
            description={errorMessage(currentQuery.error) ?? undefined}
            action={(
              <Button variant="secondary" size="sm" onClick={() => void currentQuery.refetch()}>
                إعادة المحاولة
              </Button>
            )}
          />
        </Card>
      ) : session ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>الوردية الحالية</CardTitle>
            <Badge variant="success">مفتوحة</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">الفرع</dt>
                <dd className="mt-1 font-medium text-ink">{session.branchName}</dd>
              </div>
              <div>
                <dt className="text-muted">فتحها</dt>
                <dd className="mt-1 font-medium text-ink">{session.openedByUsername}</dd>
              </div>
              <div>
                <dt className="text-muted">وقت الفتح — القاهرة</dt>
                <dd className="mt-1 flex items-center gap-1.5 font-medium text-ink">
                  <Clock3 className="size-4" aria-hidden />
                  <time dateTime={session.openedAt}>{formatCairoDateTime(session.openedAt)}</time>
                </dd>
              </div>
            </dl>

            {isCashier && !ownsSession ? (
              <p role="status" className="rounded-control bg-warning/10 px-3 py-2 text-sm text-ink">
                الوردية مفتوحة بواسطة كاشير آخر
              </p>
            ) : null}

            {actionError ? <p role="alert" className="text-[13px] text-danger">{actionError}</p> : null}

            {ownsSession ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/sales"
                  className="inline-flex h-9 items-center justify-center rounded-control bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
                >
                  بدء بيع جديد
                </Link>
                <Button variant="danger" disabled={closeMutation.isPending} onClick={() => setConfirmClose(true)}>
                  إغلاق الوردية
                </Button>
              </div>
            ) : isAdmin ? (
              <Button variant="danger" onClick={() => setRecoveryOpen(true)}>
                إغلاق استثنائي
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="لا توجد وردية مفتوحة"
            description={isCashier ? 'افتح ورديتك قبل بدء عمليات البيع.' : 'لا توجد وردية مفتوحة لهذا الفرع.'}
            action={isCashier ? (
              <Button disabled={openMutation.isPending} onClick={() => openMutation.mutate()}>
                فتح الوردية
              </Button>
            ) : undefined}
          />
          {actionError ? <p role="alert" className="px-5 pb-4 text-center text-[13px] text-danger">{actionError}</p> : null}
        </Card>
      )}

      {confirmClose ? (
        <ConfirmDialog
          title="إغلاق وردية الكاشير"
          description={(
            <>
              <span>لن تتمكن من تنفيذ مبيعات جديدة قبل فتح وردية أخرى.</span>
              {closeMutation.error ? (
                <span role="alert" className="mt-2 block text-danger">
                  {errorMessage(closeMutation.error)}
                </span>
              ) : null}
            </>
          )}
          confirmLabel="تأكيد إغلاق الوردية"
          tone="danger"
          pending={closeMutation.isPending}
          onConfirm={() => closeMutation.mutate()}
          onCancel={() => setConfirmClose(false)}
        />
      ) : null}

      {recoveryOpen && session ? (
        <RecoveryCloseDialog
          pending={recoveryMutation.isPending}
          serverError={errorMessage(recoveryMutation.error)}
          onConfirm={(reason) => recoveryMutation.mutate({ sessionId: session.id, reason })}
          onCancel={() => setRecoveryOpen(false)}
        />
      ) : null}
    </section>
  );
}
