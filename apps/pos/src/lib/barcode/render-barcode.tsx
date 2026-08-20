'use client';

import { toSVG } from 'bwip-js/browser';

/** Both are 1D and both are read by the QW2100 with no configuration. */
export type BarcodeSymbology = 'ean13' | 'code128';

/**
 * The barcode as inline SVG, or null when the value is not printable in that
 * symbology — a mistyped check digit, say. A half-printed sticker is worse than
 * no sticker, so the caller is told rather than shown something unscannable.
 */
export function barcodeSvg(
  value: string,
  symbology: BarcodeSymbology,
  { heightMm = 10 }: { heightMm?: number } = {},
): string | null {
  if (!value) return null;
  try {
    return toSVG({
      bcid: symbology,
      text: value,
      height: heightMm,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch {
    return null;
  }
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
  className,
}: {
  value: string;
  symbology: BarcodeSymbology;
  heightMm?: number;
  className?: string;
}) {
  const svg = barcodeSvg(value, symbology, heightMm === undefined ? {} : { heightMm });
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
