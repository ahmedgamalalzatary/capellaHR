import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import AdminReportsPage from "@/app/(admin)/admin/reports/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/reports",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("AdminReportsPage", () => {
  it("renders monthly attendance summaries and totals for the selected month", async () => {
    const month = currentMonth();

    server.use(
      http.get(apiUrl("/reports/monthly-attendance-summary"), ({ request }) => {
        const url = new URL(request.url);

        expect(url.searchParams.get("month")).toBe(month);

        return HttpResponse.json({
          summaries: [
            {
              employeeId: 7,
              employeeName: "سارة محمود",
              branchId: 3,
              branchName: "فرع الزمالك",
              month,
              attendanceDays: 21,
              weeklyDaysOff: 8,
              absenceWithPermission: 1,
              absenceWithoutPermission: 1
            },
            {
              employeeId: 8,
              employeeName: "عمر علي",
              branchId: null,
              branchName: null,
              month,
              attendanceDays: 18,
              weeklyDaysOff: 8,
              absenceWithPermission: 2,
              absenceWithoutPermission: 3
            }
          ]
        });
      })
    );

    renderWithProviders(<AdminReportsPage />);

    expect(await screen.findByRole("heading", { name: "التقارير والتصدير" })).toBeInTheDocument();
    expect(await screen.findByText("سارة محمود")).toBeInTheDocument();
    expect(screen.getByText("عمر علي")).toBeInTheDocument();
    expect(screen.getByText("فرع الزمالك")).toBeInTheDocument();
    expect(screen.getByText("بدون فرع")).toBeInTheDocument();
    expect(screen.getByText("39")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("applies employee and branch filters to the summary request", async () => {
    const seenQueries: string[] = [];

    server.use(
      http.get(apiUrl("/reports/monthly-attendance-summary"), ({ request }) => {
        const url = new URL(request.url);
        seenQueries.push(url.search);

        return HttpResponse.json({ summaries: [] });
      })
    );

    renderWithProviders(<AdminReportsPage />);

    await screen.findByText("لا توجد بيانات لهذا الشهر.");
    await userEvent.setup().clear(screen.getByLabelText("رقم الموظف"));
    await userEvent.setup().type(screen.getByLabelText("رقم الموظف"), "7");
    await userEvent.setup().clear(screen.getByLabelText("رقم الفرع"));
    await userEvent.setup().type(screen.getByLabelText("رقم الفرع"), "3");
    await userEvent.setup().click(screen.getByRole("button", { name: "تطبيق الفلاتر" }));

    await waitFor(() =>
      expect(seenQueries.at(-1)).toContain("employeeId=7")
    );
    expect(seenQueries.at(-1)).toContain("branchId=3");
  });

  it("downloads the monthly summary PDF with the applied filters", async () => {
    const month = currentMonth();
    let exportUrl: string | null = null;
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    server.use(
      http.get(apiUrl("/reports/monthly-attendance-summary"), () =>
        HttpResponse.json({ summaries: [] })
      ),
      http.get(apiUrl("/reports/monthly-attendance-summary/export.pdf"), ({ request }) => {
        exportUrl = request.url;
        return new HttpResponse(new Blob(["pdf"], { type: "application/pdf" }), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="monthly-attendance-summary-${month}.pdf"`
          }
        });
      })
    );

    renderWithProviders(<AdminReportsPage />);

    await screen.findByText("لا توجد بيانات لهذا الشهر.");
    await userEvent.setup().type(screen.getByLabelText("رقم الموظف"), "7");
    await userEvent.setup().click(screen.getByRole("button", { name: "تطبيق الفلاتر" }));
    await waitFor(() => expect(screen.getByLabelText("رقم الموظف")).toHaveValue("7"));
    await userEvent.setup().clear(screen.getByLabelText("رقم الموظف"));
    await userEvent.setup().type(screen.getByLabelText("رقم الموظف"), "8");
    await userEvent.setup().click(screen.getByRole("button", { name: "تصدير ملخص الشهر PDF" }));

    await waitFor(() => expect(exportUrl).not.toBeNull());
    expect(exportUrl).toContain(`month=${month}`);
    expect(exportUrl).toContain("employeeId=7");
    expect(exportUrl).not.toContain("employeeId=8");
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:report");

    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("exports attendance and employees with applied filters and without page limits", async () => {
    const month = currentMonth();
    const exportUrls: string[] = [];
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    server.use(
      http.get(apiUrl("/reports/monthly-attendance-summary"), () =>
        HttpResponse.json({ summaries: [] })
      ),
      http.get(apiUrl("/reports/attendance/export.pdf"), ({ request }) => {
        exportUrls.push(request.url);
        return new HttpResponse(new Blob(["pdf"], { type: "application/pdf" }));
      }),
      http.get(apiUrl("/reports/employees/export.pdf"), ({ request }) => {
        exportUrls.push(request.url);
        return new HttpResponse(new Blob(["pdf"], { type: "application/pdf" }));
      })
    );

    renderWithProviders(<AdminReportsPage />);

    await screen.findByText("لا توجد بيانات لهذا الشهر.");
    await userEvent.setup().type(screen.getByLabelText("رقم الموظف"), "7");
    await userEvent.setup().type(screen.getByLabelText("رقم الفرع"), "3");
    await userEvent.setup().click(screen.getByRole("button", { name: "تطبيق الفلاتر" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "تصدير الحضور PDF" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "تصدير الموظفين PDF" }));

    await waitFor(() => expect(exportUrls).toHaveLength(2));
    for (const urlText of exportUrls) {
      const url = new URL(urlText);
      expect(url.searchParams.get("employeeId")).toBe("7");
      expect(url.searchParams.get("branchId")).toBe("3");
      expect(url.searchParams.get("page")).toBeNull();
      expect(url.searchParams.get("pageSize")).toBeNull();
    }
    expect(exportUrls[0]).toContain(`dateFrom=${month}-01`);

    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });
});
