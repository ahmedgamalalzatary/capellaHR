'use client';

import { Button, Input, Label, Modal } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { FieldError } from '@/components/feedback/notice';

import { type FormDraft } from '@/lib/form-draft';

import { type Supplier } from '../api/suppliers-api';
import { errorText } from './supplier-purchase-money';

export function SupplierFormModal({
  editing,
  commandPending,
  supplierName,
  phone,
  notes,
  supplierDraft,
  saveSupplier,
  setSupplierName,
  setPhone,
  setNotes,
  clearSupplier,
}: {
  editing: Supplier | null;
  commandPending: boolean;
  supplierName: string;
  phone: string;
  notes: string;
  supplierDraft: FormDraft<{ supplierName: string; phone: string; notes: string }>;
  saveSupplier: { isError: boolean; error: unknown; mutate: () => void };
  setSupplierName: (value: string) => void;
  setPhone: (value: string) => void;
  setNotes: (value: string) => void;
  clearSupplier: () => void;
}) {
  return (
    <Modal
      title={editing ? `تعديل ${editing.name}` : 'إضافة مورد'}
      className="max-h-[90dvh] max-w-lg overflow-y-auto"
      onClose={() => { if (!commandPending) clearSupplier(); }}
    >
      <div className="space-y-4">
        {supplierDraft.pending ? (
          <DraftNotice
            onRestore={() => {
              const stored = supplierDraft.restore();
              if (!stored) return;
              setSupplierName(stored.supplierName);
              setPhone(stored.phone);
              setNotes(stored.notes);
            }}
            onDiscard={supplierDraft.discard}
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="supplier-name">اسم المورد</Label>
            <Input id="supplier-name" aria-label="اسم المورد" placeholder="اسم المورد" disabled={commandPending} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-phone">هاتف المورد</Label>
            <Input id="supplier-phone" aria-label="هاتف المورد" placeholder="الهاتف (اختياري)" className="text-start" disabled={commandPending} value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-notes">ملاحظات المورد</Label>
            <Input id="supplier-notes" aria-label="ملاحظات المورد" placeholder="ملاحظات" disabled={commandPending} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
          <Button disabled={!supplierName.trim() || commandPending} onClick={() => { if (!commandPending) saveSupplier.mutate(); }}>
            {editing ? 'حفظ المورد' : 'إضافة المورد'}
          </Button>
          <Button variant="ghost" disabled={commandPending} onClick={clearSupplier}>إلغاء</Button>
        </div>
        {saveSupplier.isError ? <FieldError>{errorText(saveSupplier.error)}</FieldError> : null}
      </div>
    </Modal>
  );
}
