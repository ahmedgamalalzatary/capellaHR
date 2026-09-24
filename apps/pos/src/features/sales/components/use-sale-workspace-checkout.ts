'use client';

import type {
  CompleteSaleInput,
  PublicInvoiceDto,
  PaymentMethod,
  QuoteSaleInput,
} from '@capella/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { invalidateErpCaches } from '@/lib/erp-cache';
import { type AssignableEmployee } from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';
import { ApiError } from '@/lib/api/client';
import { notifySuccess } from '@/lib/notify';
import { createUuid } from '@/lib/uuid';
import { type Client } from '@/features/clients';

import { completeSale } from '../api/sales-api';
import {
  enqueueOfflineSale,
  listOfflineSales,
  markOfflineSaleFailed,
  type OfflineSaleQueueItem,
} from '../offline-sale-queue';
import { synchronizeOfflineSales } from '../offline-sale-sync';
import { removeSaleDraft, type StoredSaleDraft } from '../sale-draft-storage';
import { removePendingRequest } from './pending-sale-storage';
import {
  paymentMethods,
  toCents,
  type AdjustmentKind,
  type Line,
  type PendingSale,
  type PendingSaleOwner,
} from './sale-primitives';

export function useSaleWorkspaceCheckout({
  branchId,
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
}: {
  branchId?: number;
  cashierSessionId: number;
  workspaceOwner: PendingSaleOwner;
  client: Client | null;
  employee: AssignableEmployee | null;
  seller: BranchCashierRosterMember | null;
  sellerOnRoster: boolean;
  lines: Line[];
  discountKind: AdjustmentKind;
  discountValue: string;
  taxKind: AdjustmentKind;
  taxValue: string;
  payments: Record<PaymentMethod, string>;
  paymentsTouched: boolean;
  idempotencyKey: string;
  activeBookingId: number | undefined;
  hasServiceLines: boolean;
  serviceLinesAssigned: boolean;
  remaining: bigint | null;
  quote: { data: { totals: { total: string } } | undefined };
  quoteInput: QuoteSaleInput;
  pendingSale: PendingSale | null;
  pendingInput: CompleteSaleInput | null;
  selectClient: (next: Client | null) => void;
  applyDraft: (draft: StoredSaleDraft) => void;
  setEmployee: (value: AssignableEmployee | null) => void;
  setActiveBookingId: (value: number | undefined) => void;
  setSeller: (value: BranchCashierRosterMember | null) => void;
  setLines: (value: Line[]) => void;
  setPayments: (value: Record<PaymentMethod, string>) => void;
  setPaymentsTouched: (value: boolean) => void;
  setDiscountValue: (value: string) => void;
  setTaxValue: (value: string) => void;
  setIdempotencyKey: (value: string) => void;
  setPendingSale: Dispatch<SetStateAction<PendingSale | null>>;
  setDraftRestored: (value: boolean) => void;
  setDraftStorageError: (value: boolean) => void;
  setBackgroundSyncCount: Dispatch<SetStateAction<number>>;
}) {
  const queryClient = useQueryClient();
  const [storageError, setStorageError] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [completed, setCompleted] = useState<PublicInvoiceDto | null>(null);
  /** Printed once per saved sale, so a retry render never sends a second copy to the printer. */
  const autoPrinted = useRef<number | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [replacesIdempotencyKey, setReplacesIdempotencyKey] = useState<string | null>(null);
  const [conflictRestored, setConflictRestored] = useState(false);
  const didReplayOnMount = useRef(false);
  const submitting = useRef(false);

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
      notifySuccess('تم حفظ البيع.');
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

  return {
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
  };
}
