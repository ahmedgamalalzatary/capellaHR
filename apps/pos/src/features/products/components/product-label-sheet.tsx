'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { LABEL_PAGE_RULE, LABEL_SIZE_MM } from '@/lib/barcode/label-size';
import { Barcode } from '@/lib/barcode/render-barcode';

export interface LabelProduct {
  id: number;
  name: string;
  sellingPrice: string;
  barcode: string | null;
}

/**
 * The stickers, printed through the XP-233B's Windows driver rather than raw
 * printer bytes. Mounted beside the app like the report sheet, because anything
 * nested in the shell's scrolling layout comes out blank.
 *
 * A product with no code is skipped rather than printed blank — the admin gives
 * it a code first.
 */
export function ProductLabelSheet({ products, onPrinted }: {
  products: LabelProduct[];
  onPrinted: () => void;
}) {
  useEffect(() => {
    const { body } = document;
    body.classList.add('printing-report');
    const finish = () => {
      body.classList.remove('printing-report');
      onPrinted();
    };
    window.addEventListener('afterprint', finish, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', finish);
      body.classList.remove('printing-report');
    };
  }, [onPrinted]);

  if (typeof document === 'undefined') return null;
  const printable = products.filter((product) => product.barcode);

  return createPortal(
    <div id="print-root" className="text-ink">
      {/* Overrides the report page rule, which is A4-shaped and would waste a roll. */}
      <style>{`@media print { ${LABEL_PAGE_RULE} }`}</style>
      {printable.map((product) => (
        <div
          key={product.id}
          className="flex break-after-page flex-col items-center justify-center gap-0.5 text-center"
          style={{ width: `${LABEL_SIZE_MM.width}mm`, height: `${LABEL_SIZE_MM.height}mm` }}
        >
          <span className="w-full truncate px-1 text-[9pt] font-semibold leading-tight">{product.name}</span>
          <Barcode value={product.barcode!} symbology="ean13" heightMm={9} className="w-[34mm]" />
          <span className="text-[7pt] tracking-wider">{product.barcode}</span>
          <span className="text-[9pt] font-semibold">{product.sellingPrice} ج.م</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
