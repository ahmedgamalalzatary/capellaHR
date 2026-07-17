import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
  createEmployee: mocks.createEmployee,
  updateEmployee: mocks.updateEmployee,
  deleteEmployee: mocks.deleteEmployee,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { EmployeesView } from '../src/features/employees/components/employees-view';

const employee = {
  id: 1,
  employeeCode: 1001,
  fullName: 'أحمد جمال',
  personalPhone: '01012345678',
  whatsappPhone: '01112345678',
  age: 28,
  address: 'مدينة نصر، القاهرة',
  branchId: 3,
  shiftDurationMinutes: 480,
  monthlyBaseSalary: '6500.00',
  images: {
    personal: { originalName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
    idFront: { originalName: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
    idBack: { originalName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
  },
  deletedAt: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmployeesView />
    </QueryClientProvider>,
  );
}

const image = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

const setFile = (label: RegExp, file: File) => {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
};

beforeEach(() => {
  mocks.listEmployees.mockResolvedValue(pageOf([employee]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeesView', () => {
  test('lists employees with code, phone, and the branch name', async () => {
    renderView();
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
    expect(screen.getByText('1001')).toBeDefined();
    expect(screen.getByText('01012345678')).toBeDefined();
    const row = screen.getByText('أحمد جمال').closest('tr')!;
    await waitFor(() => expect(within(row).getByText('فرع القاهرة')).toBeDefined());
  });

  test('shows an Arabic empty state when there are no employees', async () => {
    mocks.listEmployees.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا يوجد موظفون بعد')).toBeDefined();
  });

  test('search resets to the first page and passes the term', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'منى' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'منى', page: 1 }),
      );
    });
  });

  test('filters by branch', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(await screen.findByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    await waitFor(() => {
      expect(mocks.listEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId: 3, page: 1 }),
      );
    });
  });

  test('creates an employee with normalized fields and the three images', async () => {
    mocks.createEmployee.mockResolvedValue({ ...employee, id: 2 });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة موظف' }));

    fireEvent.change(screen.getByLabelText(/الاسم الكامل/), { target: { value: 'منى علي' } });
    fireEvent.change(screen.getByLabelText(/الهاتف الشخصي/), { target: { value: '٠١٢ 1234 5678' } });
    fireEvent.change(screen.getByLabelText(/هاتف واتساب/), { target: { value: '01512345678' } });
    fireEvent.change(screen.getByLabelText(/الرقم السري/), { target: { value: '4321' } });
    fireEvent.change(screen.getByLabelText(/العمر/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'الإسكندرية' } });
    fireEvent.change(screen.getByLabelText(/^الفرع/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/مدة الوردية/), { target: { value: '480' } });
    fireEvent.change(screen.getByLabelText(/الراتب الأساسي/), { target: { value: '7000' } });
    setFile(/الصورة الشخصية/, image('personal.jpg'));
    setFile(/صورة البطاقة \(وجه\)/, image('front.jpg'));
    setFile(/صورة البطاقة \(ظهر\)/, image('back.jpg'));

    fireEvent.click(screen.getByRole('button', { name: 'حفظ الموظف' }));

    await waitFor(() => expect(mocks.createEmployee).toHaveBeenCalledTimes(1));
    const payload = mocks.createEmployee.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      fullName: 'منى علي',
      personalPhone: '01212345678',
      whatsappPhone: '01512345678',
      pin: '4321',
      age: 30,
      address: 'الإسكندرية',
      branchId: 3,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '7000',
    });
    expect(payload['personal']).toBeInstanceOf(File);
    expect(payload['idFront']).toBeInstanceOf(File);
    expect(payload['idBack']).toBeInstanceOf(File);
  });

  test('shows the Arabic server error when a phone already exists', async () => {
    mocks.createEmployee.mockRejectedValue(
      new ApiError(409, { code: 'EMPLOYEE_PHONE_EXISTS', message: 'رقم الهاتف مستخدم بالفعل' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة موظف' }));

    fireEvent.change(screen.getByLabelText(/الاسم الكامل/), { target: { value: 'منى علي' } });
    fireEvent.change(screen.getByLabelText(/الهاتف الشخصي/), { target: { value: '01212345678' } });
    fireEvent.change(screen.getByLabelText(/هاتف واتساب/), { target: { value: '01512345678' } });
    fireEvent.change(screen.getByLabelText(/الرقم السري/), { target: { value: '4321' } });
    fireEvent.change(screen.getByLabelText(/العمر/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'الإسكندرية' } });
    fireEvent.change(screen.getByLabelText(/^الفرع/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/مدة الوردية/), { target: { value: '480' } });
    fireEvent.change(screen.getByLabelText(/الراتب الأساسي/), { target: { value: '7000' } });
    setFile(/الصورة الشخصية/, image('personal.jpg'));
    setFile(/صورة البطاقة \(وجه\)/, image('front.jpg'));
    setFile(/صورة البطاقة \(ظهر\)/, image('back.jpg'));

    fireEvent.click(screen.getByRole('button', { name: 'حفظ الموظف' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'رقم الهاتف مستخدم بالفعل',
    );
  });

  test('edits an employee without requiring a new pin or images', async () => {
    mocks.updateEmployee.mockResolvedValue(employee);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));

    const nameInput = screen.getByLabelText(/الاسم الكامل/) as HTMLInputElement;
    expect(nameInput.value).toBe('أحمد جمال');
    fireEvent.change(nameInput, { target: { value: 'أحمد جمال الزتاري' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الموظف' }));

    await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalledTimes(1));
    expect(mocks.updateEmployee.mock.calls[0]?.[0]).toBe(1);
    expect(mocks.updateEmployee.mock.calls[0]?.[1]).toMatchObject({
      fullName: 'أحمد جمال الزتاري',
    });
    expect((mocks.updateEmployee.mock.calls[0]?.[1] as Record<string, unknown>)['pin']).toBeUndefined();
  });

  test('deletes only after confirmation and surfaces the checked-in error', async () => {
    mocks.deleteEmployee.mockRejectedValue(
      new ApiError(409, { code: 'EMPLOYEE_CHECKED_IN', message: 'يجب تسجيل خروج الموظف أولاً' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    expect(mocks.deleteEmployee).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.deleteEmployee).toHaveBeenCalledTimes(1));
    expect(mocks.deleteEmployee.mock.calls[0]?.[0]).toBe(1);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'يجب تسجيل خروج الموظف أولاً',
    );
  });

  test('paginates with the next button', async () => {
    mocks.listEmployees.mockResolvedValue(pageOf([employee], { total: 25, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      expect(mocks.listEmployees).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  test('retries loading after a failure', async () => {
    mocks.listEmployees.mockRejectedValueOnce(
      new ApiError(0, { code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' }),
    );
    renderView();
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
  });
});

describe('EmployeesView row details', () => {
  test('shows shift duration and salary in the table', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText(/480/)).toBeDefined();
    expect(within(row).getByText(/6500\.00/)).toBeDefined();
  });
});
