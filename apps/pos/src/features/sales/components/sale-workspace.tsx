'use client';

import type {
  CompleteSaleInput,
  PublicInvoiceDto,
  PaymentMethod,
} from '@capella/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { cashierAccountQueryKeys, listBranchCashierRoster } from '@/features/cashier-accounts';
import { getClient, type Client } from '@/features/clients';
import { type AssignableEmployee } from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';
import { ApiError } from '@/lib/api/client';
import { createUuid } from '@/lib/uuid';

import { completeSale } from '../api/sales-api';
import {
  enqueueOfflineSale,
  getOfflineSaleQueueVersion,
  hasUnrecoverableOfflineSales,
  listOfflineSales,
  markOfflineSaleFailed,
  removeOfflineSale,
  subscribeOfflineSaleQueue,
  type OfflineSaleQueueItem,
} from '../offline-sale-queue';
import { synchronizeOfflineSales } from '../offline-sale-sync';
import {
  acquireSaleDraftTab,
  readSaleDraft,
  type StoredSaleDraft,
  removeSaleDraft,
  writeSaleDraft,
} from '../sale-draft-storage';
import { DiscardPendingSaleModal } from './discard-pending-sale-modal';
import { removePendingRequest } from './pending-sale-storage';
import { SaleAdjustmentsStep } from './sale-adjustments-step';
import { SaleBasketStep } from './sale-basket-step';
import { SaleCashierStep } from './sale-cashier-step';
import { SaleClientStep } from './sale-client-step';
import { SaleCompletedCard } from './sale-completed-card';
import { SaleDefaultEmployeeStep } from './sale-default-employee-step';
import { SaleDraftNotices } from './sale-draft-notices';
import { SalePaymentStep } from './sale-payment-step';
import {
  errorMessage,
  paymentMethods,
  restoredLines,
  toCents,
  validServiceUnitPrice,
  type AdjustmentKind,
  type Line,
  type PendingSale,
  type PendingSaleOwner,
  type SaleOpenIntent,
} from './sale-primitives';
import { SaleQueueNotices } from './sale-queue-notices';
import { useBookingPrefill } from './use-booking-prefill';
import { useOfflineSaleSync } from './use-offline-sale-sync';
import { useSaleQuote } from './use-sale-quote';

