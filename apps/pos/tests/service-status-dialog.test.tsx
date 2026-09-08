import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock('../src/features/consumables', () => ({
  listConsumableServices: mocks.list,
  updateServiceExecutionStatus: mocks.update,
}));

import { ServiceStatusDialog } from '../src/features/sales/components/service-status-dialog';

const page = (id: number, pageNumber: number, totalPages: number) => ({
  items: [{
    id, serviceId: 5, status: 'pending', queueNumber: id,
    serviceName: `Service ${id}`, invoiceNumber: 'INV-1',
  }],
  meta: { page: pageNumber, pageSize: 100, total: totalPages, totalPages },
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ServiceStatusDialog', () => {
  it('renders every page of services for the invoice', async () => {
    mocks.list
      .mockResolvedValueOnce(page(1, 1, 2))
      .mockResolvedValueOnce(page(101, 2, 2));

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServiceStatusDialog invoiceId={41} branchId={3} onClose={vi.fn()} />
    </QueryClientProvider>);

    expect(await screen.findByText('Service 101')).toBeDefined();
    expect(mocks.list).toHaveBeenNthCalledWith(2, {
      branchId: 3, invoiceId: 41, page: 2, pageSize: 100,
    });
  });

  it('shows a canceled historical service without offering status actions', async () => {
    mocks.list.mockResolvedValueOnce({
      items: [{
        id: 7, serviceId: 25, status: 'canceled', queueNumber: 2,
        serviceName: '2 ضوافرHard', invoiceNumber: 'INV-14',
      }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServiceStatusDialog invoiceId={14} branchId={1} onClose={vi.fn()} />
    </QueryClientProvider>);

    expect(await screen.findByText('ملغاة')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'لم تبدأ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'قيد التنفيذ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تمت' })).toBeNull();
  });
});
