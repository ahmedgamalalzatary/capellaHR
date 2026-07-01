import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import EmployeeDetailPage from "@/app/(admin)/employees/[employeeId]/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

vi.mock("next/navigation", () => ({
  useParams: () => ({ employeeId: "1" }),
  useRouter: () => ({ push: vi.fn() })
}));

const employee = {
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
};

const branch = {
  id: 7,
  name: "فرع مدينة نصر",
  address: "مدينة نصر",
  gpsLatitude: "30.0",
  gpsLongitude: "31.3",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "completed"
};

function mockEmployeeDetailDependencies(overrides?: { softDeletedAt?: string | null }) {
  server.use(
    http.get(apiUrl("/employees/1"), () =>
      HttpResponse.json({
        employee: { ...employee, softDeletedAt: overrides?.softDeletedAt ?? null }
      })
    ),
    http.get(apiUrl("/branches"), () =>
      HttpResponse.json({
        branches: {
          items: [branch],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
        }
      })
    ),
    http.get(apiUrl("/employees/1/files"), () => HttpResponse.json({ files: [] })),
    http.get(apiUrl("/employees/1/device"), () =>
      HttpResponse.json({ employeeDevice: { employeeId: 1, activeDevice: null, pendingSetup: null } })
    ),
    http.get(apiUrl("/employees/1/branch-assignments"), () =>
      HttpResponse.json({ assignments: [] })
    ),
    http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
      HttpResponse.json({ assignments: [] })
    )
  );
}

describe("employee detail permission absences", () => {
  it("lists existing permission absences", async () => {
    mockEmployeeDetailDependencies();
    server.use(
      http.get(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json({
          absences: [
            {
              id: 8,
              employeeId: 1,
              absenceDate: "2026-07-05",
              permissionType: "generic",
              createdByAdminId: 1,
              updatedByAdminId: null
            }
          ]
        })
      )
    );

    renderWithProviders(<EmployeeDetailPage />);

    expect(await screen.findByRole("heading", { name: "غيابات بإذن" })).toBeInTheDocument();
    expect(await screen.findByText("2026-07-05")).toBeInTheDocument();
  });

  it("creates a permission absence for the employee", async () => {
    mockEmployeeDetailDependencies();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json({ absences: [] })
      ),
      http.post(apiUrl("/employees/1/permission-absences"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            absence: {
              id: 9,
              employeeId: 1,
              absenceDate: "2026-07-06",
              permissionType: "generic",
              createdByAdminId: 1,
              updatedByAdminId: null
            }
          },
          { status: 201 }
        );
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    await user.type(await screen.findByLabelText("تاريخ الغياب بإذن"), "2026-07-06");
    await user.click(screen.getByRole("button", { name: "إضافة غياب بإذن" }));

    await waitFor(() => expect(receivedBody).toEqual({ absenceDate: "2026-07-06" }));
  });

  it("updates an existing permission absence", async () => {
    mockEmployeeDetailDependencies();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json({
          absences: [
            {
              id: 8,
              employeeId: 1,
              absenceDate: "2026-07-05",
              permissionType: "generic",
              createdByAdminId: 1,
              updatedByAdminId: null
            }
          ]
        })
      ),
      http.patch(apiUrl("/permission-absences/8"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          absence: {
            id: 8,
            employeeId: 1,
            absenceDate: "2026-07-07",
            permissionType: "generic",
            createdByAdminId: 1,
            updatedByAdminId: 1
          }
        });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    const dateInput = await screen.findByLabelText("تعديل تاريخ الغياب بإذن 2026-07-05");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-07-07");
    await user.click(screen.getByRole("button", { name: "حفظ الغياب بإذن 2026-07-05" }));

    await waitFor(() => expect(receivedBody).toEqual({ absenceDate: "2026-07-07" }));
  });

  it("shows a specific message when permission absence conflicts with attendance", async () => {
    mockEmployeeDetailDependencies();
    server.use(
      http.get(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json({ absences: [] })
      ),
      http.post(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json(
          {
            error: {
              code: "PERMISSION_ABSENCE_ATTENDANCE_CONFLICT",
              message: "Permission absence conflicts with existing attendance",
              details: {}
            }
          },
          { status: 409 }
        )
      )
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    await user.type(await screen.findByLabelText("تاريخ الغياب بإذن"), "2026-07-06");
    await user.click(screen.getByRole("button", { name: "إضافة غياب بإذن" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "لا يمكن تسجيل غياب بإذن في يوم به حضور"
    );
  });

  it("hides mutation controls for soft-deleted employees", async () => {
    mockEmployeeDetailDependencies({ softDeletedAt: "2026-07-01T00:00:00.000Z" });
    server.use(
      http.get(apiUrl("/employees/1/permission-absences"), () =>
        HttpResponse.json({
          absences: [
            {
              id: 8,
              employeeId: 1,
              absenceDate: "2026-07-05",
              permissionType: "generic",
              createdByAdminId: 1,
              updatedByAdminId: null
            }
          ]
        })
      )
    );

    renderWithProviders(<EmployeeDetailPage />);

    expect(await screen.findByText("2026-07-05")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إضافة غياب بإذن" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "حفظ الغياب بإذن 2026-07-05" })
    ).not.toBeInTheDocument();
  });
});
