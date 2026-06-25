import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { EmployeeList } from "@/features/employees/components/employee-list";

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
  softDeletedAt: null
};
const branch = {
  id: 2,
  name: "فرع المعادي",
  address: "المعادي",
  gpsLatitude: "29.9",
  gpsLongitude: "31.2",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "completed"
};

function mockBranches() {
  server.use(
    http.get(apiUrl("/branches"), () =>
      HttpResponse.json({
        branches: { items: [branch], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }
      })
    )
  );
}

function mockEmployees(
  items: unknown[],
  pagination = { page: 1, pageSize: 20, total: items.length, totalPages: 1 }
) {
  server.use(
    http.get(apiUrl("/employees"), () => HttpResponse.json({ employees: { items, pagination } }))
  );
}

describe("EmployeeList", () => {
  it("renders employee rows with branch name, status, and an edit link", async () => {
    mockEmployees([employee]);
    mockBranches();

    renderWithProviders(<EmployeeList filters={{ page: 1 }} onPageChange={vi.fn()} />);

    expect(await screen.findByText("أحمد جمال")).toBeInTheDocument();
    expect(screen.getByText("01012345678")).toBeInTheDocument();
    expect(await screen.findByText("فرع المعادي")).toBeInTheDocument();
    expect(screen.getByText("نشط")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تعديل" })).toHaveAttribute("href", "/employees/1");
  });

  it("marks a soft-deleted employee with the 'محذوف' status", async () => {
    mockEmployees([{ ...employee, softDeletedAt: "2026-06-01T00:00:00.000Z" }]);
    mockBranches();

    renderWithProviders(<EmployeeList filters={{ page: 1 }} onPageChange={vi.fn()} />);

    expect(await screen.findByText("محذوف")).toBeInTheDocument();
  });

  it("shows an empty state when there are no employees", async () => {
    mockEmployees([], { page: 1, pageSize: 20, total: 0, totalPages: 0 });
    mockBranches();

    renderWithProviders(<EmployeeList filters={{ page: 1 }} onPageChange={vi.fn()} />);

    expect(await screen.findByText("لا يوجد موظفون")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    server.use(
      http.get(apiUrl("/employees"), () =>
        HttpResponse.json({ error: { code: "SERVER_ERROR", message: "x" } }, { status: 500 })
      )
    );
    mockBranches();

    renderWithProviders(<EmployeeList filters={{ page: 1 }} onPageChange={vi.fn()} />);

    expect(await screen.findByText("تعذّر تحميل الموظفين")).toBeInTheDocument();
  });

  it("requests the next page through onPageChange", async () => {
    mockEmployees([employee], { page: 1, pageSize: 20, total: 40, totalPages: 2 });
    mockBranches();
    const onPageChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<EmployeeList filters={{ page: 1 }} onPageChange={onPageChange} />);

    await screen.findByText("أحمد جمال");
    await user.click(screen.getByRole("button", { name: "الصفحة التالية" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
