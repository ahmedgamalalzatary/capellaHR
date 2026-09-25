'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { alphaSoftBarcodeSvg } from '@/lib/barcode/alpha-soft-barcode';
import { LABEL_PAGE_RULE, LABEL_PAGE_SIZE_MM, LABEL_SLOT_Y, labelUnitMm } from '@/lib/barcode/label-size';
import { PrintPageRule } from '@/lib/print/page-rule';

const LABEL_BRAND = 'Capella Care';
const priceFormat = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });
const unit = (value: number) => `${labelUnitMm(value)}mm`;

/** Absolute drawing rectangles, in the same units as Alpha Soft's PrintPage. */
const box = (x: number, y: number, width: number, height: number): CSSProperties => ({
  position: 'absolute', left: unit(x), top: unit(y), width: unit(width), height: unit(height),
});
const textStyle = (points: number, bold = false): CSSProperties => ({
  fontSize: `${points}pt`, fontWeight: bold ? 700 : 400,
  lineHeight: unit(11), whiteSpace: 'nowrap',
});

export interface LabelProduct {
  id: number;
  name: string;
  sellingPrice: string;
  barcode: string | null;
}

/**
 * Alpha Soft's selected "Label (1.25 * 3.5 CM) Half Layout", X=0 and Y=0.
 * PrintDocument uses a 150x100 page and fills Y=56 before Y=6. The name, bars
 * and digits start at +11, +21 and +33 respectively; bars are 14 units high.
 * See docs/barcode-printing.md for the recovered source and browser adaptations.
 */
export function ProductLabelSheet({ products, onPrinted }: {
  products: LabelProduct[];
  onPrinted: () => void;
}) {
  // Freeze the submitted job: a background product refresh must not change its
  // pages while the print dialog is open. A new mount starts the next job.
  const [printable] = useState(() => products.flatMap((product) => {
    if (!product.barcode) return [];
    // Desktop barcode/digits centre: 142 - 75 = 67. Keep the full graphic
    // inside the page even for longer codes, instead of clipping negative X.
    const svg = alphaSoftBarcodeSvg(product.barcode, {
      widthMm: labelUnitMm(134), heightMm: labelUnitMm(14),
    });
    return svg ? [{ product, svg }] : [];
  }));
  const handlePrinted = useRef(onPrinted);
  useEffect(() => { handlePrinted.current = onPrinted; }, [onPrinted]);

  useEffect(() => {
    if (!printable.length) {
      handlePrinted.current();
      return;
    }
    let cancelled = false;
    document.body.classList.add('printing-report');
    const finish = () => {
      cancelled = true;
      document.body.classList.remove('printing-report');
      handlePrinted.current();
    };
    window.addEventListener('afterprint', finish, { once: true });
    // Text must be ready before the browser snapshots the page for printing.
    // Barcode bars themselves are self-contained SVG rectangles.
    const print = () => { if (!cancelled) window.print(); };
    void (document.fonts?.ready ?? Promise.resolve()).then(print, print);
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-report');
    };
  }, [printable]);

  if (typeof document === 'undefined') return null;
  const pages = Array.from({ length: Math.ceil(printable.length / 2) }, (_, index) => printable.slice(index * 2, index * 2 + 2));

  return createPortal(
    <div id="print-root" dir="ltr" style={{ width: `${LABEL_PAGE_SIZE_MM.width}mm`, color: '#000' }}>
      <PrintPageRule rule={LABEL_PAGE_RULE} />
      {pages.map((labels, pageIndex) => (
        <div
          key={pageIndex}
          data-product-label-page
          className="relative break-inside-avoid break-after-page overflow-hidden last:break-after-auto"
          style={{
            boxSizing: 'border-box', width: `${LABEL_PAGE_SIZE_MM.width}mm`,
            height: `${LABEL_PAGE_SIZE_MM.height}mm`, margin: 0, padding: 0,
            backgroundColor: '#fff', fontFamily: 'Arial, sans-serif',
          }}
        >
          {labels.map(({ product, svg }, slot) => (
            <div key={slot} data-product-label style={box(0, LABEL_SLOT_Y[slot]!, 150, 44)}>
              <div data-label-header style={box(0, 0, 140, 11)}>
                <span
                  style={{ ...box(0, 0, 60, 11), ...textStyle(7, true), fontFamily: '"Lao UI", Arial, sans-serif' }}
                >
                  {priceFormat.format(Number(product.sellingPrice))} LE
                </span>
                {/* Give the full shop name the available right-hand space. The
                    desktop's 40-unit brand box can clip "Capella Care". */}
                <span style={{ ...box(60, 0, 80, 11), ...textStyle(7), textAlign: 'right' }}>{LABEL_BRAND}</span>
              </div>
              <div
                data-label-name
                dir="auto"
                style={{ ...box(0, 11, 140, 10), ...textStyle(7), textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {product.name}
              </div>
              <div
                role="img"
                aria-label={product.barcode!}
                data-product-label-bars
                dir="ltr"
                style={{ ...box(0, 21, 134, 14), display: 'flex', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <div
                data-label-digits
                dir="ltr"
                style={{
                  ...box(0, 33, 134, 11), ...textStyle(6, true), textAlign: 'center',
                  fontFamily: '"Lao UI", Arial, sans-serif',
                }}
              >
                {product.barcode}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
