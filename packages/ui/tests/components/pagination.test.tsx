import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { Pagination } from '../../src/components/pagination';

afterEach(cleanup);

describe('Pagination', () => {
  test('is hidden when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} total={8} unit="فاتورة" onPageChange={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  test('always states the page, the page count and the total', () => {
    render(<Pagination page={2} totalPages={7} total={130} unit="فاتورة" onPageChange={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'الصفحات' }).textContent).toContain('صفحة 2 من 7 — 130 فاتورة');
  });

  test('previous and next move one page and stop at the ends', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} totalPages={3} total={50} unit="عميل" onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<Pagination page={3} totalPages={3} total={50} unit="عميل" onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toHaveProperty('disabled', true);
  });

  test('numbered pages mark the current one and jump to another', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={5} totalPages={20} total={400} unit="سجل" onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'الصفحة 5' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة 20' }));
    expect(onPageChange).toHaveBeenLastCalledWith(20);
  });

  test('page size is optional and reports the new size', () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        totalPages={4}
        total={90}
        unit="منتج"
        onPageChange={vi.fn()}
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'عدد الصفوف في الصفحة' }), { target: { value: '50' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
