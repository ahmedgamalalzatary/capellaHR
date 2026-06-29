import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { EmployeeDeviceSetupForm } from "@/features/employees/components/employee-device-setup-form";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

describe("EmployeeDeviceSetupForm", () => {
  it("submits browser fingerprint and optional device label", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("CapellaTest/1.0");
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/employee-device-setup/token-1/complete"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          employeeDevice: {
            employeeId: 1,
            activeDevice: {
              id: 12,
              deviceLabel: "هاتف أحمد",
              browserFingerprint: "fp",
              registeredAt: "2026-06-29T21:00:00.000Z"
            },
            pendingSetup: null
          }
        });
      })
    );

    renderWithProviders(<EmployeeDeviceSetupForm deviceToken="token-1" />);

    await userEvent.setup().type(screen.getByLabelText("اسم الجهاز"), "هاتف أحمد");
    await userEvent.setup().click(screen.getByRole("button", { name: "تفعيل هذا الجهاز" }));

    await waitFor(() =>
      expect(receivedBody).toMatchObject({
        deviceLabel: "هاتف أحمد",
        browserFingerprint: expect.stringContaining("CapellaTest/1.0")
      })
    );
    expect(await screen.findByText("تم تفعيل الجهاز")).toBeInTheDocument();
  });

  it("shows an expired-link state from the API", async () => {
    server.use(
      http.post(apiUrl("/employee-device-setup/expired/complete"), () =>
        HttpResponse.json(
          { error: { code: "EMPLOYEE_DEVICE_SETUP_EXPIRED", message: "expired" } },
          { status: 410 }
        )
      )
    );

    renderWithProviders(<EmployeeDeviceSetupForm deviceToken="expired" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "تفعيل هذا الجهاز" }));

    expect(await screen.findByText("انتهت صلاحية رابط الإعداد")).toBeInTheDocument();
  });
});
