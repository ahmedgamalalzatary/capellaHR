"use client";

import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { usePaginationParams } from "@/shared/hooks/use-pagination-params";
import { EmployeeFilters } from "@/features/employees/components/employee-filters";
import { EmployeeList } from "@/features/employees/components/employee-list";
import { readEmployeeFilters } from "@/features/employees/read-employee-filters";

export default function EmployeesPage() {
  const { get, setParams } = usePaginationParams();
  const filters = readEmployeeFilters(get);

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">الموظفون</h1>
        <Button asChild>
          <Link href="/employees/new">إضافة موظف</Link>
        </Button>
      </div>

      <EmployeeFilters filters={filters} onChange={(updates) => setParams(updates)} />
      <EmployeeList filters={filters} onPageChange={(page) => setParams({ page })} />
    </main>
  );
}
