import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import AdminAuditLogsPage from "@/app/(admin)/admin/audit-logs/page";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/audit-logs",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

function auditLogsResponse(page = 1) {
  return {
    auditLogs: {
      items: [
        {
          id: 12,
          adminId: 3,
          actionType: "employee.update",
          entityType: "employee",
          entityId: "7",
          entityDisplayName: "سارة محمود",
          reason: "تصحيح بيانات الموظف",
          before: { status: page === 1 ? "active" : "pending" },
          after: { status: page === 1 ? "soft_deleted" : "active" },
          occurredAtUtc: "2026-06-30T10:15:00.000Z"
        }
      ],
      pagination: {
        page,
        pageSize: 20,
        total: 24,
        totalPages: 2
      }
    }
  };
}

describe("AdminAuditLogsPage", () => {
  it("renders audit logs with actor, action, entity, reason, and timestamp", async () => {
    server.use(
      http.get(apiUrl("/audit-logs"), ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("page")).toBe("1");
        expect(url.searchParams.get("pageSize")).toBe("20");

        return HttpResponse.json(auditLogsResponse());
      })
    );

    renderWithProviders(<AdminAuditLogsPage />);

    expect(await screen.findByRole("heading", { name: "سجل التدقيق" })).toBeInTheDocument();
    expect(await screen.findByText("مدير #3")).toBeInTheDocument();
    expect(screen.getByText("employee.update")).toBeInTheDocument();
    expect(screen.getByText("employee")).toBeInTheDocument();
    expect(screen.getByText("سارة محمود")).toBeInTheDocument();
    expect(screen.getByText("تصحيح بيانات الموظف")).toBeInTheDocument();
    expect(screen.getByText('{"status":"active"}').closest("td")).toHaveAttribute(
      "title",
      '{"status":"active"}'
    );
    expect(screen.getByText('{"status":"soft_deleted"}').closest("td")).toHaveAttribute(
      "title",
      '{"status":"soft_deleted"}'
    );
    expect(screen.getByText("الصفحة 1 من 2")).toBeInTheDocument();
  });

  it("applies supported audit-log filters and keeps previous rows visible while paginating", async () => {
    const seenQueries: string[] = [];

    server.use(
      http.get(apiUrl("/audit-logs"), async ({ request }) => {
        const url = new URL(request.url);
        seenQueries.push(url.search);

        if (url.searchParams.get("page") === "2") {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return HttpResponse.json(auditLogsResponse(Number(url.searchParams.get("page") ?? 1)));
      })
    );

    renderWithProviders(<AdminAuditLogsPage />);

    await screen.findByText("سارة محمود");
    await userEvent.setup().type(screen.getByLabelText("بحث"), "سارة");
    await userEvent.setup().type(screen.getByLabelText("نوع الكيان"), "employee");
    await userEvent.setup().type(screen.getByLabelText("نوع الإجراء"), "employee.update");
    await userEvent.setup().type(screen.getByLabelText("من تاريخ"), "2026-06-01");
    await userEvent.setup().type(screen.getByLabelText("إلى تاريخ"), "2026-06-30");
    await userEvent.setup().click(screen.getByRole("button", { name: "تطبيق الفلاتر" }));

    await waitFor(() => expect(seenQueries.at(-1)).toContain("search=%D8%B3%D8%A7%D8%B1%D8%A9"));
    expect(seenQueries.at(-1)).toContain("entityType=employee");
    expect(seenQueries.at(-1)).toContain("actionType=employee.update");
    expect(seenQueries.at(-1)).toContain("dateFrom=2026-06-01");
    expect(seenQueries.at(-1)).toContain("dateTo=2026-06-30");

    await userEvent.setup().click(screen.getByRole("button", { name: "الصفحة التالية" }));

    expect(screen.getByText('{"status":"active"}')).toBeInTheDocument();
    expect(screen.queryByText("جارٍ تحميل سجل التدقيق...")).not.toBeInTheDocument();

    await waitFor(() => expect(seenQueries.at(-1)).toContain("page=2"));
    expect(await screen.findByText('{"status":"pending"}')).toBeInTheDocument();
    expect(seenQueries.at(-1)).toContain("entityType=employee");
  });
});
