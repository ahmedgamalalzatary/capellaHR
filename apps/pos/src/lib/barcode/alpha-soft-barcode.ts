'use client';

import { barcodeSvgFitting } from './render-barcode';

// Standard Code 39 symbols, including the final start/stop symbol. Each digit
// describes alternating bar/space widths; 1 = narrow, 3 = wide.
const CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';
const PATTERNS = [
  '1113313111', '3113111131', '1133111131', '3133111111', '1113311131',
  '3113311111', '1133311111', '1113113131', '3113113111', '1133113111',
  '3111131131', '1131131131', '3131131111', '1111331131', '3111331111',
  '1131331111', '1111133131', '3111133111', '1131133111', '1111333111',
  '3111111331', '1131111331', '3131111311', '1111311331', '3111311311',
  '1131311311', '1111113331', '3111113311', '1131113311', '1111313311',
  '3311111131', '1331111131', '3331111111', '1311311131', '3311311111',
  '1331311111', '1311113131', '3311113111', '1331113111', '1313131111',
  '1313111311', '1311131311', '1113131311', '1311313111',
] as const;

// Measured from Alpha Soft's embedded fre3of9x font: UPEM 2048, advance 784,
// narrow strokes/spaces 52, wide strokes/spaces 140. The selected template
// draws this font at 20pt. These outlines do not depend on a barcode font loading.
const NARROW = 52;
const WIDE = 140;
const QUIET_ZONE = NARROW * 10;
const FONT_UNIT_MM = (20 * 25.4) / (72 * 2048);

export function alphaSoftBarcodeSvg(
  value: string,
  box: { widthMm: number; heightMm: number },
): string | null {
  if (!value || box.widthMm <= 0 || box.heightMm <= 0) return null;
  // Preserve supplier values that require full ASCII without relying on the
  // scanner's optional extended-Code-39 setting (e.g. +A versus lowercase a).
  if (!/^[0-9A-Z .$/+%-]+$/.test(value)) {
    return barcodeSvgFitting(value, box, 'code128')
      ?.replace('<svg ', '<svg width="100%" height="100%" ') ?? null;
  }

  const bars: { x: number; width: number }[] = [];
  let x = QUIET_ZONE;
  for (const character of `*${value}*`) {
    const pattern = PATTERNS[CHARACTERS.indexOf(character)]!;
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === '1' ? NARROW : WIDE;
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  const unitsWide = x - NARROW + QUIET_ZONE;
  // Alpha Soft's fixed 20pt text can clip a long code at the page edge. Fit the
  // complete symbol and both quiet zones; preserve every relative bar width.
  const widthMm = Math.min(unitsWide * FONT_UNIT_MM, box.widthMm);
  const unitsTall = unitsWide * box.heightMm / widthMm;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="100%" viewBox="0 0 ${unitsWide} ${unitsTall}" shape-rendering="crispEdges">${bars.map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="${unitsTall}" fill="#000"/>`).join('')}</svg>`;
}
