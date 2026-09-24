'use client';

import type { PaymentMethod } from '@capella/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { cashierAccountQueryKeys, listBranchCashierRoster } from '@/features/cashier-accounts';
import { type Client } from '@/features/clients';
import { type AssignableEmployee } from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';
import { createUuid } from '@/lib/uuid';

import { removeOfflineSale, type OfflineSaleQueueItem } from '../offline-sale-queue';
import { removeSaleDraft } from '../sale-draft-storage';
import { DiscardPendingSaleModal } from './discard-pending-sale-modal';
import { SaleAdjustmentsStep } from './sale-adjustments-step';
import { SaleBasketStep } from './sale-basket-step';
import { SaleCashierStep } from './sale-cashier-step';
import { SaleClientStep } from './sale-client-step';
import { SaleCompletedCard } from './sale-completed-card';
import { SaleDefaultEmployeeStep } from './sale-default-employee-step';
import { SaleDraftNotices } from './sale-draft-notices';
import { SalePaymentStep } from './sale-payment-step';
import {
  saleCheckoutBlockers,
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
import { useSaleWorkspaceCheckout } from './use-sale-workspace-checkout';
import { useSaleWorkspaceDraft } from './use-sale-workspace-draft';
import { useSaleWorkspaceQueue } from './use-sale-workspace-queue';

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
  if (roster.isSuccess && seller && !sellerOnRoster) setSeller(null);
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
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => (mountIntent.mode === 'resume' ? mountIntent.draft.idempotencyKey : createUuid()),
  );
  const {
    draftHydrated,
    draftRestored,
    setDraftRestored,
    offeredDraft,
    draftStorageError,
    setDraftStorageError,
    hasDraftProgress,
    selectClient,
    applyDraft,
    restoreOfferedDraft,
    discardOfferedDraft,
  } = useSaleWorkspaceDraft({
    ...(branchId === undefined ? {} : { branchId }),
    workspaceOwner,
    mountIntent,
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
    activeBookingId,
    setClient,
    setEmployee,
    setActiveBookingId,
    setSeller,
    setLines,
    setDiscountKind,
    setDiscountValue,
    setTaxKind,
    setTaxValue,
    setPayments,
    setPaymentsTouched,
    setIdempotencyKey,
  });
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const [discarding, setDiscarding] = useState<OfflineSaleQueueItem | null>(null);
  const [discardError, setDiscardError] = useState(false);
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
  const { online, offlineQueueSnapshot, displayedQueueItem } = useSaleWorkspaceQueue({
    workspaceOwner,
    hasDraftProgress,
    pendingSale,
  });

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
  if (!hasServiceLines && employee !== null) setEmployee(null);

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

  const paidCents = Object.values(payments).reduce<bigint | null>((sum, value) => {
    if (sum === null || !value) return sum;
    const cents = toCents(value);
    return cents === null ? null : sum + cents;
  }, BigInt(0));
  const totalCents = quote.data ? toCents(quote.data.totals.total) : null;
  const remaining = paidCents === null || totalCents === null ? null : totalCents - paidCents;
  const {
    storageError,
    ambiguous,
    setAmbiguous,
    completed,
    printError,
    conflictRestored,
    completion,
    submit,
    restoreConflict,
    printReceipt,
    reset,
  } = useSaleWorkspaceCheckout({
    ...(branchId === undefined ? {} : { branchId }),
    cashierSessionId,
    workspaceOwner,
    client,
    employee,
    seller,
    sellerOnRoster,
    lines,
    discountKind,
    discountValue,
    taxKind,
    taxValue,
    payments,
    paymentsTouched,
    idempotencyKey,
    activeBookingId,
    hasServiceLines,
    serviceLinesAssigned,
    remaining,
    quote,
    quoteInput,
    pendingSale,
    pendingInput,
    selectClient,
    applyDraft,
    setEmployee,
    setActiveBookingId,
    setSeller,
    setLines,
    setPayments,
    setPaymentsTouched,
    setDiscountValue,
    setTaxValue,
    setIdempotencyKey,
    setPendingSale,
    setDraftRestored,
    setDraftStorageError,
    setBackgroundSyncCount,
  });
  const blockers = saleCheckoutBlockers({
    hasClient: Boolean(client),
    sellerOnRoster,
    hasLines: lines.length > 0,
    serviceLinesAssigned,
    servicePricesValid,
    quoteReady: Boolean(quote.data) && !quote.isFetching,
    remaining,
    hasServiceLines,
  });
  const ready = blockers.length === 0 && !completion.isPending && !pendingSale;

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
      {tabs}

      <PageHeader
        title="بيع جديد"
        description="ابحث عن العميل، أضف البنود، ثم ادفع."
      />

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
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <div className="min-w-0 space-y-4">
            <SaleClientStep
              {...(branchId === undefined ? {} : { branchId })}
              client={client}
              selectClient={selectClient}
            />

            {hasServices && (hasServiceLines || lines.length === 0) ? (
              <SaleDefaultEmployeeStep
                {...(branchId === undefined ? {} : { branchId })}
                employee={employee}
                setEmployee={setEmployee}
                setLines={setLines}
              />
            ) : null}

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
          </div>

          <div className="scroll-thin min-w-0 space-y-4 md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto">
            <SaleCashierStep
              seller={seller}
              setSeller={setSeller}
              roster={roster}
            />

            <SaleAdjustmentsStep
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
              blockers={blockers}
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
