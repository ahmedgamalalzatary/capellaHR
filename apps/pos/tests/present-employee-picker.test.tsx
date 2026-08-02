import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listAssignableEmployees: vi.fn() }));

vi.mock('../src/features/employee-assignment/api/assignable-employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAssignableEmployees: mocks.listAssignableEmployees,
}));

import { ApiError } from '../src/lib/api/client';
import {
  PresentEmployeePicker,
  type AssignableEmployee,
} from '../src/features/employee-assignment';

const nada: AssignableEmployee = { id: 7, employeeCode: 42, fullName: 'ندى سمير', branchId: 1 };
const heba: AssignableEmployee = { id: 8, employeeCode: 43, fullName: 'هبة علي', branchId: 1 };

function renderPicker(
  selected: AssignableEmployee | null = null,
  onSelect = vi.fn(),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PresentEmployeePicker selected={selected} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return onSelect;
}

beforeEach(() => {
  mocks.listAssignableEmployees.mockResolvedValue([nada, heba]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PresentEmployeePicker', () => {
  test('lists the employees currently checked in at the branch', async () => {
    renderPicker();

    expect(await screen.findByRole('button', { name: /ندى سمير/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /هبة علي/ })).toBeDefined();
  });

  test('assigns the invoice to the chosen present employee', async () => {
    const onSelect = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /ندى سمير/ }));

    expect(onSelect).toHaveBeenCalledWith(nada);
  });

  test('states that an absent employee must check in, offering no override', async () => {
    mocks.listAssignableEmployees.mockResolvedValue([]);
    renderPicker();

    expect(await screen.findByText('لا يوجد موظف مسجل حضورًا في الفرع الآن')).toBeDefined();
    expect(screen.getByText('لا يمكن إسناد الفاتورة إلا لموظف مسجل حضوره، سجّل حضوره أولًا.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /تجاوز|إسناد رغم/ })).toBeNull();
  });

  test('refreshes the list on demand', async () => {
    renderPicker();
    await screen.findByRole('button', { name: /ندى سمير/ });
    mocks.listAssignableEmployees.mockResolvedValue([heba]);

    fireEvent.click(screen.getByRole('button', { name: 'تحديث' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /ندى سمير/ })).toBeNull());
    expect(screen.getByRole('button', { name: /هبة علي/ })).toBeDefined();
  });

  test('drops a selected employee who checked out and warns the cashier', async () => {
    mocks.listAssignableEmployees.mockResolvedValue([heba]);
    const onSelect = renderPicker(nada);

    expect(await screen.findByText('انصرف الموظف المحدد، اختر موظفًا مسجلًا حضوره الآن.')).toBeDefined();
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  test('keeps a selected employee who is still checked in', async () => {
    const onSelect = renderPicker(nada);

    expect(await screen.findByText('ندى سمير')).toBeDefined();
    await waitFor(() => expect(mocks.listAssignableEmployees).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText('انصرف الموظف المحدد، اختر موظفًا مسجلًا حضوره الآن.')).toBeNull();
  });

  test('offers a retry when presence cannot be read', async () => {
    mocks.listAssignableEmployees.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'تعذر تحميل الموظفين' }),
    );
    renderPicker();

    expect(await screen.findByText('تعذر تحميل الموظفين المسجلين حضورًا')).toBeDefined();
    mocks.listAssignableEmployees.mockResolvedValue([nada]);

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(await screen.findByRole('button', { name: /ندى سمير/ })).toBeDefined();
  });
});
