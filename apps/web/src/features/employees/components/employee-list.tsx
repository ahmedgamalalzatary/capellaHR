"use client";

import Link from "next/link";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/components/ui/table";
import { useBranches } from "@/features/branches/branches.hooks";
import { useEmployees } from "@/features/employees/employees.hooks";
import { EMPLOYEE_STATUS_LABELS } from "@/features/employees/employees.labels";
import type { Employee, EmployeeListFilters } from "@/features/employees/employees.types";

type EmployeeListProps = {
  filters: EmployeeListFilters;
  onPageChange: (page: number) => void;
};

/** Admin table of employees for the current filters, with paging controls. */
export function EmployeeList({ filters, onPageChange }: EmployeeListProps) {
  const { data, isPending, isError } = useEmployees(filters);
  const branchesQuery = useBranches({ pageSize: 100 });

  const branchNameById = new Map(
    (branchesQuery.data?.branches.items ?? []).map((branch) => [branch.id, branch.name])
  );

  if (isPending) {
    return <p className="text-muted-foreground text-sm">جارٍ تحميل الموظفين...</p>;
  }

  if (isError) {
    return <p className="text-destructive text-sm">تعذّر تحميل الموظفين</p>;
  }

  const { items } = data.employees;
  const { pagination } = data.employees;

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">لا يوجد موظفون</p>;
  }

  const branchLabel = (employee: Employee) =>
    employee.branchId === null ? "—" : branchNameById.get(employee.branchId) ?? "—";

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>الفرع</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className="font-medium">{employee.fullName}</TableCell>
                <TableCell dir="ltr" className="text-start">
                  {employee.primaryPhone}
                </TableCell>
                <TableCell className="text-muted-foreground">{branchLabel(employee)}</TableCell>
                <TableCell>
                  <Badge variant={employee.softDeletedAt ? "secondary" : "success"}>
                    {EMPLOYEE_STATUS_LABELS[employee.softDeletedAt ? "soft_deleted" : "active"]}
                  </Badge>
                </TableCell>
                <TableCell className="text-left">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    تعديل
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1}
          >
            الصفحة السابقة
          </Button>
          <p className="text-muted-foreground text-sm">
            الصفحة {pagination.page} من {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            disabled={pagination.page >= pagination.totalPages}
          >
            الصفحة التالية
          </Button>
        </div>
      ) : null}
    </div>
  );
}
