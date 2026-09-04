import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductLabelSheet } from '@/features/products/components/product-label-sheet';
import { LABEL_SIZE_MM } from '@/lib/barcode/label-size';

const originalPrint = window.print;
afterEach(() => { cleanup(); window.print = originalPrint; });

const product = (over: Partial<{ id: number; name: string; sellingPrice: string; barcode: string | null }> = {}) => ({
  id: 11, name: 'شامبو', sellingPrice: '120.00', barcode: '2000000000114', ...over,
});

const sticker = (root: Element) => root.querySelector<HTMLElement>('[data-product-label]')!;
const millimetres = (value: string) => Number.parseFloat(value) || 0;

describe('ProductLabelSheet', () => {
  it('prints one sticker per product, carrying the price, brand, name and code', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product(), product({ id: 12, name: 'بلسم', barcode: '2000000000121' })]} onPrinted={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getAllByText('Capella Care')).toHaveLength(2);
    expect(screen.getByText('شامبو')).toBeTruthy();
    expect(screen.getByText('2000000000114')).toBeTruthy();
    expect(screen.getAllByText('120.00 ج.م')).toHaveLength(2);
    expect(window.print).toHaveBeenCalled();
  });

  it('prints a scannable sticker for a supplier code that is not an EAN-13', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product({ barcode: 'ABC-1234' })]} onPrinted={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('ABC-1234')).toBeTruthy();
  });

  it('skips a product that has no code to print', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product({ barcode: null })]} onPrinted={vi.fn()} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('sizes the page from the one label-size constant', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    // The turned sticker's footprint: the roll's own sides, swapped.
    expect(baseElement.querySelector('style')?.textContent).toContain('10mm 40mm');
  });

  it('composes the sticker at the size of the loaded roll and turns it a quarter turn clockwise', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);
    const page = baseElement.querySelector<HTMLElement>('[data-product-label-page]')!;

    // Authored at the roll's size, so the rows keep the millimetres they were
    // measured for and the bars keep their full 4 cm of length.
    expect(label.style.width).toBe('40mm');
    expect(label.style.height).toBe('10mm');
    expect(label.style.transform).toBe('rotate(90deg)');
    // Turned about its centre, so its corners land exactly on the page: anything
    // other than the swapped footprint would clip the sticker or pad the roll.
    expect(page.style.width).toBe(`${LABEL_SIZE_MM.height}mm`);
    expect(page.style.height).toBe(`${LABEL_SIZE_MM.width}mm`);
    // A sticker four times wider than its page is squeezed to fit unless told not to.
    expect(label.className).toContain('shrink-0');
  });

  it('fits the price, the brand, the name, the bars and the digits inside the one centimetre it has', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);
    const rows = [...label.children] as HTMLElement[];
    const padding = millimetres(label.style.padding) * 2;
    const gaps = millimetres(label.style.gap) * (rows.length - 1);
    const stacked = rows.reduce((total, row) => total + millimetres(row.style.height), 0);

    const digitsOffset = millimetres((rows.at(-1) as HTMLElement).style.marginTop);
    expect(rows).toHaveLength(4);
    expect(padding + gaps + stacked + digitsOffset).toBeLessThanOrEqual(LABEL_SIZE_MM.height);
    expect(screen.getByText('شامبو')).toBeTruthy();
    expect(screen.getByText('Capella Care')).toBeTruthy();
    expect(screen.getByText('120.00 ج.م')).toBeTruthy();
    expect(screen.getByText('2000000000114')).toBeTruthy();
  });

  it('puts the price and brand on the first row and the name on its own truncated line', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const [top, name] = [...sticker(baseElement).children] as HTMLElement[];

    expect(top!.textContent).toContain('120.00 ج.م');
    expect(top!.textContent).toContain('Capella Care');
    expect(name!.textContent).toBe('شامبو');
    expect(name!.className).toContain('truncate');
  });

  it('sits the barcode digits a little below the bars', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const digits = [...sticker(baseElement).children].at(-1) as HTMLElement;
    const offset = millimetres(digits.style.marginTop);

    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(0.4);
  });

  it('gives the bars the full printable width and every millimetre the text rows leave', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);
    const bars = label.querySelector<HTMLElement>('[data-product-label-bars]')!;
    const [top, name, , digits] = [...label.children] as HTMLElement[];

    expect(millimetres(bars.style.width)).toBe(LABEL_SIZE_MM.width - millimetres(label.style.padding) * 2);
    // Whatever is left of the label once the three text rows have been paid for.
    expect(millimetres(bars.style.height)).toBeGreaterThan(
      millimetres(top!.style.height) + millimetres(name!.style.height) + millimetres(digits!.style.height),
    );
  });

  it('does not page-break after the last sticker, which would eject a blank one', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product(), product({ id: 12, barcode: '2000000000121' })]} onPrinted={vi.fn()} />);
    const labels = [...baseElement.querySelectorAll('#print-root > div')];
    expect(labels).toHaveLength(2);
    expect(labels.at(-1)?.className).toContain('last:break-after-auto');
  });

  it('opens the print dialog once, even when the caller re-renders', () => {
    // The screen passes a fresh arrow function every render, so an effect keyed on it
    // would reprint on any background refresh.
    window.print = vi.fn();
    const { rerender } = render(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    rerender(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    rerender(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('tells the caller once the print dialog has closed', () => {
    window.print = vi.fn();
    const onPrinted = vi.fn();
    render(<ProductLabelSheet products={[product()]} onPrinted={onPrinted} />);
    fireEvent(window, new Event('afterprint'));
    expect(onPrinted).toHaveBeenCalled();
  });
});
