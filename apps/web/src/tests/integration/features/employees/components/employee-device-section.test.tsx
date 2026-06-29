import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { EmployeeDeviceSection } from "@/features/employees/components/employee-device-section";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";

function mockDeviceState(state: unknown) {
  server.use(http.get(apiUrl("/employees/1/device"), () => HttpResponse.json({ employeeDevice: state })));
}

describe("EmployeeDeviceSection", () => {
  it("shows active device metadata", async () => {
    mockDeviceState({
      employeeId: 1,
      activeDevice: {
        id: 12,
        deviceLabel: "هاتف أحمد",
        browserFingerprint: "fingerprint-123456789",
        registeredAt: "2026-06-29T21:00:00.000Z"
      },
      pendingSetup: null
    });

    renderWithProviders(<EmployeeDeviceSection employeeId={1} />);

    expect(await screen.findByText("جهاز مفعل")).toBeInTheDocument();
    expect(screen.getByText("هاتف أحمد")).toBeInTheDocument();
    expect(screen.getByText(/fingerprint/)).toBeInTheDocument();
  });

  it("creates a setup link and displays the generated public URL", async () => {
    mockDeviceState({ employeeId: 1, activeDevice: null, pendingSetup: null });
    server.use(
      http.post(apiUrl("/employees/1/device/setup-links"), () =>
        HttpResponse.json(
          {
            employeeDevice: {
              employeeId: 1,
              activeDevice: null,
              pendingSetup: {
                id: 10,
                deviceToken: "token-1",
                deviceLabel: "هاتف أحمد",
                expiresAt: "2026-06-29T22:00:00.000Z"
              }
            }
          },
          { status: 201 }
        )
      ),
      http.get(apiUrl("/employees/1/device"), () =>
        HttpResponse.json({
          employeeDevice: {
            employeeId: 1,
            activeDevice: null,
            pendingSetup: {
              id: 10,
              deviceToken: "token-1",
              deviceLabel: "هاتف أحمد",
              expiresAt: "2026-06-29T22:00:00.000Z"
            }
          }
        })
      )
    );

    renderWithProviders(<EmployeeDeviceSection employeeId={1} />);

    await userEvent.setup().type(await screen.findByLabelText("اسم الجهاز"), "هاتف أحمد");
    await userEvent.setup().click(screen.getByRole("button", { name: "إنشاء رابط إعداد" }));

    expect(await screen.findByDisplayValue(/employee-device-setup\/token-1/)).toBeInTheDocument();
  });

  it("revokes device access", async () => {
    mockDeviceState({
      employeeId: 1,
      activeDevice: {
        id: 12,
        deviceLabel: "هاتف أحمد",
        browserFingerprint: "fingerprint-123",
        registeredAt: "2026-06-29T21:00:00.000Z"
      },
      pendingSetup: null
    });
    let revoked = false;
    server.use(
      http.delete(apiUrl("/employees/1/device"), () => {
        revoked = true;
        return HttpResponse.json({ success: true });
      })
    );

    renderWithProviders(<EmployeeDeviceSection employeeId={1} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "إلغاء تفعيل الجهاز" }));

    await waitFor(() => expect(revoked).toBe(true));
  });

  it("hides write actions in read-only mode", async () => {
    mockDeviceState({ employeeId: 1, activeDevice: null, pendingSetup: null });

    renderWithProviders(<EmployeeDeviceSection employeeId={1} readOnly />);

    await screen.findByText("لا يوجد جهاز مفعل");
    expect(screen.queryByLabelText("اسم الجهاز")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إنشاء رابط إعداد" })).not.toBeInTheDocument();
  });
});
