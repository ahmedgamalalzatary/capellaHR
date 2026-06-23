import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace })
}));

import { RedirectAuthenticatedFromSignIn } from "@/features/auth/components/redirect-authenticated-from-sign-in";

const adminActor = { id: 1, role: "admin", name: "مدير", email: "admin.test@capella.invalid" };
const employeeActor = { id: 1, role: "employee", name: "موظف", phone: "01012345678" };

afterEach(() => {
  replace.mockReset();
});

describe("RedirectAuthenticatedFromSignIn", () => {
  it("redirects an authenticated admin to the admin dashboard", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: adminActor })));

    renderWithProviders(
      <RedirectAuthenticatedFromSignIn>
        <div>تسجيل الدخول</div>
      </RedirectAuthenticatedFromSignIn>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("تسجيل الدخول")).not.toBeInTheDocument();
  });

  it("redirects an authenticated employee to the employee home", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: employeeActor })));

    renderWithProviders(
      <RedirectAuthenticatedFromSignIn>
        <div>تسجيل الدخول</div>
      </RedirectAuthenticatedFromSignIn>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/attendance"));
    expect(screen.queryByText("تسجيل الدخول")).not.toBeInTheDocument();
  });

  it("renders the sign-in page for unauthenticated users", async () => {
    server.use(
      http.get(apiUrl("/auth/me"), () =>
        HttpResponse.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 })
      )
    );

    renderWithProviders(
      <RedirectAuthenticatedFromSignIn>
        <div>تسجيل الدخول</div>
      </RedirectAuthenticatedFromSignIn>
    );

    expect(await screen.findByText("تسجيل الدخول")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
