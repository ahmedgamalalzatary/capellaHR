'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { LABEL_PAGE_RULE, LABEL_SIZE_MM } from '@/lib/barcode/label-size';
import { barcodeSvg } from '@/lib/barcode/render-barcode';

/** Shared by the skip check and the sticker so the two never disagree. */
const BARCODE_HEIGHT_MM = 9;

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
 * A product with no code, or with one no 1D symbology can express, is skipped
 * rather than printed blank — a sticker carrying a name and a price but no bars
 * looks finished and is useless at the till, so the admin gives it a code first.
 */
export function ProductLabelSheet({ products, onPrinted }: {
  products: LabelProduct[];
  onPrinted: () => void;
}) {
  // The screen hands us a fresh arrow function on every render, so the callback is read
  // through a ref: the dialog opens once per mounted sheet, not once per re-render.
  const handlePrinted = useRef(onPrinted);
  handlePrinted.current = onPrinted;

  useEffect(() => {
    const { body } = document;
    body.classList.add('printing-report');
    const finish = () => {
      body.classList.remove('printing-report');
      handlePrinted.current();
    };
    window.addEventListener('afterprint', finish, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', finish);
      body.classList.remove('printing-report');
    };
  }, []);

  if (typeof document === 'undefined') return null;
  // Drawn once and reused: the same call decides whether the sticker can be printed at all
  // and supplies the bars, so no product is rendered through bwip-js twice.
  const printable = products.flatMap((product) => {
    const svg = product.barcode
      ? barcodeSvg(product.barcode, undefined, { heightMm: BARCODE_HEIGHT_MM })
      : null;
    return svg ? [{ product, svg }] : [];
  });

  return createPortal(
    <div id="print-root" className="text-ink">
      {/* Overrides the report page rule, which is A4-shaped and would waste a roll. */}
      <style>{`@media print { ${LABEL_PAGE_RULE} }`}</style>
      {printable.map(({ product, svg }) => (
        <div
          key={product.id}
          // The break after the last sticker would feed one blank label off the roll.
          className="flex break-after-page flex-col items-center justify-center gap-0.5 text-center last:break-after-auto"
          style={{ width: `${LABEL_SIZE_MM.width}mm`, height: `${LABEL_SIZE_MM.height}mm` }}
        >
          <span className="w-full truncate px-1 text-[9pt] font-semibold leading-tight">{product.name}</span>
          <div
            role="img"
            aria-label={product.barcode!}
            className="w-[34mm]"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <span className="text-[7pt] tracking-wider">{product.barcode}</span>
          <span className="text-[9pt] font-semibold">{product.sellingPrice} ج.م</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
