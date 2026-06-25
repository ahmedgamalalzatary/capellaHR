import type { Employee } from "@/features/employees/employees.types";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/** Read-only view of an employee's details (used for soft-deleted employees). */
export function EmployeeProfileSummary({
  employee,
  branchName
}: {
  employee: Employee;
  branchName: string;
}) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="الاسم الكامل" value={employee.fullName} />
      <Field label="الفرع" value={branchName} />
      <Field label="رقم الهاتف" value={employee.primaryPhone} />
      <Field label="رقم واتساب" value={employee.whatsappPhone} />
      <Field label="البريد الإلكتروني" value={employee.email ?? "—"} />
      <Field label="العمر" value={String(employee.age)} />
      <Field label="الراتب الشهري" value={employee.currentMonthlySalary} />
      <Field label="العنوان" value={employee.address} />
    </dl>
  );
}
