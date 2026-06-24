import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace })
}));

import { SignInForm } from "@/features/auth/components/sign-in-form";

afterEach(() => {
  replace.mockReset();
});

const employeeActor = { id: 1, role: "employee", name: "موظف", phone: "01012345678" };

describe("SignInForm", () => {
  it("shows a validation error and does not submit when the password is too short", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm />);

    await user.type(screen.getByLabelText("رقم الهاتف"), "01012345678");
    await user.type(screen.getByLabelText("كلمة المرور"), "short");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    expect(await screen.findByText("كلمة المرور يجب ألا تقل عن 8 أحرف")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("signs in and routes to the employee home on valid submit", async () => {
    server.use(
      http.post(apiUrl("/auth/sign-in"), () => HttpResponse.json({ actor: employeeActor }))
    );
    const user = userEvent.setup();
    renderWithProviders(<SignInForm />);

    await user.type(screen.getByLabelText("رقم الهاتف"), "01012345678");
    await user.type(screen.getByLabelText("كلمة المرور"), "secret12");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/attendance"));
  });
});
