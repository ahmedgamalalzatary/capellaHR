import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LABEL_PAGE_RULE, LABEL_SIZE_MM } from '@/lib/barcode/label-size';
import { Barcode, barcodeSvg } from '@/lib/barcode/render-barcode';

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

  it('derives the print page rule from the one label-size constant', () => {
    expect(LABEL_PAGE_RULE).toContain(`${LABEL_SIZE_MM.width}mm ${LABEL_SIZE_MM.height}mm`);
  });
});
