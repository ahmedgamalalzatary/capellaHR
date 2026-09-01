import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ balances: vi.fn(), services: vi.fn(), complete: vi.fn(), session: vi.fn() }));
vi.mock('../src/features/consumables/api/consumables-api', () => ({
  listConsumableBalances: mocks.balances,
  listConsumableServices: mocks.services,
  completeServiceExecutions: mocks.complete,
  configureConsumable: vi.fn(), transferConsumableStock: vi.fn(), correctServiceExecution: vi.fn(),
}));
vi.mock('../src/features/auth', () => ({ useSession: mocks.session }));

import { ConsumablesView } from '../src/features/consumables/components/consumables-view';

const page = (items: unknown[]) => ({ items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ConsumablesView /></QueryClientProvider>);

beforeEach(() => {
  mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'cashier', branchId: 3 } } });
  mocks.balances.mockResolvedValue(page([{ productId: 9, productName: 'شامبو', unit: 'ml', packageSize: '150.000', consumableQuantity: '300.000', sellableQuantity: 8 }]));
  mocks.services.mockResolvedValue(page([
    { id: 11, status: 'pending', queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
    { id: 12, status: 'pending', queueNumber: 2, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
  ]));
  mocks.complete.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ConsumablesView', () => {
  it('bulk-completes selected individual services with the same actual quantity', async () => {
    mount();
    const checks = await screen.findAllByRole('checkbox');
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    fireEvent.change(screen.getByLabelText('المستهلك 1'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('كمية المستهلك'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنهاء الخدمات المحددة' }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11, 12], usages: [{ productId: 9, quantity: '15' }],
    }));
    await waitFor(() => {
      expect(mocks.balances).toHaveBeenCalledTimes(2);
      expect(mocks.services).toHaveBeenCalledTimes(2);
    });
  });
});
