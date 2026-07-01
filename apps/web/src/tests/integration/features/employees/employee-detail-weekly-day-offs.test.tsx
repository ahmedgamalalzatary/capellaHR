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

function mockEmployeeDetailDependencies() {
  server.use(
    http.get(apiUrl("/employees/1"), () => HttpResponse.json({ employee })),
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
    http.get(apiUrl("/employees/1/permission-absences"), () =>
      HttpResponse.json({ absences: [] })
    )
  );
}

describe("employee detail weekly day-offs", () => {
  it("lists existing weekly day-off assignments", async () => {
    mockEmployeeDetailDependencies();
    server.use(
      http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json({
          assignments: [
            {
              id: 4,
              employeeId: 1,
              weekStartDate: "2026-06-27",
              dayOffDate: "2026-06-29",
              overrideReason: null,
              assignedByAdminId: 1
            }
          ]
        })
      )
    );

    renderWithProviders(<EmployeeDetailPage />);

    expect(await screen.findByRole("heading", { name: "أيام الراحة الأسبوعية" })).toBeInTheDocument();
    expect(await screen.findByText("2026-06-29")).toBeInTheDocument();
  });

  it("creates a weekly day-off assignment for the employee", async () => {
    mockEmployeeDetailDependencies();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json({ assignments: [] })
      ),
      http.post(apiUrl("/employees/1/weekly-day-offs"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            assignment: {
              id: 5,
              employeeId: 1,
              weekStartDate: "2026-06-27",
              dayOffDate: "2026-07-01",
              overrideReason: "راحة إضافية",
              assignedByAdminId: 1
            }
          },
          { status: 201 }
        );
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    await user.type(await screen.findByLabelText("تاريخ الراحة"), "2026-07-01");
    await user.type(screen.getByLabelText("سبب التجاوز"), "راحة إضافية");
    await user.click(screen.getByRole("button", { name: "إضافة يوم راحة" }));

    await waitFor(() =>
      expect(receivedBody).toEqual({
        dayOffDate: "2026-07-01",
        overrideReason: "راحة إضافية"
      })
    );
  });

  it("updates an existing weekly day-off assignment", async () => {
    mockEmployeeDetailDependencies();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json({
          assignments: [
            {
              id: 4,
              employeeId: 1,
              weekStartDate: "2026-06-27",
              dayOffDate: "2026-06-29",
              overrideReason: null,
              assignedByAdminId: 1
            }
          ]
        })
      ),
      http.patch(apiUrl("/weekly-day-offs/4"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          assignment: {
            id: 4,
            employeeId: 1,
            weekStartDate: "2026-06-27",
            dayOffDate: "2026-07-02",
            overrideReason: "تعديل الراحة",
            assignedByAdminId: 1
          }
        });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    const dateInput = await screen.findByLabelText("تعديل تاريخ الراحة 2026-06-29");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-07-02");
    await user.type(screen.getByLabelText("سبب تعديل الراحة 2026-06-29"), "تعديل الراحة");
    await user.click(screen.getByRole("button", { name: "حفظ يوم الراحة 2026-06-29" }));

    await waitFor(() =>
      expect(receivedBody).toEqual({
        dayOffDate: "2026-07-02",
        overrideReason: "تعديل الراحة"
      })
    );
  });

  it("sends null to clear an existing weekly day-off override reason", async () => {
    mockEmployeeDetailDependencies();
    let receivedBody: unknown;
    server.use(
      http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json({
          assignments: [
            {
              id: 4,
              employeeId: 1,
              weekStartDate: "2026-06-27",
              dayOffDate: "2026-06-29",
              overrideReason: "تعديل سابق",
              assignedByAdminId: 1
            }
          ]
        })
      ),
      http.patch(apiUrl("/weekly-day-offs/4"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          assignment: {
            id: 4,
            employeeId: 1,
            weekStartDate: "2026-06-27",
            dayOffDate: "2026-06-29",
            overrideReason: null,
            assignedByAdminId: 1
          }
        });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    const reasonInput = await screen.findByLabelText("سبب تعديل الراحة 2026-06-29");
    await user.clear(reasonInput);
    await user.click(screen.getByRole("button", { name: "حفظ يوم الراحة 2026-06-29" }));

    await waitFor(() =>
      expect(receivedBody).toEqual({
        dayOffDate: "2026-06-29",
        overrideReason: null
      })
    );
  });

  it("shows a specific message when an override reason is required", async () => {
    mockEmployeeDetailDependencies();
    server.use(
      http.get(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json({ assignments: [] })
      ),
      http.post(apiUrl("/employees/1/weekly-day-offs"), () =>
        HttpResponse.json(
          {
            error: {
              code: "WEEKLY_DAY_OFF_OVERRIDE_REASON_REQUIRED",
              message: "Override reason is required",
              details: {}
            }
          },
          { status: 409 }
        )
      )
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailPage />);

    await user.type(await screen.findByLabelText("تاريخ الراحة"), "2026-07-01");
    await user.click(screen.getByRole("button", { name: "إضافة يوم راحة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "سبب التجاوز مطلوب عند تسجيل أكثر من يوم راحة في نفس الأسبوع"
    );
  });
});
