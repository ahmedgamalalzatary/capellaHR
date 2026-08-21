'use client';

import type {
  CompleteSaleInput,
  PublicInvoiceDto,
  PaymentMethod,
  QuoteSaleInput,
} from '@capella/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Minus, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Modal,
  cn,
} from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { DraftNotice } from '@/components/feedback/draft-notice';
import { PageHeader } from '@/components/layout/page-header';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { useSession } from '@/features/auth';
import {
  getCurrentCashierSession,
  listCashierSessionBranches,
} from '@/features/cashier-sessions';
import { cashierAccountQueryKeys, listBranchCashierRoster } from '@/features/cashier-accounts';
import { ClientPicker, getClient, type Client } from '@/features/clients';
import { ServicePicker, type ServiceListItem } from '@/features/catalog';
import { ProductPicker, type ProductSaleItem } from '@/features/products';
import {
  PresentEmployeePicker,
  employeeAssignmentQueryKeys,
  listAssignableEmployees,
  type AssignableEmployee,
} from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { createUuid } from '@/lib/uuid';

import { completeSale, quoteSale } from '../api/sales-api';
import { ReceiptBundle } from './receipt';
import {
  enqueueOfflineSale,
  getOfflineSaleQueueVersion,
  hasUnrecoverableOfflineSales,
  listOfflineSales,
  markOfflineSaleFailed,
  migrateLegacyPendingSales,
  offlineSaleRetryDelayMs,
  removeOfflineSale,
  subscribeOfflineSaleQueue,
  type OfflineSaleQueueItem,
} from '../offline-sale-queue';
import { synchronizeOfflineSales } from '../offline-sale-sync';
import { salesQueryKeys } from '../query-keys';
import {
  acquireSaleDraftTab,
  readSaleDraft,
  type StoredSaleDraft,
  removeSaleDraft,
  writeSaleDraft,
  type SaleDraftOwner,
} from '../sale-draft-storage';

const PENDING_KEY = 'capella:pending-sale';
const PENDING_KEY_PREFIX = `${PENDING_KEY}:`;
const OFFLINE_QUEUE_PREFIX = 'capella:offline-sale:v1:';
const paymentMethods: Array<{ method: PaymentMethod; label: string }> = [
  { method: 'cash', label: 'نقدي' },
  { method: 'visa', label: 'فيزا' },
  { method: 'instapay', label: 'إنستا باي' },
  { method: 'vodafone_cash', label: 'فودافون كاش' },
];

/**
 * Who performed one service. The default picker fills this for lines added after
 * it, and the counter overrides it here when two people share an invoice.
 */
function LineEmployeeSelect({
  line,
  branchId,
  onSelect,
}: {
  line: Line;
  branchId?: number;
  onSelect: (employee: AssignableEmployee | null) => void;
}) {
  const present = useQuery({
    queryKey: employeeAssignmentQueryKeys.present(branchId),
    queryFn: () => listAssignableEmployees(branchId === undefined ? {} : { branchId }),
  });
  const options = present.data ?? [];
  /**
   * An employee who has since checked out is dropped from the line, not merely
   * hidden in the select: leaving them assigned would submit the id of someone
   * the screen shows as unchosen. Only a successful read can retire a choice, so
   * a valid assignment survives loading and failures untouched.
   */
  const staleSelection = present.isSuccess && line.employee !== null
    && line.employee !== undefined
    && !options.some(({ id }) => id === line.employee!.id);
  useEffect(() => {
    if (staleSelection) onSelect(null);
  }, [onSelect, staleSelection]);
  const selectedPresent = line.employee && options.some(({ id }) => id === line.employee!.id);
  return (
    <select
      aria-label={`موظف ${line.service.name}`}
      className="h-11 min-w-40 rounded-control border border-line bg-paper px-2 text-sm"
      value={selectedPresent ? String(line.employee!.id) : ''}
      onChange={(event) => onSelect(
        options.find(({ id }) => String(id) === event.target.value) ?? null,
      )}
    >
      <option value="">اختر الموظف</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.fullName}</option>
      ))}
    </select>
  );
}

type Line = {
  service: ServiceListItem | ProductSaleItem;
  quantity: number;
  unitPrice: string;
  itemType?: 'service' | 'product';
  /** Who performed this service. A product line names nobody. */
  employee?: AssignableEmployee | null;
};
/**
 * A draft saved before per-line assignment — or by a counter that picked only the
 * default — carries the employee once, at the top. Restore it onto the services.
 */
const restoredLines = (draft: { employee: AssignableEmployee | null; lines: Line[] }): Line[] => (
  draft.lines.map((line) => (
    line.itemType === 'product' || line.employee
      ? line
      : { ...line, employee: draft.employee }
  ))
);

type AdjustmentKind = 'percentage' | 'fixed';
/** Admin is a database-enforced singleton and has no public account id. */
type PendingSaleOwner = SaleDraftOwner;
type PendingSale = { owner: PendingSaleOwner; input: CompleteSaleInput };

const toCents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;

const validServiceUnitPrice = (value: string) => {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return false;
  const cents = toCents(value);
  return cents !== null && cents > BigInt(0);
};

const errorMessage = (error: unknown) => (
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.'
);

const readPending = (matches: (pending: PendingSale) => boolean = () => true): PendingSale | null => {
  if (typeof window === 'undefined') return null;
  try {
    migrateLegacyPendingSales();
    return listOfflineSales()
      .map(({ owner, input }) => ({ owner, input }))
      .find(matches) ?? null;
  } catch {
    return null;
  }
};

