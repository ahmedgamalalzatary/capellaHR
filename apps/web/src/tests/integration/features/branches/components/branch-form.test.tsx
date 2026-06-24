import { http, HttpResponse } from "msw";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { BranchForm } from "@/features/branches/components/branch-form";
import type { Branch } from "@/features/branches/branches.types";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

type PositionSuccess = (position: { coords: { latitude: number; longitude: number } }) => void;
type PositionError = (error: { code: number; message: string }) => void;

/** Install a `navigator.geolocation` stub that resolves or rejects on demand. */
function mockGeolocation(result: { coords?: { latitude: number; longitude: number }; denied?: boolean }) {
  const getCurrentPosition = vi.fn((success: PositionSuccess, error?: PositionError) => {
    if (result.denied) {
      error?.({ code: 1, message: "User denied Geolocation" });
      return;
    }
    success({ coords: result.coords! });
  });

  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true
  });

  return getCurrentPosition;
}

const branch: Branch = {
  id: 1,
  name: "فرع المعادي",
  address: "المعادي",
  gpsLatitude: "29.9602",
  gpsLongitude: "31.2569",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "setup_pending"
};

describe("BranchForm (create)", () => {
  it("shows a validation error and does not submit when the name is empty", async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BranchForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText("العنوان"), "المعادي");
    await user.type(screen.getByLabelText("خط العرض"), "29.9");
    await user.type(screen.getByLabelText("خط الطول"), "31.2");
    await user.type(screen.getByLabelText("نطاق الموقع (متر)"), "100");
    await user.type(screen.getByLabelText("نطاق الـ IP المسموح"), "196.221.0.0/16");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("اسم الفرع مطلوب")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("creates a branch and calls onSuccess on valid submit", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/branches"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ branch }, { status: 201 });
      })
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BranchForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText("اسم الفرع"), "فرع المعادي");
    await user.type(screen.getByLabelText("العنوان"), "المعادي");
    await user.type(screen.getByLabelText("خط العرض"), "29.9602");
    await user.type(screen.getByLabelText("خط الطول"), "31.2569");
    await user.type(screen.getByLabelText("نطاق الموقع (متر)"), "100");
    await user.type(screen.getByLabelText("نطاق الـ IP المسموح"), "196.221.0.0/16");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(receivedBody).toMatchObject({ name: "فرع المعادي", gpsRadiusMeters: 100 });
  });
});

describe("BranchForm (auto-detect)", () => {
  beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills GPS and a default radius when location detection succeeds", async () => {
    mockGeolocation({ coords: { latitude: 30.05, longitude: 31.25 } });
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الموقع" }));

    await waitFor(() => expect(screen.getByLabelText("خط العرض")).toHaveValue(30.05));
    expect(screen.getByLabelText("خط الطول")).toHaveValue(31.25);
    expect(screen.getByLabelText("نطاق الموقع (متر)")).toHaveValue(100);
    expect(toast.success).toHaveBeenCalled();
  });

  it("fills the IP as /32 when IP detection succeeds", async () => {
    server.use(http.get(apiUrl("/network/whoami"), () => HttpResponse.json({ ip: "203.0.113.7" })));
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الـ IP" }));

    await waitFor(() =>
      expect(screen.getByLabelText("نطاق الـ IP المسموح")).toHaveValue("203.0.113.7/32")
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("normalizes IPv4-mapped IPs before filling the CIDR field", async () => {
    server.use(
      http.get(apiUrl("/network/whoami"), () => HttpResponse.json({ ip: "::ffff:203.0.113.7" }))
    );
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الـ IP" }));

    await waitFor(() =>
      expect(screen.getByLabelText("نطاق الـ IP المسموح")).toHaveValue("203.0.113.7/32")
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("leaves the IP unchanged and shows an error toast when IP detection returns IPv6", async () => {
    server.use(http.get(apiUrl("/network/whoami"), () => HttpResponse.json({ ip: "::1" })));
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الـ IP" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText("نطاق الـ IP المسموح")).toHaveValue("");
  });

  it("shows an error toast when geolocation is denied", async () => {
    mockGeolocation({ denied: true });
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الموقع" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText("خط العرض")).toHaveValue(null);
  });

  it("stops loading and shows an error when geolocation never resolves", async () => {
    vi.useFakeTimers();
    try {
      const getCurrentPosition = vi.fn();
      Object.defineProperty(navigator, "geolocation", {
        value: { getCurrentPosition },
        configurable: true
      });
      renderWithProviders(<BranchForm />);

      fireEvent.click(screen.getByRole("button", { name: "كشف الموقع" }));
      expect(screen.getByRole("button", { name: "جارٍ كشف الموقع..." })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(toast.error).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "كشف الموقع" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  }, 15000);

  it("shows an error toast when the IP lookup fails", async () => {
    server.use(
      http.get(apiUrl("/network/whoami"), () =>
        HttpResponse.json(
          { error: { code: "INTERNAL", message: "boom", details: {} } },
          { status: 500 }
        )
      )
    );
    const user = userEvent.setup();
    renderWithProviders(<BranchForm />);

    await user.click(screen.getByRole("button", { name: "كشف الـ IP" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText("نطاق الـ IP المسموح")).toHaveValue("");
  });
});

describe("BranchForm (edit)", () => {
  it("pre-fills fields from the branch and PATCHes on submit", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(apiUrl("/branches/1"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ branch: { ...branch, name: "فرع محدث" } });
      })
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BranchForm branch={branch} onSuccess={onSuccess} />);

    const nameInput = screen.getByLabelText("اسم الفرع");
    expect(nameInput).toHaveValue("فرع المعادي");

    await user.clear(nameInput);
    await user.type(nameInput, "فرع محدث");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(receivedBody).toMatchObject({ name: "فرع محدث" });
  });
});
