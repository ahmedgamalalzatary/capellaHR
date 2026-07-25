import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DeactivationDialog } from '../src/features/employees/components/deactivation-dialog';
import type { Employee, EmployeeDeactivationPreview } from '../src/features/employees/api/employees-api';

afterEach(cleanup);

const employee = { id: 1, fullName: 'أحمد' } as Employee;
const preview: EmployeeDeactivationPreview = {
  unpaidInstallmentCount: 3,
  unpaidAdvanceAmount: '3000.00',
  currentNetSalary: '2000.00',
  projectedNetSalary: '-1000.00',
  amountOwed: '1000.00',
  canZeroSalary: true,
  hasOpenSession: false,
};

const enabledCancels = () => screen.getAllByRole('button')
  .filter((button) => button.textContent?.startsWith('إلغاء'));

describe('DeactivationDialog', () => {
  test('disables cancelling at every stage while the deactivation is in flight', () => {
    const { rerender } = render(
      <DeactivationDialog
        employee={employee}
        preview={preview}
        pending
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Confirm stage: the only way forward is disabled, so the way out must be too.
    expect(enabledCancels().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    // Advancing needs a non-pending dialog, then pending is re-applied on the later stages.
    rerender(
      <DeactivationDialog
        employee={employee}
        preview={preview}
        pending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'متابعة' }));
    fireEvent.click(screen.getByRole('button', { name: 'تجميع الأقساط وخصمها من الراتب' }));
    expect(screen.getByRole('button', { name: 'تم استلام المبلغ نقدًا' })).toBeTruthy();

    rerender(
      <DeactivationDialog
        employee={employee}
        preview={preview}
        pending
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(enabledCancels().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});
