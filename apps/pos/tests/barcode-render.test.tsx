import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LABEL_PAGE_RULE, LABEL_SIZE_MM } from '@/lib/barcode/label-size';
import { Barcode, barcodeSvg, symbologyFor } from '@/lib/barcode/render-barcode';

describe('barcode rendering', () => {
  it('draws an EAN-13 and a Code 128 the QW2100 can read', () => {
    expect(barcodeSvg('2000000000114', 'ean13')).toContain('<svg');
    expect(barcodeSvg('INV-2026-000123', 'code128')).toContain('<svg');
  });

  it('draws nothing rather than throwing on a code the symbology rejects', () => {
    // A mistyped check digit is not a printable EAN-13, and a half-printed
    // sticker is worse than none.
    expect(barcodeSvg('2000000000110', 'ean13')).toBe(null);
    expect(barcodeSvg('', 'code128')).toBe(null);
  });

  it('renders the code as an image with the value as its label', () => {
    render(<Barcode value="2000000000114" symbology="ean13" />);
    expect(screen.getByRole('img', { name: '2000000000114' }).querySelector('svg')).not.toBeNull();
  });

  it('picks EAN-13 for a thirteen-digit code and Code 128 for a supplier code', () => {
    expect(symbologyFor('2000000000114')).toBe('ean13');
    expect(symbologyFor('200000000011')).toBe('ean13');
    expect(symbologyFor('ABC-1234')).toBe('code128');
    expect(symbologyFor('12345678901234')).toBe('code128');
  });

  it('draws a supplier code that is not an EAN-13 rather than nothing', () => {
    // The contract keeps a supplier's own code exactly as scanned, so the
    // sticker has to carry letters and dashes as well as digits.
    expect(barcodeSvg('ABC-1234')).toContain('<svg');
    expect(barcodeSvg('SKU_9/A+B.1')).toContain('<svg');
  });

  it('falls back to Code 128 when a digits-only code is not a valid EAN-13', () => {
    // A mistyped check digit still has to reach the shelf as something scannable.
    expect(barcodeSvg('2000000000110')).toContain('<svg');
  });

  it('renders a supplier code as an image without being told the symbology', () => {
    render(<Barcode value="ABC-1234" />);
    expect(screen.getByRole('img', { name: 'ABC-1234' }).querySelector('svg')).not.toBeNull();
  });

  it('derives the print page rule from the one label-size constant', () => {
    expect(LABEL_PAGE_RULE).toContain(`${LABEL_SIZE_MM.width}mm ${LABEL_SIZE_MM.height}mm`);
  });

  it.each([
    ['2000000000114', 'ean13' as const],
    ['INV-2026.08.03-14.35-17', 'code128' as const],
  ])('leaves scanner quiet zones around %s', (value, symbology) => {
    const svg = barcodeSvg(value, symbology)!;
    const [, viewBoxWidth = '0'] = svg.match(/viewBox="0 0 (\d+) /) ?? [];
    const barPositions = [...svg.matchAll(/M(\d+) /g)].map((match) => Number(match[1]));

    // bwip-js' default two-unit module means ten required blank modules occupy
    // at least twenty viewBox units on each side of the symbol.
    expect(Math.min(...barPositions)).toBeGreaterThanOrEqual(20);
    expect(Number(viewBoxWidth) - Math.max(...barPositions)).toBeGreaterThanOrEqual(20);
  });

  it('never distorts bar widths with non-proportional SVG scaling', () => {
    expect(barcodeSvg('INV-2026.08.03-14.35-17', 'code128')).not.toContain('preserveAspectRatio="none"');
  });
});
