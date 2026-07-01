"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { ConfirmDialog } from "@/shared/components/common/confirm-dialog";
import { useAllBranches } from "@/features/branches/branches.hooks";
import { useDeleteEmployee, useEmployee } from "@/features/employees/employees.hooks";
import { EMPLOYEE_STATUS_LABELS } from "@/features/employees/employees.labels";
import { EmployeeForm } from "@/features/employees/components/employee-form";
import { EmployeeProfileSummary } from "@/features/employees/components/employee-profile-summary";
import { EmployeeFilesSection } from "@/features/employees/components/employee-files-section";
import { EmployeeDeviceSection } from "@/features/employees/components/employee-device-section";
import { EmployeeBranchAssignmentsSection } from "@/features/employees/components/employee-branch-assignments-section";
import { EmployeeWeeklyDayOffsSection } from "@/features/employees/components/employee-weekly-day-offs-section";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ employeeId: string }>();
  const employeeId = Number(params.employeeId);
  const isValidId = Number.isInteger(employeeId) && employeeId > 0;

  const { data, isPending, isError } = useEmployee(isValidId ? employeeId : 1, isValidId);
  const branchesQuery = useAllBranches();
  const deleteEmployee = useDeleteEmployee();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isValidId) {
    return (
      <main className="space-y-6 p-4 sm:p-6 lg:p-8">
        <p className="text-destructive text-sm">معرّف الموظف غير صالح</p>
      </main>
    );
  }

  if (isPending) {
    return (
      <main className="space-y-6 p-4 sm:p-6 lg:p-8">
        <p className="text-muted-foreground text-sm">جارٍ التحميل...</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="space-y-6 p-4 sm:p-6 lg:p-8">
        <p className="text-destructive text-sm">تعذّر تحميل الموظف</p>
      </main>
    );
  }

  const employee = data.employee;
  const isDeleted = employee.softDeletedAt !== null;
  const branchName =
    (employee.branchId === null
      ? null
      : branchesQuery.data?.branches.find((branch) => branch.id === employee.branchId)?.name) ??
    "—";

  function handleDelete() {
    deleteEmployee.mutate(employee.id, {
      onSuccess: () => router.push("/employees")
    });
  }

  return (
    <main className="max-w-3xl space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{employee.fullName}</h1>
          <Badge variant={isDeleted ? "secondary" : "success"}>
            {EMPLOYEE_STATUS_LABELS[isDeleted ? "soft_deleted" : "active"]}
          </Badge>
        </div>
        {isDeleted ? null : (
          <Button type="button" variant="destructive" onClick={() => setConfirmOpen(true)}>
            حذف الموظف
          </Button>
        )}
      </div>

      <Section title="البيانات">
        {isDeleted ? (
          <EmployeeProfileSummary employee={employee} branchName={branchName} />
        ) : (
          <EmployeeForm employee={employee} />
        )}
      </Section>

      <Separator />

      <Section title="الملفات">
        <EmployeeFilesSection employeeId={employee.id} readOnly={isDeleted} />
      </Section>

      <Separator />

      <Section title="جهاز الحضور">
        <EmployeeDeviceSection employeeId={employee.id} readOnly={isDeleted} />
      </Section>

      <Separator />

      <Section title="الفروع">
        <EmployeeBranchAssignmentsSection employeeId={employee.id} readOnly={isDeleted} />
      </Section>

      <Separator />

      <Section title="أيام الراحة الأسبوعية">
        <EmployeeWeeklyDayOffsSection employeeId={employee.id} readOnly={isDeleted} />
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="حذف الموظف"
        description="سيتم نقل الموظف إلى المحذوفين. هل أنت متأكد؟"
        confirmLabel="حذف"
        destructive
        isConfirming={deleteEmployee.isPending}
        onConfirm={handleDelete}
      />
    </main>
  );
}
