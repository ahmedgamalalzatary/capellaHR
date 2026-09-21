import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('prints one sticker per product, carrying the price, brand, name and code', async () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product(), product({ id: 12, name: 'بلسم', barcode: '2000000000121' })]} onPrinted={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getAllByText('Capella Care')).toHaveLength(2);
    expect(screen.getByText('شامبو')).toBeTruthy();
    expect(screen.getByText('2000000000114')).toBeTruthy();
    expect(screen.getAllByText('120.00 ج.م')).toHaveLength(2);
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it('prints a scannable sticker for a supplier code that is not an EAN-13', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product({ barcode: 'ABC-1234' })]} onPrinted={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('ABC-1234')).toBeTruthy();
  });

  it('draws Code 39 bars as a graphic, not as fallback digits of a barcode font', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const bars = baseElement.querySelector<HTMLElement>('[data-product-label-bars]')!;

    expect(bars.querySelector('svg')).not.toBeNull();
    expect(bars.innerHTML).toContain('shape-rendering="crispEdges"');
    expect(bars.textContent).not.toMatch(/\*\d+\*/);
    expect(bars.getAttribute('dir')).toBe('ltr');
  });

  it('fills the barcode row with those bars so Chrome print does not leave a blank band', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const bars = baseElement.querySelector<HTMLElement>('[data-product-label-bars]')!;
    const svg = bars.querySelector('svg')!;

    expect(millimetres(bars.style.height)).toBeGreaterThan(5);
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('100%');
  });

  it('prints supplier letters as Code 39 bars the same way', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product({ barcode: 'ABC-1234' })]} onPrinted={vi.fn()} />);
    const bars = baseElement.querySelector<HTMLElement>('[data-product-label-bars]')!;

    expect(bars.querySelector('svg')).not.toBeNull();
    expect(bars.textContent).not.toContain('*ABC-1234*');
  });

  it('skips a product that has no code to print', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product({ barcode: null })]} onPrinted={vi.fn()} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('sizes the page from the one label-size constant', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const css = [...baseElement.querySelectorAll('#print-root style')]
      .map((node) => node.textContent ?? '')
      .join('\n');
    expect(css).toContain('50mm 25mm');
  });

  it('prints the sticker upright at the size of the loaded roll', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);

    expect(label.style.width).toBe('50mm');
    expect(label.style.height).toBe('25mm');
    // Alpha Soft's 5 cm full layout is landscape on the roll; a stray rotation
    // would print it on its side.
    expect(label.style.transform).toBe('');
  });

  it('fits the price, the brand, the name, the bars and the digits inside the label', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);
    const rows = [...label.children] as HTMLElement[];
    const padding = millimetres(label.style.paddingTop) + millimetres(label.style.paddingBottom);
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

    expect(millimetres(bars.style.width)).toBeCloseTo(
      LABEL_SIZE_MM.width - millimetres(label.style.paddingLeft) - millimetres(label.style.paddingRight),
    );
    // Whatever is left of the label once the three text rows have been paid for.
    expect(millimetres(bars.style.height)).toBeGreaterThan(
      millimetres(top!.style.height) + millimetres(name!.style.height) + millimetres(digits!.style.height),
    );
  });

  it('keeps label content inside a 2mm side clearance without sacrificing barcode height', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product({ sellingPrice: '500.00', name: 'oil hair mask 500 gm 15' })]} onPrinted={vi.fn()} />);
    const label = sticker(baseElement);
    const bars = label.querySelector<HTMLElement>('[data-product-label-bars]')!;
    const left = millimetres(label.style.paddingLeft);
    const right = millimetres(label.style.paddingRight);

    expect(left).toBeGreaterThanOrEqual(2);
    expect(right).toBeGreaterThanOrEqual(2);
    expect(left + millimetres(bars.style.width)).toBeLessThanOrEqual(48);
    expect(millimetres(bars.style.height)).toBeGreaterThanOrEqual(4.4);
    expect(label.textContent).toContain('500.00');
    expect(label.textContent).toContain('Capella Care');
    expect(label.textContent).toContain('oil hair mask 500 gm 15');
  });

  it('does not page-break after the last sticker, which would eject a blank one', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product(), product({ id: 12, barcode: '2000000000121' })]} onPrinted={vi.fn()} />);
    const labels = [...baseElement.querySelectorAll('#print-root > div')];
    expect(labels).toHaveLength(2);
    expect(labels.at(-1)?.className).toContain('last:break-after-auto');
  });

  it('opens the print dialog once, even when the caller re-renders', async () => {
    // The screen passes a fresh arrow function every render, so an effect keyed on it
    // would reprint on any background refresh.
    window.print = vi.fn();
    const { rerender } = render(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    rerender(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    rerender(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it('tells the caller once the print dialog has closed', () => {
    window.print = vi.fn();
    const onPrinted = vi.fn();
    render(<ProductLabelSheet products={[product()]} onPrinted={onPrinted} />);
    fireEvent(window, new Event('afterprint'));
    expect(onPrinted).toHaveBeenCalled();
  });
});
