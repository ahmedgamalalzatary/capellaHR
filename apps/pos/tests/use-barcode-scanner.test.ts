import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBarcodeScanner } from '@/lib/barcode/use-barcode-scanner';

/** The QW2100 types a whole code in tens of milliseconds and presses Enter. */
const scan = (code: string, gapMs = 10) => {
  for (const character of code) {
    vi.advanceTimersByTime(gapMs);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }));
  }
  vi.advanceTimersByTime(gapMs);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

describe('useBarcodeScanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a code delivered at scanner speed', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    scan('2000000000114');
    expect(onScan).toHaveBeenCalledWith('2000000000114');
  });

  it('ignores a human typing the same digits slowly', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    scan('2000000000114', 200);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('leaves a form field alone, so scanning never corrupts what is being typed', () => {
    const onScan = vi.fn();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    renderHook(() => useBarcodeScanner({ onScan }));
    for (const character of '2000000000114') {
      vi.advanceTimersByTime(10);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }));
    }
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onScan).not.toHaveBeenCalled();
    field.remove();
  });

  it('drops a burst too short to be a real code', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    scan('12');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('stops listening when disabled', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan, enabled: false }));
    scan('2000000000114');
    expect(onScan).not.toHaveBeenCalled();
  });
});
