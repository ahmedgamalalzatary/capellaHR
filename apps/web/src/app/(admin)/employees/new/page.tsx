"use client";

import { useRouter } from "next/navigation";

import { EmployeeForm } from "@/features/employees/components/employee-form";

export default function NewEmployeePage() {
  const router = useRouter();

  return (
    <main className="max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold">إضافة موظف</h1>
      <EmployeeForm onSuccess={(employee) => router.push(`/employees/${employee.id}`)} />
    </main>
  );
}