export function SaleWorkspace({
  branchId,
  workspaceBranchId,
  cashierSessionId,
  accountId,
  role,
  bookingId,
  intent = { mode: 'initial' },
  tabs,
  onSaleIdChange,
}: {
  branchId?: number;
  workspaceBranchId: number;
  cashierSessionId: number;
  accountId: number | null;
  role: 'admin' | 'cashier';
  bookingId?: number;
  /** How this sale was opened; frozen for the life of the mounted sale. */
  intent?: SaleOpenIntent;
  /** The parked-sales bar, rendered above the sale and above the saved receipt. */
  tabs?: ReactNode;
  /** Reports the request key this sale writes under, which a restore or reset changes. */
  onSaleIdChange?: (idempotencyKey: string) => void;
}) {
  const queryClient = useQueryClient();
  /**
   * The sale is remounted whenever the cashier switches parked sales, so the intent
   * it opened with is captured once and never reacts to a later render.
   */
  const [mountIntent] = useState(() => intent);
  const workspaceOwner = useMemo<PendingSaleOwner>(() => ({
    accountId,
    role,
    branchId: workspaceBranchId,
    cashierSessionId,
  }), [accountId, cashierSessionId, role, workspaceBranchId]);
  const [client, setClient] = useState<Client | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<number>();
  const [bookingPrefillError, setBookingPrefillError] = useState<string>();
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
  const [hasServices, setHasServices] = useState(true);
  const [hasProducts, setHasProducts] = useState(true);
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
  /**
   * True while a restore is fetching the client back by id. The draft counts as
   * progress meanwhile, so a sale whose only content is its client is not erased
   * by the autosave in the moment between restoring it and the lookup landing.
   */
  const [restoringClient, setRestoringClient] = useState(false);
  const selectClient = useCallback((next: Client | null) => {
    clientLookup.current += 1;
    setRestoringClient(false);
    setClient(next);
  }, []);
  /**
   * Puts a stored draft back on screen. The client is refetched by id because the
   * stored copy deliberately holds no personal data — only the identifiers.
   */
  const applyDraft = useCallback((draft: StoredSaleDraft) => {
    setEmployee(draft.employee);
    setActiveBookingId(draft.bookingId);
    setSeller(draft.seller ?? null);
    setLines(restoredLines(draft));
    setDiscountKind(draft.discountKind);
    setDiscountValue(draft.discountValue);
    setTaxKind(draft.taxKind);
    setTaxValue(draft.taxValue);
    setPayments(draft.payments);
    setPaymentsTouched(draft.paymentsTouched);
    setIdempotencyKey(draft.idempotencyKey);
    selectClient(null);
    if (!draft.client) return;
    const lookup = clientLookup.current;
    setRestoringClient(true);
    void getClient(draft.client.id, branchId)
      .then((saved) => {
        if (mounted.current && clientLookup.current === lookup) setClient(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current && clientLookup.current === lookup) setRestoringClient(false);
      });
  }, [branchId, selectClient]);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [completed, setCompleted] = useState<PublicInvoiceDto | null>(null);
  /** Printed once per saved sale, so a retry render never sends a second copy to the printer. */
  const autoPrinted = useRef<number | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => (mountIntent.mode === 'resume' ? mountIntent.draft.idempotencyKey : createUuid()),
  );
  const [replacesIdempotencyKey, setReplacesIdempotencyKey] = useState<string | null>(null);
  const [conflictRestored, setConflictRestored] = useState(false);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [discarding, setDiscarding] = useState<OfflineSaleQueueItem | null>(null);
  const [discardError, setDiscardError] = useState(false);
  const didReplayOnMount = useRef(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const hasDraftProgress = Boolean(
    client || employee || seller || lines.length > 0 || discountValue || taxValue
      || paymentsTouched || restoringClient,
  );
  const { booking, bookingEmployees } = useBookingPrefill({
    ...(bookingId === undefined ? {} : { bookingId }),
    ...(branchId === undefined ? {} : { branchId }),
    draftHydrated,
    activeBookingId,
    // A resumed sale already holds the cashier's own work; a booking never overwrites it.
    offeredDraft: offeredDraft ?? (mountIntent.mode === 'resume' ? mountIntent.draft : null),
    hasDraftProgress,
    setBookingPrefillError,
    setClient,
    setLines,
    setActiveBookingId,
  });
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
    return () => {
      mounted.current = false;
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
      // A sale the cashier picked from the parked bar is put back at once; one merely
      // found in storage on arrival is offered, never applied on its own.
      if (mountIntent.mode === 'resume') applyDraft(mountIntent.draft);
      else if (mountIntent.mode === 'initial') setOfferedDraft(readSaleDraft(workspaceOwner));
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
      releaseLease();
    };
  }, [applyDraft, mountIntent, workspaceOwner]);

  useOfflineSaleSync({
    draftHydrated,
    workspaceOwner,
    matchesActiveDraft,
    setPendingSale,
    setBackgroundSyncCount,
  });

  useEffect(() => {
    onSaleIdChange?.(idempotencyKey);
  }, [idempotencyKey, onSaleIdChange]);

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

  const { quoteInput, quote } = useSaleQuote({
    ...(branchId === undefined ? {} : { branchId }),
    lines,
    discountKind,
    discountValue,
    taxKind,
    taxValue,
    servicePricesValid,
    paymentsTouched,
    setPayments,
  });

  useEffect(() => {
    /**
     * A restore still fetching its client owns the stored record: saving now would
     * overwrite the parked sale with a copy that has no client at all.
     */
    if (!draftHydrated || restoringClient) return;
    if (!hasDraftProgress) {
      removeSaleDraft(workspaceOwner, idempotencyKey);
      setDraftStorageError(false);
      return;
    }
    const saved = writeSaleDraft(workspaceOwner, {
      ...(activeBookingId === undefined ? {} : { bookingId: activeBookingId }),
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
    activeBookingId,
    hasDraftProgress,
    idempotencyKey,
    lines,
    payments,
    paymentsTouched,
    restoringClient,
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
        setAmbiguous(retryableFailure || queued?.state === 'failed');
        return;
      }
      removePendingRequest(input);
      setPendingSale(null);
      setAmbiguous(false);
      removeSaleDraft(workspaceOwner, input.idempotencyKey);
      setDraftRestored(false);
      setConflictRestored(false);
      setReplacesIdempotencyKey(null);
      setCompleted(invoice);
      setPrintError(null);
      void invalidateErpCaches(queryClient, 'sale');
    },
    onError: (error, input) => {
      submitting.current = false;
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
      && remaining !== null && remaining >= BigInt(0)
      && (!hasServiceLines || remaining === BigInt(0))
      && !completion.isPending && !pendingSale,
  );

  const makeInput = (): CompleteSaleInput | null => {
    if (!client || !seller || !sellerOnRoster || !serviceLinesAssigned
      || !quote.data || remaining === null || remaining < BigInt(0)
      || (hasServiceLines && remaining !== BigInt(0))) return null;
    const paymentRows = paymentMethods.flatMap(({ method }) => {
      const amount = payments[method];
      return amount && toCents(amount)! > BigInt(0) ? [{ method, amount }] : [];
    });
    return {
      ...(branchId === undefined ? {} : { branchId }),
      clientId: client.id,
      sellerEmployeeId: seller.id,
      cashierSessionId,
      ...(activeBookingId === undefined ? {} : { bookingId: activeBookingId }),
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
        ...(activeBookingId === undefined ? {} : { bookingId: activeBookingId }),
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
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setPendingSale(stored);
    if (navigator.onLine) completion.mutate(input);
    else submitting.current = false;
  };

  const restoreConflict = (item: OfflineSaleQueueItem) => {
    const draft = item.recoveryDraft;
    if (!draft) return;
    removeSaleDraft(workspaceOwner, idempotencyKey);
    applyDraft(draft);
    // The rejected request is spent: the reopened sale submits under a new key.
    setIdempotencyKey(createUuid());
    setReplacesIdempotencyKey(item.input.idempotencyKey);
    setPendingSale(null);
    setAmbiguous(false);
    setConflictRestored(true);
    completion.reset();
  };

  /** The receipt is printed by the browser, so the counter printer needs no extra driver. */
  const printReceipt = useCallback(() => {
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
  }, []);

  /** Every saved sale prints straight away; the cashier never confirms the receipt. */
  useEffect(() => {
    if (!completed || autoPrinted.current === completed.id) return;
    autoPrinted.current = completed.id;
    printReceipt();
  }, [completed, printReceipt]);

  const reset = () => {
    selectClient(null);
    setEmployee(null);
    setActiveBookingId(undefined);
    setSeller(null);
    setLines([]);
    setPayments({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    setPaymentsTouched(false);
    setDiscountValue('');
    setTaxValue('');
    setCompleted(null);
    autoPrinted.current = null;
    setPrintError(null);
    setDraftRestored(false);
    setDraftStorageError(false);
    setConflictRestored(false);
    setBackgroundSyncCount(0);
    setReplacesIdempotencyKey(null);
    removeSaleDraft(workspaceOwner, idempotencyKey);
    setIdempotencyKey(createUuid());
  };

  /** Puts the offered draft back on screen at the cashier's request. */
  const restoreOfferedDraft = () => {
    const draft = offeredDraft;
    if (!draft) return;
    setOfferedDraft(null);
    applyDraft(draft);
    setDraftRestored(true);
  };

  const discardOfferedDraft = () => {
    const draft = offeredDraft;
    setOfferedDraft(null);
    if (draft) removeSaleDraft(workspaceOwner, draft.idempotencyKey);
  };

  if (completed) {
    return (
      <section className="space-y-5">
        {tabs}
        <SaleCompletedCard
          completed={completed}
          {...(branchId === undefined ? {} : { branchId })}
          printError={printError}
          onPrint={printReceipt}
          onReset={reset}
        />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="بيع جديد"
        description="اختر العميل والخدمات أو المنتجات والموظف ثم راجع الإجمالي المحسوب من الخادم."
      />

      {tabs}

      <SaleDraftNotices
        offeredDraft={offeredDraft}
        restoreOfferedDraft={restoreOfferedDraft}
        discardOfferedDraft={discardOfferedDraft}
        draftRestored={draftRestored}
        bookingPrefillError={bookingPrefillError}
        bookingIsError={booking.isError}
        bookingError={booking.error}
        bookingEmployeesIsError={bookingEmployees.isError}
        refetchBookingEmployees={() => void bookingEmployees.refetch()}
        activeBookingId={activeBookingId}
        conflictRestored={conflictRestored}
        backgroundSyncCount={backgroundSyncCount}
        draftStorageError={draftStorageError}
      />

      <SaleQueueNotices
        draftHydrated={draftHydrated}
        displayedQueueItem={displayedQueueItem}
        online={online}
        hasDraftProgress={hasDraftProgress}
        idempotencyKey={idempotencyKey}
        restoreConflict={restoreConflict}
        onRequestDiscard={(item) => {
          setDiscardError(false);
          setDiscarding(item);
        }}
        ambiguous={ambiguous}
        retryDisabled={!pendingInput || completion.isPending}
        onRetryPending={() => {
          if (pendingInput) completion.mutate(pendingInput);
        }}
        pendingSale={pendingSale}
        pendingMatchesActiveDraft={pendingMatchesActiveDraft}
        hasUnrecoverable={offlineQueueSnapshot.hasUnrecoverable}
      />

      <fieldset
        disabled={Boolean(pendingInput)}
        className="m-0 min-w-0 border-0 p-0"
      >
        <legend className="sr-only">تفاصيل البيع</legend>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
          <div className="min-w-0 space-y-4">
            <SaleClientStep
              {...(branchId === undefined ? {} : { branchId })}
              client={client}
              selectClient={selectClient}
            />

            <SaleCashierStep
              seller={seller}
              setSeller={setSeller}
              roster={roster}
            />

            <SaleBasketStep
              {...(branchId === undefined ? {} : { branchId })}
              employee={employee}
              lines={lines}
              setLines={setLines}
              hasServices={hasServices}
              hasProducts={hasProducts}
              onServicesAvailability={setHasServices}
              onProductsAvailability={setHasProducts}
            />

            {hasServiceLines ? (
              <SaleDefaultEmployeeStep
                {...(branchId === undefined ? {} : { branchId })}
                employee={employee}
                setEmployee={setEmployee}
                setLines={setLines}
              />
            ) : null}
          </div>

          {/* The summary follows the cart on a wide till, but it must scroll on its
              own so the submit button is never pinned below the fold. */}
          <div className="scroll-thin min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <SaleAdjustmentsStep
              step={adjustmentsStep}
              discountKind={discountKind}
              discountValue={discountValue}
              onDiscountKind={setDiscountKind}
              onDiscountValue={setDiscountValue}
              taxKind={taxKind}
              taxValue={taxValue}
              onTaxKind={setTaxKind}
              onTaxValue={setTaxValue}
            />

            <SalePaymentStep
              step={paymentsStep}
              hasLines={lines.length > 0}
              quotePending={quote.isPending}
              quoteIsError={quote.isError}
              quoteError={quote.error}
              quoteData={quote.data}
              onRecalculateQuote={() => void quote.refetch()}
              onRemoveServices={() => {
                setLines((current) => current.filter((line) => line.itemType === 'product'));
                void invalidateErpCaches(queryClient, 'catalog');
              }}
              payments={payments}
              onPaymentChange={(method, value) => {
                setPaymentsTouched(true);
                setPayments((current) => ({ ...current, [method]: value }));
              }}
              remaining={remaining}
              completionError={completion.error}
              ambiguous={ambiguous}
              storageError={storageError}
              ready={ready}
              onSubmit={submit}
            />
          </div>
        </div>
      </fieldset>

      {discarding ? (
        <DiscardPendingSaleModal
          discardError={discardError}
          onClose={() => {
            setDiscardError(false);
            setDiscarding(null);
          }}
          onBack={() => setDiscarding(null)}
          onConfirm={() => {
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
        />
      ) : null}
    </section>
  );
}
