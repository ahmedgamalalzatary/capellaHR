import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  balances: vi.fn(), services: vi.fn(), status: vi.fn(), record: vi.fn(), session: vi.fn(),
  branches: vi.fn(), products: vi.fn(),
}));
vi.mock('../src/features/consumables/api/consumables-api', () => ({
  listConsumableBalances: mocks.balances,
  listConsumableServices: mocks.services,
  updateServiceExecutionStatus: mocks.status,
  recordServiceConsumptions: mocks.record,
  configureConsumable: vi.fn(), transferConsumableStock: vi.fn(), correctServiceExecution: vi.fn(),
}));
vi.mock('../src/features/auth', () => ({ useSession: mocks.session }));
vi.mock('../src/features/catalog', () => ({ listCatalogBranches: mocks.branches }));
vi.mock('../src/features/products', () => ({ listAllProducts: mocks.products }));

import { ConsumablesView } from '../src/features/consumables/components/consumables-view';

const page = (items: unknown[], currentPage = 1, totalPages = 1) => ({ items, meta: { page: currentPage, pageSize: 100, total: items.length, totalPages } });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ConsumablesView /></QueryClientProvider>);

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  sessionStorage.clear();
  window.history.replaceState({}, '', '/consumables');
  mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'cashier', branchId: 3 } } });
  mocks.branches.mockResolvedValue(page([{ id: 3, name: 'الفرع الرئيسي' }]));
  mocks.products.mockResolvedValue(page([{ id: 9, name: 'شامبو' }]));
  mocks.balances.mockResolvedValue(page([{ productId: 9, productName: 'شامبو', unit: 'ml', packageSize: '150.000', consumableQuantity: '300.000', sellableQuantity: 8 }]));
  mocks.services.mockResolvedValue(page([
    { id: 11, status: 'pending', queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
    { id: 12, status: 'pending', queueNumber: 2, serviceName: 'قص شعر', invoiceNumber: 'INV-1', clientName: 'عميل', employeeName: 'موظف' },
  ]));
  mocks.status.mockResolvedValue([]);
  mocks.record.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ConsumablesView', () => {
  it('marks a sold service done without asking for consumables', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'تمت' }))[0]!);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11], status: 'completed',
    }));
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('shows the failure when a service status update is rejected', async () => {
    mocks.status.mockRejectedValueOnce(new Error('Status update rejected'));
    mount();

    fireEvent.click((await screen.findAllByRole('button', { name: 'تمت' }))[0]!);

    expect(await screen.findByText('Status update rejected')).toBeDefined();
  });

  it('opens product consumable links on the stock tab with the product selected', async () => {
    window.history.replaceState({}, '', '/consumables?productId=9&branchId=3');
    mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'admin' } } });
    mount();
    const stockTab = await screen.findByRole('tab', { name: 'مخزون المستهلكات' });
    expect(stockTab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect((screen.getByLabelText('منتج إعداد المستهلك') as HTMLSelectElement).value).toBe('9'));
  });
  it('opens on service status and exposes separate consumables and stock tabs', async () => {
    mount();
    await screen.findAllByText('INV-1');
    expect(mocks.services).toHaveBeenCalledWith(expect.objectContaining({ status: 'operational' }));
    expect(screen.getByRole('tab', { name: 'حالة الخدمات' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'تسجيل المستهلكات' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'مخزون المستهلكات' })).toBeDefined();
  });

  it('requires an explicit no-consumables choice before recording no usage', async () => {
    mocks.services.mockResolvedValue(page([{ id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1' }]));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    const completeButton = screen.getByRole('button', { name: 'حفظ المستهلكات' });
    expect(completeButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'لم تُستخدم مستهلكات' }));
    expect(completeButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(completeButton);
    await waitFor(() => expect(mocks.record).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11], usages: [], noConsumablesConfirmed: true,
    }));
  });

  it('records selected completed services with the same actual quantity', async () => {
    mocks.services.mockResolvedValue(page([
      { id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' },
      { id: 12, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 2, serviceName: 'One', invoiceNumber: 'INV-2' },
    ]));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    const checks = await screen.findAllByRole('checkbox');
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    fireEvent.change(screen.getByLabelText('المستهلك 1'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('كمية المستهلك'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المستهلكات' }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledWith({
      serviceQueueEntryIds: [11, 12], usages: [{ productId: 9, quantity: '15' }], noConsumablesConfirmed: false,
    }));
    await waitFor(() => {
      expect(mocks.balances).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
      expect(mocks.balances).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
      expect(mocks.services.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByLabelText('المستهلك 1')).toBeNull();
    expect(screen.queryByLabelText('كمية المستهلك')).toBeNull();
  });

  it('shows completed services with their consumables state', async () => {
    mocks.services.mockResolvedValue(page([{
      id: 21, status: 'completed', queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-2',
      clientName: 'عميل', employeeName: 'موظف', completedAt: '2026-09-05T12:00:00.000Z', consumptionRecorded: true,
    }]));
    mount();
    await screen.findByText('INV-2');
    fireEvent.click(screen.getByRole('tab', { name: 'تسجيل المستهلكات' }));
    await waitFor(() => expect(mocks.services).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' })));
    expect(await screen.findByText('مسجلة')).toBeDefined();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('lets cashiers inspect consumable stock without exposing admin stock controls', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'مخزون المستهلكات' }));
    await screen.findAllByText('شامبو');
    expect(screen.queryByRole('button', { name: 'حفظ الإعداد' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تنفيذ التحويل' })).toBeNull();
  });

  it('paginates services and consumable stock independently', async () => {
    mocks.services.mockResolvedValue(page([{ id: 11, status: 'pending', queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' }], 1, 2));
    mocks.balances.mockResolvedValue(page([{ productId: 9, productName: 'A', unit: 'ml', packageSize: '1.000', consumableQuantity: '1.000', sellableQuantity: 1 }], 1, 2));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'الصفحة 2' }));
    await waitFor(() => expect(mocks.services).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 })));

    fireEvent.click(screen.getByRole('tab', { name: 'مخزون المستهلكات' }));
    fireEvent.click(await screen.findByRole('button', { name: 'الصفحة 2' }));
    await waitFor(() => expect(mocks.balances).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 })));
  });

  it('blocks incomplete usage rows and mixed-service selections', async () => {
    mocks.services.mockResolvedValue(page([
      { id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' },
      { id: 12, serviceId: 6, status: 'completed', consumptionRecorded: false, queueNumber: 2, serviceName: 'Two', invoiceNumber: 'INV-2' },
    ]));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    const checks = await screen.findAllByRole('checkbox');
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    expect((checks[1] as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getAllByRole('combobox').at(-1)!, { target: { value: '9' } });
    fireEvent.click(screen.getAllByRole('button').at(-1)!);
    await waitFor(() => expect(mocks.record).not.toHaveBeenCalled());
  });

  it('opens the consumables completion panel in a dialog instead of inline', async () => {
    mocks.services.mockResolvedValue(page([
      { id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1' },
    ]));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'تسجيل مستهلكات 1 خدمة' });
    expect(dialog).toBeDefined();
  });

  it('loads complete balance options separately from the paginated stock table', async () => {
    const firstBalance = { productId: 9, productName: 'صفحة واحدة', unit: 'ml', packageSize: '1.000', consumableQuantity: '1.000', sellableQuantity: 1 };
    const secondBalance = { productId: 10, productName: 'صفحة ثانية', unit: 'ml', packageSize: '1.000', consumableQuantity: '2.000', sellableQuantity: 1 };
    mocks.balances.mockImplementation(async ({ page: pageNumber = 1, pageSize = 20 }: { page?: number; pageSize?: number }) => (
      pageSize === 100
        ? page(pageNumber === 1 ? [firstBalance] : [secondBalance], pageNumber, 2)
        : page([firstBalance], pageNumber, 2)
    ));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    mocks.services.mockResolvedValue(page([{ id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' }]));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);

    const options = within(await screen.findByLabelText('المستهلك 1')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(expect.arrayContaining(['صفحة واحدة (1.000 ml)', 'صفحة ثانية (2.000 ml)']));
    expect(mocks.balances).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
    expect(mocks.balances).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
  });

  it('lets an admin pick a different service after changing branch', async () => {
    mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'admin' } } });
    sessionStorage.setItem('capella:pos-admin-branch', '3');
    mocks.branches.mockResolvedValue(page([
      { id: 3, name: 'الفرع الرئيسي' },
      { id: 4, name: 'فرع آخر' },
    ]));
    mocks.services.mockImplementation(async ({ branchId }: { branchId?: number }) => (
      branchId === 4
        ? page([{
          id: 21, serviceId: 9, status: 'completed', consumptionRecorded: false,
          queueNumber: 1, serviceName: 'Other', invoiceNumber: 'INV-4',
        }])
        : page([{
          id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false,
          queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1',
        }])
    ));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    expect(screen.getByRole('dialog', { name: /تسجيل مستهلكات/ })).toBeDefined();

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '4' } });
    await screen.findByText('INV-4');
    const nextBranchCheckbox = (await screen.findAllByRole('checkbox'))[0]!;
    fireEvent.click(nextBranchCheckbox);

    expect((nextBranchCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a selected service scoped to one service across pages', async () => {
    mocks.services
      .mockResolvedValueOnce(page([{ id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'One', invoiceNumber: 'INV-1' }], 1, 2))
      .mockResolvedValue(page([{ id: 12, serviceId: 6, status: 'completed', consumptionRecorded: false, queueNumber: 2, serviceName: 'Two', invoiceNumber: 'INV-2' }], 2, 2));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'الصفحة 2' }));
    const secondPageCheckbox = (await screen.findAllByRole('checkbox'))[0]!;
    fireEvent.click(secondPageCheckbox);

    expect((secondPageCheckbox as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('dialog', { name: /تسجيل مستهلكات/ })).toBeNull();
  });

  it('opens the product actions on every stock tab', async () => {
    mocks.session.mockReturnValue({ isSuccess: true, data: { actor: { type: 'admin' } } });
    sessionStorage.setItem('capella:pos-admin-branch', '3');
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'مخزون المستهلكات' }));
    await screen.findByText('أرصدة المستهلكات');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('منتج إعداد المستهلك')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعداد منتج كمستهلك' }));
    const dialog = await screen.findByRole('dialog', { name: 'إعداد منتج كمستهلك' });
    expect(dialog).toBeDefined();
  });

  it('ignores generic close requests while consumables are being recorded', async () => {
    mocks.services.mockResolvedValue(page([
      { id: 11, serviceId: 5, status: 'completed', consumptionRecorded: false, queueNumber: 1, serviceName: 'قص شعر', invoiceNumber: 'INV-1' },
    ]));
    mocks.record.mockReturnValue(new Promise(() => undefined));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'تسجيل المستهلكات' }));
    fireEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'لم تُستخدم مستهلكات' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المستهلكات' }));
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'تسجيل مستهلكات 1 خدمة' })).toBeDefined();
  });
});
