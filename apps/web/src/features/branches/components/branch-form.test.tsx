import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { BranchForm } from "@/features/branches/components/branch-form";
import type { Branch } from "@/features/branches/branches.types";

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
