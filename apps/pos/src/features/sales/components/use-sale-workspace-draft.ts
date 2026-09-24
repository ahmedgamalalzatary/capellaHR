'use client';

import type { PaymentMethod } from '@capella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClient, type Client } from '@/features/clients';
import { type AssignableEmployee } from '@/features/employee-assignment';
import type { BranchCashierRosterMember } from '@/features/cashier-accounts';

import {
  acquireSaleDraftTab,
  readSaleDraft,
  type StoredSaleDraft,
  removeSaleDraft,
  writeSaleDraft,
} from '../sale-draft-storage';
import {
  restoredLines,
  type AdjustmentKind,
  type Line,
  type PendingSaleOwner,
  type SaleOpenIntent,
} from './sale-primitives';

export function useSaleWorkspaceDraft({
  branchId,
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
}: {
  branchId?: number;
  workspaceOwner: PendingSaleOwner;
  mountIntent: SaleOpenIntent;
  client: Client | null;
  employee: AssignableEmployee | null;
  seller: BranchCashierRosterMember | null;
  lines: Line[];
  discountKind: AdjustmentKind;
  discountValue: string;
  taxKind: AdjustmentKind;
  taxValue: string;
  payments: Record<PaymentMethod, string>;
  paymentsTouched: boolean;
  idempotencyKey: string;
  activeBookingId: number | undefined;
  setClient: (value: Client | null) => void;
  setEmployee: (value: AssignableEmployee | null) => void;
  setActiveBookingId: (value: number | undefined) => void;
  setSeller: (value: BranchCashierRosterMember | null) => void;
  setLines: (value: Line[]) => void;
  setDiscountKind: (value: AdjustmentKind) => void;
  setDiscountValue: (value: string) => void;
  setTaxKind: (value: AdjustmentKind) => void;
  setTaxValue: (value: string) => void;
  setPayments: (value: Record<PaymentMethod, string>) => void;
  setPaymentsTouched: (value: boolean) => void;
  setIdempotencyKey: (value: string) => void;
}) {
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
  }, [setClient]);
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
  const hasDraftProgress = Boolean(
    client || employee || seller || lines.length > 0 || discountValue || taxValue
      || paymentsTouched || restoringClient,
  );
  const mounted = useRef(true);
  useEffect(() => {
    // React intentionally re-runs effects in StrictMode; reset this lifecycle guard on each run.
    // eslint-disable-next-line react-hooks/immutability
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

  useEffect(() => {
    /**
     * A restore still fetching its client owns the stored record: saving now would
     * overwrite the parked sale with a copy that has no client at all.
     */
    if (!draftHydrated || restoringClient) return;
    if (!hasDraftProgress) {
      removeSaleDraft(workspaceOwner, idempotencyKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- parent list is notified via storage, not this setter
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

  return {
    draftHydrated,
    draftRestored,
    setDraftRestored,
    offeredDraft,
    draftStorageError,
    setDraftStorageError,
    restoringClient,
    hasDraftProgress,
    selectClient,
    applyDraft,
    restoreOfferedDraft,
    discardOfferedDraft,
  };
}
