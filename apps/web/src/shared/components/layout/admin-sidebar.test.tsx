import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { isNavItemActive } from "@/shared/components/layout/admin-nav";
import { SidebarProvider } from "@/shared/components/ui/sidebar";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

const pathname = vi.fn(() => "/branches");
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ replace })
}));

import { AdminSidebar } from "@/shared/components/layout/admin-sidebar";

function renderSidebar() {
  return renderWithProviders(
    <SidebarProvider>
      <AdminSidebar />
    </SidebarProvider>
  );
}

describe("isNavItemActive", () => {
  it("matches the exact route", () => {
    expect(isNavItemActive("/branches", "/branches")).toBe(true);
  });

  it("matches nested routes of a section", () => {
    expect(isNavItemActive("/branches/3", "/branches")).toBe(true);
  });

  it("does not match an unrelated route", () => {
    expect(isNavItemActive("/employees", "/branches")).toBe(false);
  });

  it("does not treat a prefix of another segment as active", () => {
    expect(isNavItemActive("/branches-archive", "/branches")).toBe(false);
  });
});

describe("AdminSidebar", () => {
  it("renders a link for every nav item", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /الفروع/ })).toHaveAttribute("href", "/branches");
    expect(screen.getByRole("link", { name: /الموظفون/ })).toHaveAttribute("href", "/employees");
    expect(screen.getByRole("link", { name: /التقارير/ })).toHaveAttribute("href", "/admin/reports");
    expect(screen.getByRole("link", { name: /سجل التدقيق/ })).toHaveAttribute("href", "/admin/audit-logs");
    expect(screen.getByRole("link", { name: /أقفال الشهور/ })).toHaveAttribute("href", "/admin/month-locks");
  });

  it("marks the active section's link as current", () => {
    pathname.mockReturnValue("/branches/3");
    renderSidebar();

    expect(screen.getByRole("link", { name: /الفروع/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).not.toHaveAttribute("aria-current");
  });

  it("signs out and routes to the admin sign-in from the footer button", async () => {
    server.use(http.post(apiUrl("/auth/sign-out"), () => new HttpResponse(null, { status: 204 })));
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "تسجيل الخروج" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/sign-in"));
  });
});
