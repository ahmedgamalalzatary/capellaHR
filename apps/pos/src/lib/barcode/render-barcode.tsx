'use client';

import { toSVG } from 'bwip-js/browser';

/** Both are 1D and both are read by the QW2100 with no configuration. */
export type BarcodeSymbology = 'ean13' | 'code128';

/**
 * The symbology a code should be drawn in. EAN-13 is the retail standard and the
 * shape of every code we generate ourselves, but a supplier's code is kept
 * exactly as scanned and may carry letters or dashes, which only Code 128 can
 * express. Twelve digits is an EAN-13 whose check digit bwip-js appends.
 */
export const symbologyFor = (value: string): BarcodeSymbology =>
  (/^\d{12,13}$/.test(value) ? 'ean13' : 'code128');

const draw = (
  value: string,
  symbology: BarcodeSymbology,
  heightMm: number,
  stretch: boolean,
): string | null => {
  try {
    const svg = toSVG({
      bcid: symbology,
      text: value,
      height: heightMm,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    });
    // Default SVG meet letterboxes a short Code 128 inside a wide box. The
    // receipt needs the bars to fill that box the way a long INV-* payload did.
    return stretch ? svg.replace('<svg ', '<svg preserveAspectRatio="none" ') : svg;
  } catch {
    return null;
  }
};

/**
 * The barcode as inline SVG, or null when the value cannot be drawn at all.
 *
 * With no symbology given the right one is chosen from the value, and a code
 * that looks like an EAN-13 but is not one — a mistyped check digit, say — falls
 * back to Code 128 rather than printing nothing: a sticker that scans as the
 * code written under it is what the shelf actually needs. Passing a symbology
 * explicitly disables both, so a caller that must have an EAN-13 still gets null
 * instead of a silent substitution.
 */
export function barcodeSvg(
  value: string,
  symbology?: BarcodeSymbology,
  { heightMm = 10, stretch = false }: { heightMm?: number; stretch?: boolean } = {},
): string | null {
  if (!value) return null;
  if (symbology) return draw(value, symbology, heightMm, stretch);
  const preferred = symbologyFor(value);
  return draw(value, preferred, heightMm, stretch)
    ?? (preferred === 'ean13' ? draw(value, 'code128', heightMm, stretch) : null);
}

/**
 * bwip-js emits a self-contained SVG built only from the value we passed it, so
 * there is no untrusted markup here. The human-readable digits are printed
 * separately by the caller, which keeps the font ours rather than the library's.
 */
export function Barcode({
  value,
  symbology,
  heightMm,
  stretch,
  className,
}: {
  value: string;
  symbology?: BarcodeSymbology;
  heightMm?: number;
  stretch?: boolean;
  className?: string;
}) {
  const svg = barcodeSvg(value, symbology, {
    ...(heightMm === undefined ? {} : { heightMm }),
    ...(stretch ? { stretch: true } : {}),
  });
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label={value}
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
