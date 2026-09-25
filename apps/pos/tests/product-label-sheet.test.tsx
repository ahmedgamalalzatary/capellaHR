import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductLabelSheet } from '@/features/products/components/product-label-sheet';

const originalPrint = window.print;
afterEach(() => { cleanup(); window.print = originalPrint; });

const product = (over: Partial<{ id: number; name: string; sellingPrice: string; barcode: string | null }> = {}) => ({
  id: 11, name: 'hair oil indian 150gm', sellingPrice: '600.00', barcode: '5555236735', ...over,
});

describe('ProductLabelSheet — Alpha Soft half layout', () => {
  it('places two requested labels on one driver page, bottom slot first', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product(), product({ id: 12, barcode: '5555236736' })]} onPrinted={vi.fn()} />);
    const pages = baseElement.querySelectorAll<HTMLElement>('[data-product-label-page]');
    expect(pages).toHaveLength(1);
    expect(pages[0]!.style.width).toBe('38.1mm');
    expect(pages[0]!.style.height).toBe('25.4mm');
    const labels = pages[0]!.querySelectorAll<HTMLElement>('[data-product-label]');
    expect(labels).toHaveLength(2);
    // Recovered PrintPage starts at Y=56, then subtracts 50 hundredths of an inch.
    expect(labels[0]!.style.top).toBe('14.224mm');
    expect(labels[1]!.style.top).toBe('1.524mm');
    expect(labels[0]!.textContent).toContain('5555236735');
    expect(labels[1]!.textContent).toContain('5555236736');
    expect(screen.getAllByText('600 LE')).toHaveLength(2);
    expect(screen.getAllByText('Capella Care')).toHaveLength(2);
  });

  it('starts a new page after each pair without inventing a copy for an odd quantity', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product(), product(), product()]} onPrinted={vi.fn()} />);
    const pages = [...baseElement.querySelectorAll('[data-product-label-page]')];
    expect(pages.map((page) => page.querySelectorAll('[data-product-label]').length)).toEqual([2, 1]);
    expect(pages.at(-1)!.className).toContain('last:break-after-auto');
  });

  it('keeps the page size separate from the measured white sticker size', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    expect(baseElement.querySelector('#print-root style')!.textContent).toContain('38.1mm 25.4mm');
  });

  it('uses the desktop template’s fixed vertical drawing positions', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product()]} onPrinted={vi.fn()} />);
    const label = baseElement.querySelector('[data-product-label]')!;
    const name = label.querySelector<HTMLElement>('[data-label-name]')!;
    const bars = label.querySelector<HTMLElement>('[data-product-label-bars]')!;
    const digits = label.querySelector<HTMLElement>('[data-label-digits]')!;
    expect(name.style.top).toBe('2.794mm');
    expect(bars.style.top).toBe('5.334mm');
    expect(bars.style.height).toBe('3.556mm');
    expect(digits.style.top).toBe('8.382mm');
    expect(bars.querySelector('svg')).not.toBeNull();
    expect(bars.textContent).not.toContain('*');
  });

  it('keeps long generated codes and supplier codes drawable without changing their values', () => {
    window.print = vi.fn();
    render(<ProductLabelSheet products={[
      product({ barcode: '2000000000114' }),
      product({ barcode: 'SKU_9/a+B.1' }),
    ]} onPrinted={vi.fn()} />);
    for (const code of ['2000000000114', 'SKU_9/a+B.1']) {
      expect(screen.getByRole('img', { name: code }).querySelector('svg')).not.toBeNull();
      expect(screen.getByText(code)).toBeTruthy();
    }
  });

  it('does not allocate a slot for a product without a barcode', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product({ barcode: null }), product()]} onPrinted={vi.fn()} />);
    expect(baseElement.querySelectorAll('[data-product-label]')).toHaveLength(1);
  });

  it('does not send an empty label page to the printer', () => {
    window.print = vi.fn();
    const { baseElement } = render(<ProductLabelSheet products={[product({ barcode: null })]} onPrinted={vi.fn()} />);
    expect(baseElement.querySelectorAll('[data-product-label-page]')).toHaveLength(0);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('opens the print dialog once when the caller re-renders', async () => {
    window.print = vi.fn();
    const { rerender } = render(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    rerender(<ProductLabelSheet products={[product()]} onPrinted={() => undefined} />);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it('cleans up printing mode after the dialog closes', async () => {
    window.print = vi.fn();
    const onPrinted = vi.fn();
    render(<ProductLabelSheet products={[product()]} onPrinted={onPrinted} />);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('afterprint'));
    expect(onPrinted).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });
});
