import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { EmployeeBranchAssignmentsSection } from "@/features/employees/components/employee-branch-assignments-section";

const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.hasPointerCapture = originalHasPointerCapture;
  Element.prototype.setPointerCapture = originalSetPointerCapture;
  Element.prototype.releasePointerCapture = originalReleasePointerCapture;
});

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

function mockBranches() {
  server.use(
    http.get(apiUrl("/branches"), () =>
      HttpResponse.json({
        branches: { items: [branch], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }
      })
    )
  );
}

function mockAssignments(assignments: unknown[]) {
  server.use(
    http.get(apiUrl("/employees/1/branch-assignments"), () =>
      HttpResponse.json({ assignments })
    )
  );
}

describe("EmployeeBranchAssignmentsSection", () => {
  it("lists assignment history with the branch name and an 'حالي' open marker", async () => {
    mockBranches();
    mockAssignments([
      {
        id: 3,
        employeeId: 1,
        branchId: 7,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
        assignedByAdminId: 1
      }
    ]);

    renderWithProviders(<EmployeeBranchAssignmentsSection employeeId={1} />);

    expect(await screen.findByText("فرع مدينة نصر")).toBeInTheDocument();
    expect(screen.getByText("حالي")).toBeInTheDocument();
  });

  it("hides the assignment form in read-only mode", async () => {
    mockBranches();
    mockAssignments([
      {
        id: 3,
        employeeId: 1,
        branchId: 7,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
        assignedByAdminId: 1
      }
    ]);

    renderWithProviders(<EmployeeBranchAssignmentsSection employeeId={1} readOnly />);

    expect(await screen.findByText("فرع مدينة نصر")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعيين" })).not.toBeInTheDocument();
  });

  it("creates a new assignment from the selected branch and date", async () => {
    mockBranches();
    mockAssignments([]);
    let body: Record<string, unknown> = {};
    server.use(
      http.post(apiUrl("/employees/1/branch-assignments"), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            assignment: {
              id: 4,
              employeeId: 1,
              branchId: 7,
              effectiveFrom: "2026-08-01T00:00:00.000Z",
              effectiveTo: null,
              assignedByAdminId: 1
            }
          },
          { status: 201 }
        );
      })
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeBranchAssignmentsSection employeeId={1} />);

    await user.click(await screen.findByRole("combobox", { name: "الفرع الجديد" }));
    await user.click(await screen.findByRole("option", { name: "فرع مدينة نصر" }));
    await user.type(screen.getByLabelText("تاريخ التعيين"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "تعيين" }));

    await waitFor(() => expect(body.branchId).toBe(7));
    expect(body.effectiveFrom).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rejects a past assignment date before submitting", async () => {
    mockBranches();
    mockAssignments([]);
    server.use(
      http.post(apiUrl("/employees/1/branch-assignments"), () =>
        HttpResponse.json(
          { error: { code: "EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE", message: "x", details: {} } },
          { status: 409 }
        )
      )
    );

    const user = userEvent.setup();
    renderWithProviders(<EmployeeBranchAssignmentsSection employeeId={1} />);

    await user.click(await screen.findByRole("combobox", { name: "الفرع الجديد" }));
    await user.click(await screen.findByRole("option", { name: "فرع مدينة نصر" }));
    await user.type(screen.getByLabelText("تاريخ التعيين"), "2020-01-01");
    await user.click(screen.getByRole("button", { name: "تعيين" }));

    expect(await screen.findByText("تاريخ التعيين يجب أن يكون اليوم أو في المستقبل")).toBeInTheDocument();
  });
});
