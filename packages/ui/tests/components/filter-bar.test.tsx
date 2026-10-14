import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { FilterBar, ListEmptyState, SearchInput } from '../../src/components/filter-bar';

function setWidth(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // @ts-expect-error reset between tests
  delete window.matchMedia;
});

describe('SearchInput', () => {
  test('applies 500 ms after the last keystroke, with no search button', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<SearchInput label="بحث الفواتير" placeholder="بحث برقم الفاتورة أو العميل" value="" onSearch={onSearch} />);
    const box = screen.getByRole('searchbox', { name: 'بحث الفواتير' });
    fireEvent.change(box, { target: { value: 'من' } });
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.change(box, { target: { value: 'منى' } });
    act(() => { vi.advanceTimersByTime(499); });
    expect(onSearch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('منى');
    expect(screen.queryByRole('button', { name: /^بحث$/ })).toBeNull();
  });

  test('Enter applies at once; the clear button empties and applies at once', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<SearchInput label="بحث" placeholder="بحث بالاسم" value="" onSearch={onSearch} />);
    const box = screen.getByRole('searchbox', { name: 'بحث' });
    fireEvent.change(box, { target: { value: '0100' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSearch).toHaveBeenLastCalledWith('0100');
    fireEvent.click(screen.getByRole('button', { name: 'مسح البحث' }));
    expect(onSearch).toHaveBeenLastCalledWith('');
    expect((box as HTMLInputElement).value).toBe('');
    act(() => { vi.advanceTimersByTime(600); });
    expect(onSearch).toHaveBeenCalledTimes(2);
  });

  test('follows the applied value when it changes from outside (reset, back button)', () => {
    const { rerender } = render(<SearchInput label="بحث" placeholder="بحث" value="منى" onSearch={vi.fn()} />);
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'منى');
    rerender(<SearchInput label="بحث" placeholder="بحث" value="" onSearch={vi.fn()} />);
    expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
  });
});

describe('FilterBar', () => {
  const filters = <label>الحالة<select aria-label="الحالة"><option>الكل</option></select></label>;

  test('wide screens: search, filters and reset in one row; reset shows the count', () => {
    setWidth(true);
    const onReset = vi.fn();
    render(
      <FilterBar label="تصفية الفواتير" search={<input type="search" aria-label="بحث" />} activeCount={2} onReset={onReset}>
        {filters}
      </FilterBar>,
    );
    expect(screen.getByRole('search', { name: 'تصفية الفواتير' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'الحالة' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط (2)' }));
    expect(onReset).toHaveBeenCalled();
  });

  test('reset is disabled when nothing is filtered', () => {
    setWidth(true);
    render(<FilterBar label="تصفية" activeCount={0} onReset={vi.fn()}>{filters}</FilterBar>);
    expect(screen.getByRole('button', { name: 'إعادة ضبط' })).toHaveProperty('disabled', true);
  });

  test('phones: search stays, the filters move into a sheet behind "تصفية (N)"', () => {
    setWidth(false);
    render(
      <FilterBar label="تصفية" search={<input type="search" aria-label="بحث" />} activeCount={1} onReset={vi.fn()}>
        {filters}
      </FilterBar>,
    );
    expect(screen.getByRole('searchbox', { name: 'بحث' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'الحالة' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'تصفية (1)' }));
    const sheet = screen.getByRole('dialog', { name: 'تصفية' });
    expect(sheet).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'الحالة' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'عرض النتائج' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('active filters show as removable chips', () => {
    setWidth(true);
    const onRemove = vi.fn();
    render(
      <FilterBar label="تصفية" activeCount={1} onReset={vi.fn()} chips={[{ key: 'status', label: 'الحالة: مدفوعة', onRemove }]}>
        {filters}
      </FilterBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'إزالة الحالة: مدفوعة' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('ListEmptyState', () => {
  test('with filters on: "no matching results" and a reset button', () => {
    const onReset = vi.fn();
    render(<ListEmptyState isFiltered onReset={onReset} title="لا توجد فواتير بعد" />);
    expect(screen.getByText('لا توجد نتائج مطابقة')).toBeTruthy();
    expect(screen.queryByText('لا توجد فواتير بعد')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط التصفية' }));
    expect(onReset).toHaveBeenCalled();
  });

  test('without filters: the first-run message and its action', () => {
    render(
      <ListEmptyState isFiltered={false} onReset={vi.fn()} title="لا توجد فواتير بعد" description="ستظهر هنا بعد أول بيع."
        action={<button type="button">بيع جديد</button>} />,
    );
    expect(screen.getByText('لا توجد فواتير بعد')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'بيع جديد' })).toBeTruthy();
    expect(screen.queryByText('لا توجد نتائج مطابقة')).toBeNull();
  });
});
