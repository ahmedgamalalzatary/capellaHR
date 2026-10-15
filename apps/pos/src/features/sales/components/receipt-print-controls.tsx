'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import { Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import { Button, Modal } from '@capella/ui';

import { loadReceiptQr, ReceiptBundle, receiptUnits } from './receipt';

/** The same receipt choices for checkout and stored invoice reprinting. */
export function ReceiptPrintControls({ invoice, onPrint, inline = false }: {
  invoice: PublicInvoiceDto;
  onPrint(): void;
  inline?: boolean;
}) {
  const units = receiptUnits(invoice).filter((unit) => unit.itemType === 'service');
  const options = [
    { key: 'customer', label: 'الفاتورة الكاملة للعميل' },
    ...units.map((unit, index) => ({
      key: unit.receiptKey,
      label: `${index + 1}. ${unit.name} — ${unit.employee?.name ?? 'بدون موظف'}${unit.queueNumbers.length ? ` — دور ${unit.queueNumbers[0]}` : ''}`,
    })),
  ];
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => options.map(({ key }) => key));
  const [printing, setPrinting] = useState<string[] | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [preparing, setPreparing] = useState(false);
  const busy = useRef(false);

  async function printSelected() {
    if (!selected.length || busy.current) return;
    busy.current = true;
    setPreparing(true);
    try {
      const svg = await loadReceiptQr().catch(() => '');
      await document.fonts?.ready;
      // Commit the complete paper before the browser snapshots it.
      flushSync(() => { setQrSvg(svg); setPrinting(selected); setOpen(false); });
      onPrint();
    } finally {
      setPrinting(null);
      setPreparing(false);
      busy.current = false;
    }
  }

  const choices = <div className="space-y-3 text-start">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">اختر الإيصالات للطباعة</p>
      <Button size="sm" variant="secondary" disabled={preparing} onClick={() => setSelected(
        selected.length === options.length ? [] : options.map(({ key }) => key),
      )}>{selected.length === options.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</Button>
    </div>
    <fieldset disabled={preparing} className="max-h-[45dvh] overflow-y-auto divide-y divide-line rounded-control border border-line">
      <legend className="sr-only">الإيصالات المتاحة</legend>
      {options.map(({ key, label }) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface">
        <input type="checkbox" className="size-4 shrink-0 accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          checked={selected.includes(key)} onChange={(event) => setSelected((current) => event.target.checked
            ? [...current, key] : current.filter((value) => value !== key))} />
        <span className="min-w-0 break-words">{label}</span>
      </label>)}
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2">
      {!inline ? <Button variant="secondary" disabled={preparing} onClick={() => setOpen(false)}>إلغاء</Button> : null}
      <Button disabled={!selected.length || preparing} onClick={() => void printSelected()}>
        <Printer className="size-4" aria-hidden />{preparing ? 'جارٍ تجهيز الطباعة…' : `طباعة المحدد (${selected.length})`}
      </Button>
    </div>
  </div>;

  return <>
    {inline ? choices : <Button onClick={() => setOpen(true)}><Printer className="size-4" aria-hidden />طباعة الإيصال</Button>}
    {!inline && open ? <Modal title="طباعة الإيصال" dismissOnBackdrop={!preparing} onClose={() => { if (!preparing) setOpen(false); }}>{choices}</Modal> : null}
    {printing ? createPortal(<div data-sale-print-root className="hidden print:block" dir="rtl">
      <ReceiptBundle invoice={invoice} selected={printing} qrSvg={qrSvg} />
    </div>, document.body) : null}
  </>;
}
