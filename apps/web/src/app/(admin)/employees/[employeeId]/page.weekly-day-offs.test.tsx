"use client";

import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "@/test/utils";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ employeeId: "1" }),
  useRouter: () => ({ push })
}));

vi.mock("@/features/branches/branches.hooks", () => ({
  useAllBranches: () => ({
    data: { branches: [{ id: 7, name: "فرع مدينة نصر" }] }
  })
}));

vi.mock("@/features/employees/employees.hooks", () => ({
  useDeleteEmployee: () => ({ isPending: false, mutate: vi.fn() }),
  useEmployee: () => ({
    data: {
      employee: {
        id: 1,
        fullName: "سارة محمود",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345678",
        email: null,
        branchId: 7,
        age: 29,
        address: "القاهرة",
        currentMonthlySalary: "8000.00",
        softDeletedAt: null
      }
    },
    isError: false,
    isPending: false
  }),
  useEmployeeWeeklyDayOffs: () => ({
    data: { assignments: [] },
    isError: false,
    isPending: false
  }),
  useCreateEmployeeWeeklyDayOff: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateEmployeeWeeklyDayOff: () => ({ isPending: false, mutate: vi.fn() })
}));

vi.mock("@/features/employees/components/employee-form", () => ({
  EmployeeForm: () => <div>employee-form</div>
}));

vi.mock("@/features/employees/components/employee-files-section", () => ({
  EmployeeFilesSection: () => <div>employee-files-section</div>
}));

vi.mock("@/features/employees/components/employee-device-section", () => ({
  EmployeeDeviceSection: () => <div>employee-device-section</div>
}));

vi.mock("@/features/employees/components/employee-branch-assignments-section", () => ({
  EmployeeBranchAssignmentsSection: () => <div>employee-branch-assignments-section</div>
}));

import EmployeeDetailPage from "@/app/(admin)/employees/[employeeId]/page";

describe("EmployeeDetailPage weekly day-offs", () => {
  it("shows the weekly day-offs section for active employees", () => {
    renderWithProviders(<EmployeeDetailPage />);

    expect(screen.getByRole("heading", { name: "أيام الراحة الأسبوعية" })).toBeInTheDocument();
  });
});
