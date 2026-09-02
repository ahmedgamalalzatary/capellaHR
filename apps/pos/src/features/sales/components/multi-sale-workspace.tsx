'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@capella/ui';

import { createUuid } from '@/lib/uuid';

import {
  listSaleDrafts,
  removeSaleDraft,
  setActiveSaleDraftId,
  subscribeSaleDrafts,
  type SaleDraftOwner,
  type StoredSaleDraftRecord,
} from '../sale-draft-storage';
import type { SaleOpenIntent } from './sale-primitives';
import { SaleTabs, type SaleTab } from './sale-tabs';
import { SaleWorkspace } from './sale-workspace';

/**
 * Holds the sales one till has on the go at the same time.
 *
 * A client who walks away mid-sale keeps their basket: the sale stays parked in this
 * browser under its own request key while the cashier serves the next person, and is
 * picked up again from the bar above the sale. Only the sale on screen is mounted, so
 * the one being served is the only one that can be edited or submitted; the others
 * wait in session storage exactly as a single interrupted draft always has.
 */
export function MultiSaleWorkspace({
  branchId,
  workspaceBranchId,
  cashierSessionId,
  accountId,
  role,
  bookingId,
}: {
  branchId?: number;
  workspaceBranchId: number;
  cashierSessionId: number;
  accountId: number | null;
  role: 'admin' | 'cashier';
  bookingId?: number;
}) {
  const owner = useMemo<SaleDraftOwner>(() => ({
    accountId,
    role,
    branchId: workspaceBranchId,
    cashierSessionId,
  }), [accountId, cashierSessionId, role, workspaceBranchId]);
  const [open, setOpen] = useState<{ mountKey: string; intent: SaleOpenIntent }>({
    mountKey: 'initial',
    intent: { mode: 'initial' },
  });
  /** The request key of the sale on screen, as reported by the sale itself. */
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [parked, setParked] = useState<StoredSaleDraftRecord[]>([]);
  const [closing, setClosing] = useState<SaleTab | null>(null);

  /**
   * Storage is read only after mounting: the server renders no parked sale, so the
   * first client render must match it before the bar appears.
   */
  useEffect(() => {
    const sync = () => setParked(listSaleDrafts(owner));
    sync();
    return subscribeSaleDrafts(sync);
  }, [owner]);

  const tabs = useMemo<SaleTab[]>(() => {
    const stored = parked.map<SaleTab>((record) => ({
      id: record.draft.idempotencyKey,
      isNew: false,
      record,
    }));
    // A sale with nothing entered yet is stored nowhere, so it is listed from memory.
    return activeSaleId !== null && !stored.some((tab) => tab.id === activeSaleId)
      ? [...stored, { id: activeSaleId, isNew: true, record: null }]
      : stored;
  }, [activeSaleId, parked]);

  const handleSaleIdChange = useCallback((idempotencyKey: string) => {
    setActiveSaleId(idempotencyKey);
  }, []);

  const openNew = useCallback(() => {
    setActiveSaleId(null);
    setActiveSaleDraftId(owner, null);
    setOpen({ mountKey: createUuid(), intent: { mode: 'new' } });
  }, [owner]);

  const openParked = (tab: SaleTab) => {
    if (tab.id === activeSaleId || !tab.record) return;
    setActiveSaleId(tab.id);
    // Recorded so leaving /sales and coming back reopens the sale being served.
    setActiveSaleDraftId(owner, tab.id);
    setOpen({ mountKey: createUuid(), intent: { mode: 'resume', draft: tab.record.draft } });
  };

  const confirmClose = () => {
    if (!closing) return;
    const wasOnScreen = closing.id === activeSaleId;
    removeSaleDraft(owner, closing.id);
    setClosing(null);
    if (wasOnScreen) openNew();
  };

  // A booking prefills the sale it was opened with, never the sale opened after it.
  const carriesBooking = bookingId !== undefined && open.intent.mode === 'initial';

  return (
    <>
      <SaleWorkspace
        key={open.mountKey}
        {...(branchId === undefined ? {} : { branchId })}
        workspaceBranchId={workspaceBranchId}
        cashierSessionId={cashierSessionId}
        accountId={accountId}
        role={role}
        {...(carriesBooking ? { bookingId } : {})}
        intent={open.intent}
        onSaleIdChange={handleSaleIdChange}
        tabs={(
          <SaleTabs
            tabs={tabs}
            activeId={activeSaleId}
            onOpen={openParked}
            onNew={openNew}
            onRequestClose={setClosing}
          />
        )}
      />

      {closing ? (
        <ConfirmDialog
          title="حذف البيع المفتوح"
          description="سيُحذف هذا البيع غير المكتمل من هذا الجهاز نهائيًا."
          confirmLabel="حذف البيع"
          cancelLabel="رجوع"
          tone="danger"
          onConfirm={confirmClose}
          onCancel={() => setClosing(null)}
        />
      ) : null}
    </>
  );
}
