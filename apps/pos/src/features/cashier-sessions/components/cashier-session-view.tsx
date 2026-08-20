'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock3, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

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

import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError, Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import {
  closeCashierSession,
  getCashierSessionSummary,
  getCurrentCashierSession,
  listCashierSessionBranches,
  openCashierSession,
  recoveryCloseCashierSession,
} from '../api/cashier-sessions-api';
import { cashierSessionQueryKeys } from '../query-keys';
import { RecoveryCloseDialog } from './recovery-close-dialog';
import { ShiftHistoryView } from './shift-history-view';
import { ShiftMoney } from './shift-money';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const errorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

function SessionFact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock3;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-control border border-line bg-surface/60 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-[12px] text-muted">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

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

  // The same read the history uses, polled while the page is open so the till
  // sees its own money move. There is no second code path for "live".
  const summaryQuery = useQuery({
    queryKey: cashierSessionQueryKeys.summary(currentQuery.data?.id ?? 0),
    queryFn: () => getCashierSessionSummary(currentQuery.data!.id),
    enabled: currentQuery.data != null,
    refetchInterval: 30_000,
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
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="وردية الكاشير"
        description="فتح الوردية ومتابعة مالكها وإغلاقها بأمان."
      />

      {isAdmin ? (
        <Card className="shadow-card">
          <CardContent className="space-y-1.5 p-4 sm:p-5">
            <Label htmlFor="cashier-session-branch">الفرع</Label>
            <Select
              id="cashier-session-branch"
              className="max-w-sm"
              value={selectedBranchId ?? ''}
              disabled={branchesQuery.isPending || branchesQuery.isError}
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
            </Select>
            {branchesQuery.isError ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <FieldError>{errorMessage(branchesQuery.error)}</FieldError>
                <Button variant="ghost" size="sm" onClick={() => void branchesQuery.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!isAdmin && !isCashier ? (
        <Card className="shadow-card">
          <LoadingState label="جارٍ تحميل بيانات الحساب…" />
        </Card>
      ) : isAdmin && selectedBranchId === undefined ? (
        <Card className="shadow-card">
          <EmptyState title="اختر فرعًا لعرض وردية الكاشير" />
        </Card>
      ) : currentQuery.isPending ? (
        <Card className="shadow-card">
          <LoadingState label="جارٍ تحميل الوردية…" />
        </Card>
      ) : currentQuery.isError ? (
        <Card className="shadow-card">
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
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>الوردية الحالية</CardTitle>
            <Badge variant="success">مفتوحة</Badge>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <dl className="grid gap-2 sm:grid-cols-3">
              <SessionFact icon={Building2} label="الفرع">{session.branchName}</SessionFact>
              <SessionFact icon={UserRound} label="فتحها">{session.openedByUsername}</SessionFact>
              <SessionFact icon={Clock3} label="وقت الفتح — القاهرة">
                <time dateTime={session.openedAt}>{formatCairoDateTime(session.openedAt)}</time>
              </SessionFact>
            </dl>

            {summaryQuery.data ? <ShiftMoney summary={summaryQuery.data} /> : null}

            {isCashier && !ownsSession ? (
              <Notice tone="warning">الوردية مفتوحة بواسطة كاشير آخر</Notice>
            ) : null}

            {actionError ? <FieldError>{actionError}</FieldError> : null}

            {ownsSession ? (
              <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
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
              <div className="border-t border-line/70 pt-4">
                <Button variant="danger" onClick={() => setRecoveryOpen(true)}>
                  إغلاق استثنائي
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-card">
          <EmptyState
            title="لا توجد وردية مفتوحة"
            description={isCashier ? 'افتح ورديتك قبل بدء عمليات البيع.' : 'لا توجد وردية مفتوحة لهذا الفرع.'}
            action={isCashier ? (
              <Button disabled={openMutation.isPending} onClick={() => openMutation.mutate()}>
                فتح الوردية
              </Button>
            ) : undefined}
          />
          {actionError ? (
            <FieldError className="px-5 pb-4 text-center">{actionError}</FieldError>
          ) : null}
        </Card>
      )}

      {isAdmin && selectedBranchId === undefined ? null : (
        <ShiftHistoryView
          {...(isAdmin && selectedBranchId !== undefined ? { branchId: selectedBranchId } : {})}
        />
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
