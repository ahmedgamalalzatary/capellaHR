'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  employeeAssignmentQueryKeys,
  listAssignableEmployees,
  type AssignableEmployee,
} from '@/features/employee-assignment';

import { type Line } from './sale-primitives';

/**
 * Who performed one service. The default picker fills this for lines added after
 * it, and the counter overrides it here when two people share an invoice.
 */
export function LineEmployeeSelect({
  line,
  branchId,
  onSelect,
}: {
  line: Line;
  branchId?: number;
  onSelect: (employee: AssignableEmployee | null) => void;
}) {
  const present = useQuery({
    queryKey: employeeAssignmentQueryKeys.present(branchId),
    queryFn: () => listAssignableEmployees(branchId === undefined ? {} : { branchId }),
  });
  const options = present.data ?? [];
  /**
   * An employee who has since checked out is dropped from the line, not merely
   * hidden in the select: leaving them assigned would submit the id of someone
   * the screen shows as unchosen. Only a successful read can retire a choice, so
   * a valid assignment survives loading and failures untouched.
   */
  const staleSelection = present.isSuccess && line.employee !== null
    && line.employee !== undefined
    && !options.some(({ id }) => id === line.employee!.id);
  useEffect(() => {
    if (staleSelection) onSelect(null);
  }, [onSelect, staleSelection]);
  const selectedPresent = line.employee && options.some(({ id }) => id === line.employee!.id);
  return (
    <select
      aria-label={`موظف ${line.service.name}`}
      className="h-11 min-w-40 rounded-control border border-line bg-paper px-2 text-sm"
      value={selectedPresent ? String(line.employee!.id) : ''}
      onChange={(event) => onSelect(
        options.find(({ id }) => String(id) === event.target.value) ?? null,
      )}
    >
      <option value="">اختر الموظف</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.fullName}</option>
      ))}
    </select>
  );
}
