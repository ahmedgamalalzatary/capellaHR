'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@capella/ui';

import { PresentEmployeePicker, type AssignableEmployee } from '@/features/employee-assignment';

import { StepTitle, type Line } from './sale-primitives';

/** Step 4: the employee credited for any service line left unassigned. */
export function SaleDefaultEmployeeStep({
  branchId,
  employee,
  setEmployee,
  setLines,
}: {
  branchId?: number;
  employee: AssignableEmployee | null;
  setEmployee: (next: AssignableEmployee | null) => void;
  setLines: (update: (current: Line[]) => Line[]) => void;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle><StepTitle step={4} label="الموظف الافتراضي" /></CardTitle></CardHeader>
      <CardContent className="p-5">
        <p className="mb-3 text-[13px] text-muted">
          يُسند تلقائيًا للخدمات التي لم يُحدد لها موظف، ويمكن تغيير موظف كل خدمة من قائمتها.
        </p>
        <PresentEmployeePicker
          selected={employee}
          onSelect={(next) => {
            setEmployee(next);
            // Fills the services nobody has been assigned to yet; a line
            // the counter set by hand keeps its own employee.
            if (next) {
              setLines((current) => current.map((line) => (
                line.itemType !== 'product' && !line.employee
                  ? { ...line, employee: next }
                  : line
              )));
            }
          }}
          {...(branchId === undefined ? {} : { branchId })}
        />
      </CardContent>
    </Card>
  );
}