const removePendingRequest = (input: CompleteSaleInput) => {
  removeOfflineSale(input.idempotencyKey);
};

export function SalesView() {
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
    />
  );
}

function PendingSaleRecovery({ pending }: { pending: PendingSale }) {
  const attempted = useRef(false);
  const recovery = useMutation({
    mutationFn: async (input: CompleteSaleInput) => {
      const result = await synchronizeOfflineSales({ owner: pending.owner, submit: completeSale });
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

function SaleWorkspace({
  branchId,
  workspaceBranchId,
  cashierSessionId,
  accountId,
  role,
}: {
  branchId?: number;
  workspaceBranchId: number;
  cashierSessionId: number;
  accountId: number | null;
  role: 'admin' | 'cashier';
}) {
  const queryClient = useQueryClient();
  const workspaceOwner = useMemo<PendingSaleOwner>(() => ({
    accountId,
    role,
    branchId: workspaceBranchId,
    cashierSessionId,
  }), [accountId, cashierSessionId, role, workspaceBranchId]);
  const [client, setClient] = useState<Client | null>(null);
  const [employee, setEmployee] = useState<AssignableEmployee | null>(null);
  const [seller, setSeller] = useState<BranchCashierRosterMember | null>(null);
  const roster = useQuery({
    queryKey: cashierAccountQueryKeys.roster(workspaceBranchId),
    queryFn: () => listBranchCashierRoster({ branchId: workspaceBranchId }),
  });
  const sellerOnRoster = Boolean(
    seller && roster.data?.some((member) => member.id === seller.id),
  );
  useEffect(() => {
    if (roster.isSuccess && seller && !sellerOnRoster) setSeller(null);
  }, [roster.isSuccess, seller, sellerOnRoster]);
  const [lines, setLines] = useState<Line[]>([]);
  const [discountKind, setDiscountKind] = useState<AdjustmentKind>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [taxKind, setTaxKind] = useState<AdjustmentKind>('percentage');
  const [taxValue, setTaxValue] = useState('');
  const [payments, setPayments] = useState<Record<PaymentMethod, string>>({
    cash: '', visa: '', instapay: '', vodafone_cash: '',
  });
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  /** Found in storage and waiting for the cashier to accept or drop it. */
  const [offeredDraft, setOfferedDraft] = useState<StoredSaleDraft | null>(null);
  /**
   * Identifies the client lookup a restore started. Any later choice — picking a
   * client by hand, resetting, or restoring again — invalidates it, so a slow
   * lookup can never land on top of a newer selection.
   */
  const clientLookup = useRef(0);
  const selectClient = useCallback((next: Client | null) => {
    clientLookup.current += 1;
    setClient(next);
  }, []);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [completed, setCompleted] = useState<PublicInvoiceDto | null>(null);
  /** Asked once per saved sale: the receipt is optional, the invoice is already stored. */
  const [printPrompt, setPrintPrompt] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createUuid);
  const [replacesIdempotencyKey, setReplacesIdempotencyKey] = useState<string | null>(null);
  const [conflictRestored, setConflictRestored] = useState(false);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [discarding, setDiscarding] = useState<OfflineSaleQueueItem | null>(null);
  const [discardError, setDiscardError] = useState(false);
  const didReplayOnMount = useRef(false);
  const backgroundSyncedKeys = useRef(new Set<string>());
  const retryTimers = useRef(new Map<string, number>());
  const mounted = useRef(true);
  const submitting = useRef(false);
  const hasDraftProgress = Boolean(
    client || employee || seller || lines.length > 0 || discountValue || taxValue || paymentsTouched,
  );
  const matchesActiveDraft = useCallback((pending: PendingSale) => (
    pending.owner.accountId === workspaceOwner.accountId
      && pending.owner.role === workspaceOwner.role
      && pending.owner.branchId === workspaceOwner.branchId
      && pending.owner.cashierSessionId === workspaceOwner.cashierSessionId
      && (!hasDraftProgress || pending.input.idempotencyKey === idempotencyKey)
  ), [hasDraftProgress, idempotencyKey, workspaceOwner]);
  const pendingMatchesActiveDraft = Boolean(
    pendingSale
      && pendingSale.owner.accountId === workspaceOwner.accountId
      && pendingSale.owner.role === workspaceOwner.role
      && pendingSale.owner.branchId === workspaceOwner.branchId
      && pendingSale.owner.cashierSessionId === workspaceOwner.cashierSessionId
      && (!hasDraftProgress || pendingSale.input.idempotencyKey === idempotencyKey),
  );
  const pendingInput = pendingMatchesActiveDraft ? pendingSale!.input : null;
  const queueVersion = useSyncExternalStore(
    subscribeOfflineSaleQueue,
    getOfflineSaleQueueVersion,
    getOfflineSaleQueueVersion,
  );
  const offlineQueueSnapshot = useMemo(() => ({
    version: queueVersion,
    items: listOfflineSales(),
    hasUnrecoverable: hasUnrecoverableOfflineSales(),
  }), [queueVersion]);
  const offlineQueue = offlineQueueSnapshot.items;
  const workspaceQueue = useMemo(() => offlineQueue.filter((item) => (
    item.owner.accountId === workspaceOwner.accountId
    && item.owner.role === workspaceOwner.role
    && item.owner.branchId === workspaceOwner.branchId
    && item.owner.cashierSessionId === workspaceOwner.cashierSessionId
  )), [offlineQueue, workspaceOwner]);
  const queuedItem = workspaceQueue.find((item) => item.state === 'failed') ?? workspaceQueue.find(
    (item) => item.input.idempotencyKey === pendingSale?.input.idempotencyKey,
  );
  const crossSessionConflict = !hasDraftProgress ? offlineQueue.find((item) => (
    item.state === 'conflict'
    && item.recoveryDraft !== undefined
    && item.owner.role === workspaceOwner.role
    && item.owner.accountId === workspaceOwner.accountId
    && item.owner.branchId === workspaceOwner.branchId
    && item.owner.cashierSessionId !== workspaceOwner.cashierSessionId
  )) : undefined;
  const displayedQueueItem = queuedItem ?? crossSessionConflict;

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timers = retryTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let releaseLease: () => void = () => undefined;
    void acquireSaleDraftTab(workspaceOwner).then((release) => {
      if (cancelled) {
        release();
        return;
      }
      releaseLease = release;
      // Offered, never applied on its own: the cashier decides, exactly as on the
      // other counter screens.
      setOfferedDraft(readSaleDraft(workspaceOwner));
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
      releaseLease();
    };
  }, [workspaceOwner]);

  useEffect(() => {
    if (!draftHydrated) return;
    const recordBackgroundSync = (result: Awaited<ReturnType<typeof synchronizeOfflineSales>>) => {
      if (!mounted.current) return;
      const newKeys = result.confirmed
        .map(({ idempotencyKey: key }) => key)
        .filter((key) => !backgroundSyncedKeys.current.has(key));
      if (newKeys.length === 0) return;
      newKeys.forEach((key) => backgroundSyncedKeys.current.add(key));
      setBackgroundSyncCount((current) => current + newKeys.length);
      void invalidateErpCaches(queryClient, 'sale');
    };
    const synchronizeOwner = (owner: PendingSaleOwner, includeFailed: boolean, delay = 0) => {
      const ownerKey = [
        owner.role,
        owner.accountId ?? 'admin',
        owner.branchId,
        owner.cashierSessionId,
      ].join(':');
      const run = () => {
        if (!mounted.current || !navigator.onLine) return;
        void synchronizeOfflineSales({ owner, submit: completeSale, includeFailed })
          .then(recordBackgroundSync)
          .catch(() => undefined);
      };
      if (delay === 0) run();
      else {
        const existingTimer = retryTimers.current.get(ownerKey);
        if (existingTimer !== undefined) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          if (retryTimers.current.get(ownerKey) !== timer) return;
          retryTimers.current.delete(ownerKey);
          run();
        }, delay);
        retryTimers.current.set(ownerKey, timer);
      }
    };
    const synchronizePending = (event?: StorageEvent, retryFailed = false) => {
      if (!event || event.key === PENDING_KEY || event.key?.startsWith(PENDING_KEY_PREFIX)
        || event.key?.startsWith(OFFLINE_QUEUE_PREFIX)) {
        const matching = readPending(matchesActiveDraft);
        setPendingSale(matching);
        const allItems = listOfflineSales();
        const currentItems = allItems.filter((item) => (
          item.owner.accountId === workspaceOwner.accountId
          && item.owner.role === workspaceOwner.role
          && item.owner.branchId === workspaceOwner.branchId
          && item.owner.cashierSessionId === workspaceOwner.cashierSessionId
        ));
        if (!matching && navigator.onLine && currentItems.some((item) => item.state === 'pending')) {
          synchronizeOwner(workspaceOwner, false);
        }
        if (!matching && navigator.onLine && retryFailed) {
          const failed = currentItems.find((item) => item.state === 'failed');
          if (failed) synchronizeOwner(workspaceOwner, true, offlineSaleRetryDelayMs(failed.attempts));
        }
        if (navigator.onLine) {
          const olderOwners = new Map<string, { owner: PendingSaleOwner; items: OfflineSaleQueueItem[] }>();
          for (const item of allItems) {
            if (item.owner.role !== workspaceOwner.role
              || item.owner.accountId !== workspaceOwner.accountId
              || item.owner.cashierSessionId === workspaceOwner.cashierSessionId
              || item.state === 'conflict'
              || (!retryFailed && item.state !== 'pending')) continue;
            const key = [
              item.owner.role,
              item.owner.accountId ?? 'admin',
              item.owner.branchId,
              item.owner.cashierSessionId,
            ].join(':');
            const group = olderOwners.get(key) ?? { owner: item.owner, items: [] };
            group.items.push(item);
            olderOwners.set(key, group);
          }
          for (const { owner, items } of olderOwners.values()) {
            if (items.some((item) => item.state === 'pending')) synchronizeOwner(owner, false);
            if (retryFailed) {
              const failed = items.find((item) => item.state === 'failed');
              if (failed) synchronizeOwner(owner, true, offlineSaleRetryDelayMs(failed.attempts));
            }
          }
        }
      }
    };
    synchronizePending();
    const unsubscribe = subscribeOfflineSaleQueue(() => synchronizePending());
    const onOnline = () => synchronizePending(undefined, true);
    window.addEventListener('storage', synchronizePending);
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', synchronizePending);
      window.removeEventListener('online', onOnline);
    };
  }, [draftHydrated, matchesActiveDraft, queryClient, workspaceOwner]);

  const servicePricesValid = lines.every((line) => {
    if (line.itemType === 'product') return true;
    return validServiceUnitPrice(line.unitPrice);
  });
  const hasServiceLines = lines.some((line) => line.itemType !== 'product');
  /** Every service must name the employee who performed it before the sale posts. */
  const serviceLinesAssigned = lines.every((line) => line.itemType === 'product' || line.employee);
  const adjustmentsStep = hasServiceLines ? 5 : 4;
  const paymentsStep = hasServiceLines ? 6 : 5;

  useEffect(() => {
    if (!hasServiceLines && employee !== null) setEmployee(null);
  }, [employee, hasServiceLines]);

  const quoteInput = useMemo<QuoteSaleInput>(() => ({
    ...(branchId === undefined ? {} : { branchId }),
    lines: lines.map(({ service, quantity, unitPrice, itemType }) => itemType === 'product'
      ? { itemType: 'product' as const, productId: service.id, quantity }
      : { itemType: 'service' as const, serviceId: service.id, quantity, unitPrice }),
    ...(discountValue ? { discount: { kind: discountKind, value: discountValue } } : {}),
    ...(taxValue ? { tax: { kind: taxKind, value: taxValue } } : {}),
  }), [branchId, discountKind, discountValue, lines, taxKind, taxValue]);

  const quote = useQuery({
    queryKey: salesQueryKeys.quote(quoteInput),
    queryFn: () => quoteSale(quoteInput),
    enabled: lines.length > 0 && servicePricesValid,
  });

  useEffect(() => {
    if (quote.data && !paymentsTouched) {
      setPayments((current) => ({ ...current, cash: quote.data!.totals.total }));
    }
  }, [paymentsTouched, quote.data]);

  useEffect(() => {
    if (!draftHydrated) return;
    if (!hasDraftProgress) {
      removeSaleDraft(workspaceOwner, idempotencyKey);
      setDraftStorageError(false);
      return;
    }
    const saved = writeSaleDraft(workspaceOwner, {
      client,
      employee,
      seller,
      lines,
      discountKind,
      discountValue,
      taxKind,
      taxValue,
      payments,
      paymentsTouched,
      idempotencyKey,
    });
    setDraftStorageError(!saved);
  }, [
    client,
    draftHydrated,
    discountKind,
    discountValue,
    employee,
    hasDraftProgress,
    idempotencyKey,
    lines,
    payments,
    paymentsTouched,
    seller,
    taxKind,
    taxValue,
    workspaceOwner,
  ]);

  const completion = useMutation({
    mutationFn: async (input: CompleteSaleInput) => {
      const result = await synchronizeOfflineSales({ owner: workspaceOwner, submit: completeSale });
      return {
        invoice: result.confirmed.find(
          (item) => item.idempotencyKey === input.idempotencyKey,
        )?.invoice ?? null,
        retryableFailure: result.failed.length > 0,
        queued: listOfflineSales(workspaceOwner).find(
          (item) => item.input.idempotencyKey === input.idempotencyKey,
        ) ?? null,
      };
    },
    onSuccess: ({ invoice, queued, retryableFailure }, input) => {
      submitting.current = false;
      if (!invoice) {
        setConfirming(false);
        setAmbiguous(retryableFailure || queued?.state === 'failed');
        return;
      }
      removePendingRequest(input);
      setPendingSale(null);
      setAmbiguous(false);
      setConfirming(false);
      removeSaleDraft(workspaceOwner, input.idempotencyKey);
      setDraftRestored(false);
      setConflictRestored(false);
      setReplacesIdempotencyKey(null);
      setCompleted(invoice);
      setPrintError(null);
      setPrintPrompt(true);
      void invalidateErpCaches(queryClient, 'sale');
    },
    onError: (error, input) => {
      submitting.current = false;
      setConfirming(false);
      const isAuthoritativeRejection = error instanceof ApiError
        && error.status >= 400 && error.status < 500;
      setAmbiguous(!isAuthoritativeRejection);
      markOfflineSaleFailed(input.idempotencyKey, error);
    },
  });
  const completePending = completion.mutate;
  const completionPending = completion.isPending;

  useEffect(() => {
    const retry = () => {
      if (pendingInput && !completionPending) completePending(pendingInput);
    };
    if (pendingInput && !didReplayOnMount.current && navigator.onLine) {
      didReplayOnMount.current = true;
      retry();
    }
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [completePending, completionPending, pendingInput]);

  const paidCents = Object.values(payments).reduce<bigint | null>((sum, value) => {
    if (sum === null || !value) return sum;
    const cents = toCents(value);
    return cents === null ? null : sum + cents;
  }, BigInt(0));
  const totalCents = quote.data ? toCents(quote.data.totals.total) : null;
  const remaining = paidCents === null || totalCents === null ? null : totalCents - paidCents;
  const ready = Boolean(
    client && sellerOnRoster && serviceLinesAssigned && lines.length > 0
      && servicePricesValid && quote.data && !quote.isFetching
      && remaining === BigInt(0) && !completion.isPending && !pendingSale,
  );

  const makeInput = (): CompleteSaleInput | null => {
    if (!client || !seller || !sellerOnRoster || !serviceLinesAssigned
      || !quote.data || remaining !== BigInt(0)) return null;
    const paymentRows = paymentMethods.flatMap(({ method }) => {
      const amount = payments[method];
      return amount && toCents(amount)! > BigInt(0) ? [{ method, amount }] : [];
    });
    return {
      ...(branchId === undefined ? {} : { branchId }),
      clientId: client.id,
      sellerEmployeeId: seller.id,
      cashierSessionId,
      idempotencyKey,
      lines: lines.map(({ service, quantity, unitPrice, itemType, employee: performer }) => (
        itemType === 'product'
          ? { itemType: 'product' as const, productId: service.id, quantity }
          : {
              itemType: 'service' as const,
              serviceId: service.id,
              quantity,
              unitPrice,
              employeeId: performer!.id,
            }
      )),
      ...(quoteInput.discount ? { discount: quoteInput.discount } : {}),
      ...(quoteInput.tax ? { tax: quoteInput.tax } : {}),
      payments: paymentRows,
    };
  };

  const submit = () => {
    if (pendingSale || submitting.current) return;
    const input = makeInput();
    if (!input) return;
    submitting.current = true;
    const stored = { owner: workspaceOwner, input };
    const queued = enqueueOfflineSale({
      owner: workspaceOwner,
      input,
      recoveryDraft: {
        client,
        employee: hasServiceLines ? employee : null,
        seller,
        lines,
        discountKind,
        discountValue,
        taxKind,
        taxValue,
        payments,
        paymentsTouched,
        idempotencyKey,
      },
      ...(replacesIdempotencyKey ? { replacesIdempotencyKey } : {}),
    });
    if (!queued) {
      submitting.current = false;
      setConfirming(false);
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setPendingSale(stored);
    setConfirming(false);
    if (navigator.onLine) completion.mutate(input);
    else submitting.current = false;
  };

  const restoreConflict = (item: OfflineSaleQueueItem) => {
    const draft = item.recoveryDraft;
    if (!draft) return;
    removeSaleDraft(workspaceOwner, idempotencyKey);
    selectClient(null);
    setEmployee(draft.employee);
    setSeller(draft.seller ?? null);
    setLines(restoredLines(draft));
    setDiscountKind(draft.discountKind);
    setDiscountValue(draft.discountValue);
    setTaxKind(draft.taxKind);
    setTaxValue(draft.taxValue);
    setPayments(draft.payments);
    setPaymentsTouched(draft.paymentsTouched);
    setIdempotencyKey(createUuid());
    setReplacesIdempotencyKey(item.input.idempotencyKey);
    setPendingSale(null);
    setAmbiguous(false);
    setConflictRestored(true);
    completion.reset();
  };

  /** The receipt is printed by the browser, so the counter printer needs no extra driver. */
  const printReceipt = () => {
    setPrintError(null);
    if (typeof window.print !== 'function') {
      setPrintError('الطباعة غير متاحة في هذا المتصفح. افتح الإيصال واطبعه من صفحة الفاتورة.');
      return;
    }
    try {
      window.print();
    } catch {
      setPrintError('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح والطابعة ثم حاول مرة أخرى.');
    }
  };

  const reset = () => {
    selectClient(null);
    setEmployee(null);
    setSeller(null);
    setLines([]);
    setPayments({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    setPaymentsTouched(false);
    setDiscountValue('');
    setTaxValue('');
    setCompleted(null);
    setPrintPrompt(false);
    setPrintError(null);
    setDraftRestored(false);
    setDraftStorageError(false);
    setConflictRestored(false);
    setBackgroundSyncCount(0);
    setReplacesIdempotencyKey(null);
    removeSaleDraft(workspaceOwner, idempotencyKey);
    setIdempotencyKey(createUuid());
  };

  /**
   * Puts the offered draft back on screen. The client is refetched by id because the
   * stored copy deliberately holds no personal data — only the identifiers.
   */
  const restoreOfferedDraft = () => {
    const draft = offeredDraft;
    if (!draft) return;
    setOfferedDraft(null);
    setEmployee(draft.employee);
    setSeller(draft.seller ?? null);
    setLines(restoredLines(draft));
    setDiscountKind(draft.discountKind);
    setDiscountValue(draft.discountValue);
    setTaxKind(draft.taxKind);
    setTaxValue(draft.taxValue);
    setPayments(draft.payments);
    setPaymentsTouched(draft.paymentsTouched);
    setIdempotencyKey(draft.idempotencyKey);
    setDraftRestored(true);
    selectClient(null);
    if (draft.client) {
      const lookup = clientLookup.current;
      void getClient(draft.client.id, branchId)
        .then((saved) => {
          if (mounted.current && clientLookup.current === lookup) setClient(saved);
        })
        .catch(() => undefined);
    }
  };

  const discardOfferedDraft = () => {
    const draft = offeredDraft;
    setOfferedDraft(null);
    if (draft) removeSaleDraft(workspaceOwner, draft.idempotencyKey);
  };

  if (completed) {
    return (
      <>
        <Card data-print-controls className="mx-auto max-w-lg shadow-raised">
          <CardHeader className="text-center"><CardTitle>تم حفظ الفاتورة</CardTitle></CardHeader>
          <CardContent className="space-y-5 p-6 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
              <CircleCheck className="size-6" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="font-mono text-sm font-semibold text-muted">{completed.invoiceNumber}</p>
              <p className="tabular text-3xl font-semibold text-ink">{completed.totals.total} ج.م</p>
            </div>
            {printError ? <p role="alert" className="text-[13px] text-danger">{printError}</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={printReceipt}><Printer className="size-4" aria-hidden />طباعة الإيصال</Button>
              <Link className="inline-flex h-9 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-surface" href={`/invoices/${completed.id}${branchId ? `?branchId=${branchId}` : ''}`}>
                عرض الإيصال
              </Link>
              <Button variant="secondary" onClick={reset}><RotateCcw className="size-4" aria-hidden />بيع جديد</Button>
            </div>
          </CardContent>
        </Card>

        {/* Only the receipt reaches the paper; the print stylesheet hides everything else. */}
        <div className="hidden print:block">
          <ReceiptBundle invoice={completed} />
        </div>

        {printPrompt ? (
          <Modal title="طباعة الإيصال" onClose={() => setPrintPrompt(false)}>
            <p className="text-sm">تم حفظ الفاتورة. هل تريد طباعة إيصال للعميل؟</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPrintPrompt(false)}>لا، شكراً</Button>
              <Button onClick={() => { setPrintPrompt(false); printReceipt(); }}>
                <Printer className="size-4" aria-hidden />
                نعم، اطبع
              </Button>
            </div>
          </Modal>
        ) : null}
      </>
    );
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="بيع جديد"
        description="اختر العميل والخدمات أو المنتجات والموظف ثم راجع الإجمالي المحسوب من الخادم."
      />

      {offeredDraft ? (
        <DraftNotice
          label="لديك مسودة بيع غير مكتملة لهذه الوردية."
          onRestore={restoreOfferedDraft}
          onDiscard={discardOfferedDraft}
        />
      ) : null}

      {draftRestored ? (
        <Notice tone="success">تم استعادة مسودة البيع المحفوظة لهذا الحساب والوردية.</Notice>
      ) : null}

      {conflictRestored ? (
        <Notice tone="warning">
          تم استعادة البيع للمراجعة. اختر العميل مجددًا وراجع الأسعار والحضور والمخزون قبل الإرسال.
        </Notice>
      ) : null}

      {backgroundSyncCount > 0 ? (
        <Notice tone="success">
          {backgroundSyncCount === 1
            ? 'تمت مزامنة بيع معلق بنجاح.'
            : `تمت مزامنة ${backgroundSyncCount} مبيعات معلقة بنجاح.`}
        </Notice>
      ) : null}

      {draftStorageError ? (
        <Notice tone="danger" role="alert">
          تعذر حفظ مسودة البيع في المتصفح. لا تغادر الصفحة قبل إتمام البيع.
        </Notice>
      ) : null}

      {draftHydrated && displayedQueueItem ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {displayedQueueItem.state === 'pending'
                  ? (online ? 'بانتظار المزامنة' : 'بانتظار الاتصال')
                  : displayedQueueItem.state === 'syncing'
                    ? 'جارٍ مزامنة البيع'
                    : displayedQueueItem.state === 'conflict'
                      ? 'يحتاج البيع إلى مراجعة'
                      : 'تعذرت مزامنة البيع'}
              </p>
              {displayedQueueItem.failure ? <p role="alert" className="mt-1 text-danger">{displayedQueueItem.failure.message}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {displayedQueueItem.state === 'conflict'
                && displayedQueueItem.recoveryDraft
                && (!hasDraftProgress
                  || displayedQueueItem.input.idempotencyKey === idempotencyKey) ? (
                <Button variant="secondary" size="sm" onClick={() => restoreConflict(displayedQueueItem)}>
                  مراجعة وتعديل البيع
                </Button>
              ) : null}
              {(displayedQueueItem.state === 'conflict' || displayedQueueItem.state === 'failed') ? (
                <Button variant="ghost" size="sm" onClick={() => {
                  setDiscardError(false);
                  setDiscarding(displayedQueueItem);
                }}>
                  حذف البيع المعلق
                </Button>
              ) : null}
            </div>
          </div>
        </Notice>
      ) : null}

      {ambiguous ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">تعذر تأكيد نتيجة البيع</p>
              <p className="mt-0.5 text-muted">سيُعاد استخدام نفس مفتاح العملية، ولن تُنشأ فاتورة مكررة.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!pendingInput || completion.isPending}
              onClick={() => pendingInput && completion.mutate(pendingInput)}
            >
              إعادة المحاولة بنفس الطلب
            </Button>
          </div>
        </Notice>
      ) : null}

      {pendingSale && !pendingMatchesActiveDraft ? (
        <Notice tone="warning">
          <p className="text-sm font-medium">يوجد بيع معلق محفوظ لحساب أو وردية أخرى</p>
          <p className="mt-0.5 text-muted">لن يُعاد إرساله أو حذفه من مساحة العمل الحالية. افتح الحساب والوردية الأصليين لاستعادته بأمان.</p>
        </Notice>
      ) : null}

      {offlineQueueSnapshot.hasUnrecoverable ? (
        <Notice tone="warning">
          <p className="text-sm font-medium">يوجد بيع محفوظ من إصدار أقدم يحتاج مراجعة يدوية</p>
          <p className="mt-0.5 text-muted">
            تعذر استعادة سعر الخدمة بأمان، لذلك احتفظ النظام بالطلب ولم يرسله أو يحذفه.
          </p>
        </Notice>
      ) : null}

      <fieldset
        disabled={Boolean(pendingInput)}
        className="m-0 min-w-0 border-0 p-0"
      >
        <legend className="sr-only">تفاصيل البيع</legend>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
          <div className="min-w-0 space-y-4">
            <Card className="shadow-card">
              <CardHeader><CardTitle><StepTitle step={1} label="العميل" /></CardTitle></CardHeader>
              <CardContent className="p-5">
                <ClientPicker selected={client} onSelect={selectClient} {...(branchId === undefined ? {} : { branchId })} />
              </CardContent>
            </Card>

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
                        <Button variant="secondary" onClick={() => void roster.refetch()}>
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

            <Card className="shadow-card">
              <CardHeader><CardTitle><StepTitle step={3} label="الخدمات والمنتجات" /></CardTitle></CardHeader>
              <CardContent className="space-y-5 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <ServicePicker {...(branchId === undefined ? {} : { branchId })} onSelect={(service) => setLines((current) => {
                    const found = current.find(({ service: item, itemType }) => itemType !== 'product' && item.id === service.id);
                    return found
                      ? current.map((line) => line.itemType !== 'product' && line.service.id === service.id
                        ? { ...line, quantity: line.quantity + 1 }
                        : line)
                      : [...current, {
                          service,
                          quantity: 1,
                          unitPrice: service.price ?? '',
                          itemType: 'service',
                          // The chosen default performs whatever is added next.
                          employee,
                        }];
                  })} />
                  <ProductPicker {...(branchId === undefined ? {} : { branchId })} onSelect={(product) => setLines((current) => {
                    const found = current.find(({ service: item, itemType }) => itemType === 'product' && item.id === product.id);
                    return found
                      ? current.map((line) => line.itemType === 'product' && line.service.id === product.id
                        ? { ...line, quantity: Math.min(line.quantity + 1, product.quantityAvailable) }
                        : line)
                      : [...current, {
                          service: product,
                          quantity: 1,
                          unitPrice: product.price,
                          itemType: 'product',
                          employee: null,
                        }];
                  })} />
                </div>

                {lines.length > 0 ? (
                  <ul className="space-y-2 border-t border-line/70 pt-4">
                    {lines.map((line) => (
                      <li
                        key={`${line.itemType ?? 'service'}:${line.service.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface/50 p-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{line.service.name}</span>
                          {line.itemType !== 'product' && line.service.price === null ? (
                            <Input
                              aria-label={`سعر ${line.service.name}`}
                              inputMode="decimal"
                              className="mt-1 h-9 w-36 text-start"
                              placeholder="سعر الوحدة"
                              value={line.unitPrice}
                              onChange={(event) => setLines((current) => current.map((item) => (
                                item.service.id === line.service.id && item.itemType === line.itemType
                                  ? { ...item, unitPrice: event.target.value }
                                  : item
                              )))}
                            />
                          ) : (
                            <span className="tabular text-[13px] text-muted">{line.service.price} ج.م</span>
                          )}
                        </span>
                        {line.itemType !== 'product' ? (
                          <LineEmployeeSelect
                            line={line}
                            {...(branchId === undefined ? {} : { branchId })}
                            onSelect={(performer) => setLines((current) => current.map((item) => (
                              item.service.id === line.service.id && item.itemType === line.itemType
                                ? { ...item, employee: performer }
                                : item
                            )))}
                          />
                        ) : null}
                        {/* The most-tapped control in the app: kept at a 44px touch target. */}
                        <span className="flex items-center gap-1 rounded-control border border-line bg-paper p-0.5">
                          <Button variant="ghost" className="size-11 px-0" aria-label={`تقليل ${line.service.name}`} onClick={() => setLines((current) => current.flatMap((item) => item.service.id !== line.service.id || item.itemType !== line.itemType ? [item] : item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : []))}><Minus className="size-4" aria-hidden /></Button>
                          <span className="tabular w-8 text-center text-sm font-semibold">{line.quantity}</span>
                          <Button variant="ghost" className="size-11 px-0" disabled={line.itemType === 'product' && line.quantity >= (line.service as ProductSaleItem).quantityAvailable} aria-label={`زيادة ${line.service.name}`} onClick={() => setLines((current) => current.map((item) => item.service.id === line.service.id && item.itemType === line.itemType ? { ...item, quantity: item.quantity + 1 } : item))}><Plus className="size-4" aria-hidden /></Button>
                          <Button variant="ghost" className="size-11 px-0" aria-label={`حذف ${line.service.name}`} onClick={() => setLines((current) => current.filter((item) => item.service.id !== line.service.id || item.itemType !== line.itemType))}><Trash2 className="size-4" aria-hidden /></Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>

            {hasServiceLines ? (
              <Card className="shadow-card">
              <CardHeader><CardTitle><StepTitle step={4} label="الموظف الافتراضي" /></CardTitle></CardHeader>
              <CardContent className="p-5">
                <p className="mb-3 text-[13px] text-muted">
                  يُسند تلقائيًا للخدمات التي لم يُحدد لها موظف، ويمكن تغيير موظف كل خدمة من قائمتها.
                </p>
                <PresentEmployeePicker
                  selected={employee}
                  onSelect={(next) => {
                    setEmployee(next);
                    // Fills the services nobody has been assigned to yet; a line
                    // the counter set by hand keeps its own employee.
                    if (next) {
                      setLines((current) => current.map((line) => (
                        line.itemType !== 'product' && !line.employee
                          ? { ...line, employee: next }
                          : line
                      )));
                    }
                  }}
                  {...(branchId === undefined ? {} : { branchId })}
                />
              </CardContent>
              </Card>
            ) : null}
          </div>

          {/* The summary follows the cart on a wide till, but it must scroll on its
              own so the submit button is never pinned below the fold. */}
          <div className="scroll-thin min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <Card className="shadow-card">
              <CardHeader><CardTitle><StepTitle step={adjustmentsStep} label="الخصم والضريبة" /></CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
                <AdjustmentInput label="الخصم" kind={discountKind} value={discountValue} onKind={setDiscountKind} onValue={setDiscountValue} />
                <AdjustmentInput label="الضريبة" kind={taxKind} value={taxValue} onKind={setTaxKind} onValue={setTaxValue} />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader><CardTitle><StepTitle step={paymentsStep} label="الإجمالي والمدفوعات" /></CardTitle></CardHeader>
              <CardContent className="space-y-4 p-5">
                {quote.isPending && lines.length > 0 ? (
                  <LoadingState label="جارٍ حساب الإجمالي من الخادم…" className="justify-start p-0" />
                ) : null}
                {quote.isError ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p role="alert" className="text-[13px] text-danger">{errorMessage(quote.error)}</p>
                    {quote.error instanceof ApiError && quote.error.code === 'PRICE_CHANGED' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setLines((current) => current.filter((line) => line.itemType === 'product'));
                          void invalidateErpCaches(queryClient, 'catalog');
                        }}
                      >
                        إزالة الخدمات وإعادة اختيارها
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => void quote.refetch()}>
                        إعادة حساب الإجمالي
                      </Button>
                    )}
                  </div>
                ) : null}
                {quote.data ? (
                  <dl className="space-y-1.5 rounded-control border border-line bg-surface/50 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">المجموع الفرعي</dt>
                      <dd className="tabular">{quote.data.totals.subtotal} ج.م</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">الخصم</dt>
                      <dd className="tabular">{quote.data.totals.discountAmount} ج.م</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">الضريبة</dt>
                      <dd className="tabular">{quote.data.totals.taxAmount} ج.م</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                      <dt className="font-semibold">الإجمالي</dt>
                      <dd className="tabular text-xl font-semibold">{quote.data.totals.total} ج.م</dd>
                    </div>
                  </dl>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  {paymentMethods.map(({ method, label }) => (
                    <div key={method} className="space-y-1.5">
                      <Label htmlFor={`payment-${method}`}>{label}</Label>
                      <Input
                        id={`payment-${method}`}
                        inputMode="decimal"
                        className="text-start"
                        value={payments[method]}
                        onChange={(event) => {
                          setPaymentsTouched(true);
                          setPayments((current) => ({ ...current, [method]: event.target.value }));
                        }}
                      />
                    </div>
                  ))}
                </div>
                {remaining !== null ? (
                  <p
                    role="status"
                    className={cn(
                      'rounded-control border px-3 py-2 text-[13px] font-medium',
                      remaining === BigInt(0)
                        ? 'border-success/20 bg-success-soft text-success'
                        : 'border-warning/20 bg-warning-soft text-warning',
                    )}
                  >
                    {remaining === BigInt(0)
                      ? 'تم سداد الإجمالي بالكامل'
                      : remaining > BigInt(0)
                        ? `المتبقي ${money(remaining)} ج.م`
                        : `المدفوع زائد بمقدار ${money(-remaining)} ج.م`}
                  </p>
                ) : null}
                {completion.error && !ambiguous ? <p role="alert" className="text-[13px] text-danger">{errorMessage(completion.error)}</p> : null}
                {storageError ? (
                  <p role="alert" className="text-[13px] text-danger">
                    تعذر حفظ طلب البيع بأمان. تأكد من إتاحة تخزين المتصفح ثم حاول مرة أخرى.
                  </p>
                ) : null}
                <Button size="lg" className="w-full" disabled={!ready} onClick={() => setConfirming(true)}>
                  مراجعة وإتمام البيع + طباعة
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </fieldset>

      {confirming ? (
        <Modal title="تأكيد البيع" onClose={() => setConfirming(false)}>
          <p className="text-sm">سيتم حفظ الفاتورة نهائيًا بقيمة {quote.data?.totals.total} ج.م.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>رجوع</Button>
            <Button disabled={completion.isPending} onClick={submit}>تأكيد البيع</Button>
          </div>
        </Modal>
      ) : null}

      {discarding ? (
        <Modal title="تأكيد حذف البيع المعلق" onClose={() => {
          setDiscardError(false);
          setDiscarding(null);
        }}>
          <p className="text-sm">سيُحذف الطلب المحفوظ من هذا المتصفح ولن تتم مزامنته لاحقًا.</p>
          {discardError ? (
            <p role="alert" className="text-[13px] text-danger">
              تعذر حذف البيع المعلق من المتصفح. سيبقى محفوظًا ولن نخفيه حتى ينجح الحذف.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDiscarding(null)}>رجوع</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!removeOfflineSale(discarding.input.idempotencyKey)) {
                  setDiscardError(true);
                  return;
                }
                removeSaleDraft(workspaceOwner, discarding.input.idempotencyKey);
                setDiscarding(null);
                if (discarding.input.idempotencyKey === idempotencyKey) {
                  setPendingSale(null);
                  setAmbiguous(false);
                  reset();
                }
              }}
            >
              حذف نهائي
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** Numbered step marker shared by the five sale panels. */
function StepTitle({ step, label }: { step: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-paper"
      >
        {step}
      </span>
      {label}
    </span>
  );
}

function AdjustmentInput(props: {
  label: string;
  kind: AdjustmentKind;
  value: string;
  onKind: (kind: AdjustmentKind) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      <div className="flex gap-2">
        <Select
          aria-label={`نوع ${props.label}`}
          className="w-auto shrink-0 px-2"
          value={props.kind}
          onChange={(event) => props.onKind(event.target.value as AdjustmentKind)}
        >
          <option value="percentage">نسبة %</option>
          <option value="fixed">مبلغ ثابت</option>
        </Select>
        <Input
          aria-label={`قيمة ${props.label}`}
          inputMode="decimal"
          className="text-start"
          value={props.value}
          onChange={(event) => props.onValue(event.target.value)}
        />
      </div>
    </div>
  );
}
