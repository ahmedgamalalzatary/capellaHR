import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DataList, type DataColumn } from '../../src/components/data-list';

interface Invoice { id: string; number: string; client: string; total: string; status: string; cashier: string }

const rows: Invoice[] = [
  { id: 'a', number: 'INV-1', client: 'منى', total: '120.00', status: 'مكتملة', cashier: 'سارة' },
  { id: 'b', number: 'INV-2', client: 'هالة', total: '80.00', status: 'ملغاة', cashier: 'سارة' },
];

const columns: DataColumn<Invoice>[] = [
  { key: 'number', header: 'الرقم', cell: (row) => row.number, mobile: 'primary', sortKey: 'number' },
  { key: 'client', header: 'العميل', cell: (row) => row.client, mobile: 'secondary' },
  { key: 'cashier', header: 'الكاشير', cell: (row) => row.cashier, mobile: 'hidden' },
  { key: 'status', header: 'الحالة', cell: (row) => row.status, mobile: 'status' },
  { key: 'total', header: 'الإجمالي', cell: (row) => row.total, mobile: 'amount', numeric: true, sortKey: 'total' },
];

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
  // @ts-expect-error reset between tests
  delete window.matchMedia;
});

describe('DataList', () => {
  test('wide screens: a table with one header per column and one row per record', () => {
    setWidth(true);
    render(<DataList label="الفواتير" rows={rows} columns={columns} getRowKey={(row) => row.id} />);
    const table = screen.getByRole('table', { name: 'الفواتير' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'الرقم', 'العميل', 'الكاشير', 'الحالة', 'الإجمالي',
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  test('phones: each record is a card; hidden columns are left out, the rest keep their labels', () => {
    setWidth(false);
    render(<DataList label="الفواتير" rows={rows} columns={columns} getRowKey={(row) => row.id} />);
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'الفواتير' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const first = cards[0]!;
    expect(first.textContent).toContain('INV-1');
    expect(first.textContent).toContain('منى');
    expect(first.textContent).toContain('مكتملة');
    expect(first.textContent).toContain('120.00');
    expect(first.textContent).not.toContain('سارة');
  });

  test('sortable headers report the next sort and expose the current one', () => {
    setWidth(true);
    const onSortChange = vi.fn();
    render(
      <DataList
        label="الفواتير"
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.id}
        sort={{ key: 'total', direction: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /الإجمالي/ }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('columnheader', { name: /الرقم/ }).getAttribute('aria-sort')).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'ترتيب حسب الرقم' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'number', direction: 'asc' });
  });

  test('row actions get their own column on wide screens and sit at the bottom of a card on phones', () => {
    setWidth(true);
    const { unmount } = render(
      <DataList label="الفواتير" rows={rows} columns={columns} getRowKey={(row) => row.id}
        actions={(row) => <button type="button">عرض {row.number}</button>} />,
    );
    expect(screen.getByRole('columnheader', { name: 'إجراءات' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'عرض INV-2' })).toBeTruthy();
    unmount();
    setWidth(false);
    render(
      <DataList label="الفواتير" rows={rows} columns={columns} getRowKey={(row) => row.id}
        actions={(row) => <button type="button">عرض {row.number}</button>} />,
    );
    expect(screen.getByRole('button', { name: 'عرض INV-2' })).toBeTruthy();
  });

  test('loading, error and empty states replace the rows', () => {
    setWidth(true);
    const onRetry = vi.fn();
    const { rerender } = render(
      <DataList label="الفواتير" rows={[]} columns={columns} getRowKey={(row) => row.id} loading />,
    );
    expect(screen.getByRole('status', { name: 'جارٍ تحميل الفواتير' })).toBeTruthy();
    rerender(
      <DataList label="الفواتير" rows={[]} columns={columns} getRowKey={(row) => row.id}
        error={{ message: 'تعذر تحميل الفواتير', onRetry }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <DataList label="الفواتير" rows={[]} columns={columns} getRowKey={(row) => row.id} empty={<p>لا توجد فواتير</p>} />,
    );
    expect(screen.getByText('لا توجد فواتير')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('a totals footer appears when a column declares one', () => {
    setWidth(true);
    render(
      <DataList label="الفواتير" rows={rows} getRowKey={(row) => row.id}
        columns={columns.map((column) => column.key === 'total' ? { ...column, footer: '200.00' } : column)} />,
    );
    const table = screen.getByRole('table');
    const footerRow = within(table).getAllByRole('row').at(-1)!;
    expect(footerRow.textContent).toContain('200.00');
  });
});
