import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace })
}));

import { AdminSignInForm } from "@/features/auth/components/admin-sign-in-form";

afterEach(() => {
  replace.mockReset();
});

const adminActor = { id: 1, role: "admin", name: "مدير", email: "admin.test@capella.invalid" };

describe("AdminSignInForm", () => {
  it("shows a validation error and does not submit on an invalid email", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminSignInForm />);

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "not-an-email");
    await user.type(screen.getByLabelText("كلمة المرور"), "secret12");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    expect(await screen.findByText("البريد الإلكتروني غير صحيح")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("signs in and routes to the admin dashboard on valid submit", async () => {
    server.use(
      http.post(apiUrl("/auth/admin/sign-in"), () => HttpResponse.json({ actor: adminActor }))
    );
    const user = userEvent.setup();
    renderWithProviders(<AdminSignInForm />);

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "admin.test@capella.invalid");
    await user.type(screen.getByLabelText("كلمة المرور"), "secret12");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});
