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
): string | null => {
  try {
    const svg = toSVG({
      bcid: symbology,
      text: value,
      height: heightMm,
      includetext: false,
      // A linear scanner needs a blank quiet zone before and after the symbol
      // to distinguish its first and last bars from surrounding print.
      paddingwidth: 10,
      paddingheight: 0,
    });
    return svg;
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
  { heightMm = 10 }: { heightMm?: number } = {},
): string | null {
  if (!value) return null;
  if (symbology) return draw(value, symbology, heightMm);
  const preferred = symbologyFor(value);
  return draw(value, preferred, heightMm)
    ?? (preferred === 'ean13' ? draw(value, 'code128', heightMm) : null);
}

/** Tall enough that the probe's rounded viewBox height still gives an exact unit scale. */
const PROBE_HEIGHT_MM = 10;

const viewBoxOf = (svg: string): [number, number] | null => {
  const [, wide, tall] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
  return wide && tall ? [Number(wide), Number(tall)] : null;
};

/**
 * The barcode drawn to fill a box of a given size, or null when the value cannot
 * be drawn at all.
 *
 * bwip-js fixes a symbol's width in viewBox units from the value alone — a longer
 * Code 128 is simply wider — and only its height follows the millimetres we ask
 * for. Drawing every code at one fixed height therefore fills the sticker for a
 * 13-digit code and leaves a short stub for a long supplier one. So the value is
 * probed once to learn how wide it is, then redrawn at the height whose natural
 * aspect ratio is the box's. The browser then scales it uniformly to fit, which
 * leaves every bar in the same proportion to its neighbours as the symbology
 * specified — a scanner reads bar widths, so stretching one axis alone would be
 * the one thing that could make a full-size sticker unreadable.
 */
export function barcodeSvgFitting(
  value: string,
  box: { widthMm: number; heightMm: number },
  symbology?: BarcodeSymbology,
): string | null {
  const probe = barcodeSvg(value, symbology, { heightMm: PROBE_HEIGHT_MM });
  if (!probe) return null;
  const units = viewBoxOf(probe);
  if (!units || box.widthMm <= 0) return probe;
  const [unitsWide, unitsTall] = units;
  const heightMm = (unitsWide * box.heightMm * PROBE_HEIGHT_MM) / (box.widthMm * unitsTall);
  return barcodeSvg(value, symbology, { heightMm }) ?? probe;
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
  symbology?: BarcodeSymbology;
  heightMm?: number;
  className?: string;
}) {
  const svg = barcodeSvg(value, symbology, {
    ...(heightMm === undefined ? {} : { heightMm }),
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
