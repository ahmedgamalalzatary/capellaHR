import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductLabelSheet } from '@/features/products/components/product-label-sheet';

const originalPrint = window.print;
afterEach(() => { cleanup(); window.print = originalPrint; });

const product = (over: Partial<{ id: number; name: string; sellingPrice: string; barcode: string | null }> = {}) => ({
  id: 11, name: 'شامبو', sellingPrice: '120.00', barcode: '2000000000114', ...over,
});

describe('ProductLabelSheet', () => {
  it('prints one sticker per product, carrying the name, price and code', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[product(), product({ id: 12, name: 'بلسم', barcode: '2000000000121' })]} onPrinted={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
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
    expect(baseElement.querySelector('style')?.textContent).toContain('20mm 30mm');
  });

  it('rotates the complete sticker content 90 degrees clockwise', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const content = baseElement.querySelector<HTMLElement>('[data-product-label-content]');
    expect(content?.style.width).toBe('30mm');
    expect(content?.style.height).toBe('20mm');
    expect(content?.style.transform).toBe('rotate(90deg)');
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
