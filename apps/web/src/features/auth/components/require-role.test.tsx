import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace })
}));

import { RequireRole } from "@/features/auth/components/require-role";

const adminActor = { id: 1, role: "admin", name: "مدير", email: "admin@capella.eg" };
const employeeActor = { id: 1, role: "employee", name: "موظف", phone: "01012345678" };

afterEach(() => {
  replace.mockReset();
});

describe("RequireRole", () => {
  it("redirects unauthenticated users to the matching sign-in page", async () => {
    server.use(
      http.get(apiUrl("/auth/me"), () =>
        HttpResponse.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 })
      )
    );

    renderWithProviders(
      <RequireRole role="admin">
        <div>محتوى</div>
      </RequireRole>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/sign-in"));
    expect(screen.queryByText("محتوى")).not.toBeInTheDocument();
  });

  it("redirects a wrong-role actor to their own home", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: employeeActor })));

    renderWithProviders(
      <RequireRole role="admin">
        <div>محتوى</div>
      </RequireRole>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/attendance"));
    expect(screen.queryByText("محتوى")).not.toBeInTheDocument();
  });

  it("renders children for an actor with the required role", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: adminActor })));

    renderWithProviders(
      <RequireRole role="admin">
        <div>محتوى</div>
      </RequireRole>
    );

    expect(await screen.findByText("محتوى")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
