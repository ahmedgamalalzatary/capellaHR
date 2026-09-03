'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { LABEL_PAGE_RULE, LABEL_SIZE_MM } from '@/lib/barcode/label-size';
import { barcodeSvgFitting } from '@/lib/barcode/render-barcode';
import { PrintPageRule } from '@/lib/print/page-rule';

/**
 * How the sticker's height is divided.
 *
 * A 40x10mm label has to carry the price, the brand, the product name, the bars
 * and the digits under them, and one centimetre is all there is. So the three
 * text rows are given fixed millimetres and the barcode takes everything left
 * over: enlarging a text row shortens the bars by exactly that much instead of
 * pushing them off the roll. The font sizes are in millimetres rather than
 * points for the same reason — at this size the row height is the constraint,
 * so the glyphs are tied to it.
 */
const LABEL_PADDING_MM = 0.3;
const TOP_ROW_MM = 1.5;
const TOP_FONT_MM = 1.4;
const NAME_ROW_MM = 1.4;
const NAME_FONT_MM = 1.3;
const DIGITS_ROW_MM = 1.3;
const DIGITS_FONT_MM = 1.2;
/** Extra space between the bars and the human-readable digits — a little, not a row. */
const DIGITS_OFFSET_MM = 0.25;
const ROW_GAP_MM = 0.15;
/** Absorbs the sub-millimetre rounding the driver does, so no row is clipped. */
const SLACK_MM = 0.1;
const TEXT_ROWS = 3;

const CONTENT_WIDTH_MM = LABEL_SIZE_MM.width - LABEL_PADDING_MM * 2;
const BARCODE_HEIGHT_MM = LABEL_SIZE_MM.height
  - LABEL_PADDING_MM * 2
  - TOP_ROW_MM
  - NAME_ROW_MM
  - DIGITS_ROW_MM
  - DIGITS_OFFSET_MM
  - ROW_GAP_MM * TEXT_ROWS
  - SLACK_MM;

const LABEL_BRAND = 'Capella Care';

/** Sub-millimetre arithmetic leaves float dust that has no business in the DOM. */
const mm = (value: number) => `${Math.round(value * 100) / 100}mm`;

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
      ? barcodeSvgFitting(product.barcode, { widthMm: CONTENT_WIDTH_MM, heightMm: BARCODE_HEIGHT_MM })
      : null;
    return svg ? [{ product, svg }] : [];
  });

  return createPortal(
    <div id="print-root" className="text-ink">
      {/* Overrides the report page rule, which is A4-shaped and would waste a roll. */}
      <PrintPageRule rule={LABEL_PAGE_RULE} />
      {printable.map(({ product, svg }) => (
        <div
          key={product.id}
          data-product-label
          // The break after the last sticker would feed one blank label off the roll.
          className="flex break-after-page flex-col items-center overflow-hidden last:break-after-auto"
          style={{
            width: mm(LABEL_SIZE_MM.width),
            height: mm(LABEL_SIZE_MM.height),
            padding: mm(LABEL_PADDING_MM),
            gap: mm(ROW_GAP_MM),
          }}
        >
          {/* LTR so the price stays on the left and the brand on the right. */}
          <div
            dir="ltr"
            className="flex w-full items-baseline justify-between gap-1 font-semibold leading-none"
            style={{ height: mm(TOP_ROW_MM), fontSize: mm(TOP_FONT_MM) }}
          >
            <span className="tabular shrink-0">{product.sellingPrice} ج.م</span>
            <span className="truncate">{LABEL_BRAND}</span>
          </div>
          <div
            className="w-full truncate leading-none"
            style={{ height: mm(NAME_ROW_MM), fontSize: mm(NAME_FONT_MM) }}
          >
            {product.name}
          </div>
          {/* Sized in millimetres and filled by an SVG the browser scales to it. */}
          <div
            role="img"
            aria-label={product.barcode!}
            data-product-label-bars
            style={{ width: mm(CONTENT_WIDTH_MM), height: mm(BARCODE_HEIGHT_MM) }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div
            className="tabular w-full text-center leading-none tracking-wider"
            style={{
              height: mm(DIGITS_ROW_MM),
              fontSize: mm(DIGITS_FONT_MM),
              marginTop: mm(DIGITS_OFFSET_MM),
            }}
          >
            {product.barcode}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
