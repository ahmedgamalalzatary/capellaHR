import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  balances: vi.fn(), services: vi.fn(), complete: vi.fn(), session: vi.fn(),
  branches: vi.fn(), products: vi.fn(),
}));
vi.mock('../src/features/consumables/api/consumables-api', () => ({
  listConsumableBalances: mocks.balances,
  listConsumableServices: mocks.services,
  completeServiceExecutions: mocks.complete,
  configureConsumable: vi.fn(), transferConsumableStock: vi.fn(), correctServiceExecution: vi.fn(),
}));
vi.mock('../src/features/auth', () => ({ useSession: mocks.session }));
vi.mock('../src/features/catalog', () => ({ listCatalogBranches: mocks.branches }));
vi.mock('../src/features/products', () => ({ listAllProducts: mocks.products }));

import { ConsumablesView } from '../src/features/consumables/components/consumables-view';

const page = (items: unknown[], currentPage = 1, totalPages = 1) => ({ items, meta: { page: currentPage, pageSize: 100, total: items.length, totalPages } });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ConsumablesView /></QueryClientProvider>);

beforeEach(() => {
  window.history.replaceState({}, '', '/consumables');
  mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'cashier', branchId: 3 } } });
  mocks.branches.mockResolvedValue(page([{ id: 3, name: 'الفرع الرئيسي' }]));
  mocks.products.mockResolvedValue(page([{ id: 9, name: 'شامبو' }]));
  mocks.balances.mockResolvedValue(page([{ productId: 9, productName: 'شامبو', unit: 'ml', packageSize: '150.000', consumableQuantity: '300.000', sellableQuantity: 8 }]));
  mocks.services.mockResolvedValue(page([
    { id: 11, status: 'pending', queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
    { id: 12, status: 'pending', queueNumber: 2, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
  ]));
  mocks.complete.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ConsumablesView', () => {
  it('opens product consumable links on the stock tab with the product selected', async () => {
    window.history.replaceState({}, '', '/consumables?productId=9&branchId=3');
    mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'admin' } } });
    mount();
    const stockTab = await screen.findByRole('tab', { name: 'مخزون المستهلكات' });
    expect(stockTab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect((screen.getByLabelText('منتج إعداد المستهلك') as HTMLSelectElement).value).toBe('9'));
  });
  it('opens on unfinished customer services and exposes separate completed and stock tabs', async () => {
    mount();
    await screen.findAllByText('INV-1');
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ status: 'unfinished' }));
    expect(screen.getByRole('tab', { name: /الخدمات المعلقة/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'الخدمات المكتملة' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'مخزون المستهلكات' })).toBeDefined();
  });

  it('requires an explicit no-consumables choice before completing without usage', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    const completeButton = screen.getByRole('button', { name: 'إكمال الخدمات المحددة' });
    expect(completeButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'لم تُستخدم مستهلكات' }));
    expect(completeButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(completeButton);
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11], usages: [], noConsumablesConfirmed: true,
    }));
  });

  it('bulk-completes selected individual services with the same actual quantity', async () => {
    mount();
    const checks = await screen.findAllByRole('checkbox');
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    fireEvent.change(screen.getByLabelText('المستهلك 1'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('كمية المستهلك'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'إكمال الخدمات المحددة' }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11, 12], usages: [{ productId: 9, quantity: '15' }], noConsumablesConfirmed: false,
    }));
    await waitFor(() => {
      expect(mocks.balances).toHaveBeenCalledTimes(2);
      expect(mocks.services).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByLabelText('المستهلك 1')).toBeNull();
    expect(screen.queryByLabelText('كمية المستهلك')).toBeNull();
  });

  it('shows completed services without correction or completion actions', async () => {
    mocks.services.mockResolvedValue(page([{
      id: 21, status: 'completed', queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-2',
      clientName: 'عميل', employeeName: 'موظف', completedAt: '2026-09-05T12:00:00.000Z',
    }]));
    mount();
    await screen.findByText('INV-2');
    fireEvent.click(screen.getByRole('tab', { name: 'الخدمات المكتملة' }));
    await waitFor(() => expect(mocks.services).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' })));
    expect(screen.queryByRole('button', { name: /تصحيح|إكمال الخدمات/ })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('lets cashiers inspect consumable stock without exposing admin stock controls', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'مخزون المستهلكات' }));
    await screen.findAllByText('شامبو');
    expect(screen.queryByRole('button', { name: 'حفظ الإعداد' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تنفيذ التحويل' })).toBeNull();
  });

  it('loads every balance and service page', async () => {
    mocks.balances
      .mockResolvedValueOnce(page([{ productId: 9, productName: 'A', unit: 'ml', packageSize: '1.000', consumableQuantity: '1.000', sellableQuantity: 1 }], 1, 2))
      .mockResolvedValueOnce(page([{ productId: 10, productName: 'B', unit: 'gm', packageSize: '1.000', consumableQuantity: '1.000', sellableQuantity: 1 }], 2, 2));
    mocks.services
      .mockResolvedValueOnce(page([{ id: 11, serviceId: 5, status: 'pending', queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' }], 1, 2))
      .mockResolvedValueOnce(page([{ id: 12, serviceId: 5, status: 'pending', queueNumber: 2, serviceName: 'Two', invoiceNumber: 'INV-2' }], 2, 2));
    mount();
    await screen.findByText('INV-2');
    expect(mocks.balances).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 100 }));
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 100 }));
  });

  it('blocks incomplete usage rows and mixed-service selections', async () => {
    mocks.services.mockResolvedValue(page([
      { id: 11, serviceId: 5, status: 'pending', queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' },
      { id: 12, serviceId: 6, status: 'pending', queueNumber: 2, serviceName: 'Two', invoiceNumber: 'INV-2' },
    ]));
    mount();
    const checks = await screen.findAllByRole('checkbox');
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    expect((checks[1] as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getAllByRole('combobox').at(-1)!, { target: { value: '9' } });
    fireEvent.click(screen.getAllByRole('button').at(-1)!);
    await waitFor(() => expect(mocks.complete).not.toHaveBeenCalled());
  });
});
