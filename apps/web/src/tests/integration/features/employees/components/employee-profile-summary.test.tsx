import { describe, expect, it } from "vitest";

import { renderWithProviders, screen } from "@/test/utils";

import { EmployeeProfileSummary } from "@/features/employees/components/employee-profile-summary";

const employee = {
  id: 1,
  fullName: "أحمد جمال",
  primaryPhone: "01012345678",
  whatsappPhone: "01112345678",
  email: null,
  branchId: 2,
  age: 30,
  address: "المعادي",
  currentMonthlySalary: "8000.00",
  softDeletedAt: "2026-06-01T00:00:00.000Z"
};

describe("EmployeeProfileSummary", () => {
  it("renders the employee's read-only details", () => {
    renderWithProviders(<EmployeeProfileSummary employee={employee} branchName="فرع المعادي" />);

    expect(screen.getByText("أحمد جمال")).toBeInTheDocument();
    expect(screen.getByText("01012345678")).toBeInTheDocument();
    expect(screen.getByText("المعادي")).toBeInTheDocument();
    expect(screen.getByText("فرع المعادي")).toBeInTheDocument();
  });

  it("shows a dash when the email is missing", () => {
    renderWithProviders(<EmployeeProfileSummary employee={employee} branchName="فرع المعادي" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
