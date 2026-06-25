import { http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { EmployeeForm } from "@/features/employees/components/employee-form";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  // Patch only the object-URL helpers; keep the URL constructor intact (MSW uses it).
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  server.use(
    http.get(apiUrl("/branches"), () =>
      HttpResponse.json({
        branches: {
          items: [
            {
              id: 2,
              name: "فرع المعادي",
              address: "المعادي",
              gpsLatitude: "29.9",
              gpsLongitude: "31.2",
              gpsRadiusMeters: 100,
              allowedIpCidr: "196.221.0.0/16",
              registeredDeviceToken: null,
              setupStatus: "completed"
            }
          ],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
        }
      })
    )
  );
});
afterEach(() => vi.unstubAllGlobals());
afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

const employee = {
  id: 1,
  fullName: "أحمد جمال",
  primaryPhone: "01012345678",
  whatsappPhone: "01112345678",
  email: "ahmed@capella.eg",
  branchId: 2,
  age: 30,
  address: "المعادي",
  currentMonthlySalary: "8000.00",
  softDeletedAt: null
};

const image = () => new File(["x"], "img.png", { type: "image/png" });

async function fillCreateForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("الاسم الكامل"), "أحمد جمال");
  await user.type(screen.getByLabelText("كلمة المرور"), "secret12");
  await user.type(screen.getByLabelText("رقم الهاتف"), "01012345678");
  await user.type(screen.getByLabelText("رقم واتساب"), "01112345678");
  await user.type(screen.getByLabelText("العمر"), "30");
  await user.type(screen.getByLabelText("العنوان"), "المعادي");
  await user.type(screen.getByLabelText("الراتب الشهري"), "8000");
  await user.click(screen.getByRole("combobox", { name: "الفرع" }));
  await user.click(await screen.findByRole("option", { name: "فرع المعادي" }));
  await user.upload(screen.getByLabelText("الصورة الشخصية"), image());
  await user.upload(screen.getByLabelText("صورة الهوية (أمامي)"), image());
  await user.upload(screen.getByLabelText("صورة الهوية (خلفي)"), image());
  return user;
}

describe("EmployeeForm — create", () => {
  it("shows a validation error when submitting empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmployeeForm />);

    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("الاسم الكامل مطلوب")).toBeInTheDocument();
  });

  it("creates an employee and calls onSuccess", async () => {
    let posted = false;
    server.use(
      http.post(apiUrl("/employees"), async ({ request }) => {
        posted = (await request.text()).includes("أحمد جمال");
        return HttpResponse.json({ employee }, { status: 201 });
      })
    );
    const onSuccess = vi.fn();
    renderWithProviders(<EmployeeForm onSuccess={onSuccess} />);

    const user = await fillCreateForm();
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(employee));
    expect(posted).toBe(true);
  });

  it("shows a mapped conflict message when the phone already exists", async () => {
    server.use(
      http.post(apiUrl("/employees"), () =>
        HttpResponse.json(
          { error: { code: "EMPLOYEE_CONFLICT", message: "x", details: { field: "primary_phone" } } },
          { status: 409 }
        )
      )
    );
    renderWithProviders(<EmployeeForm />);

    const user = await fillCreateForm();
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("رقم الهاتف مستخدم بالفعل")).toBeInTheDocument();
  });
});

describe("EmployeeForm — edit", () => {
  it("prefills fields and has no upload or branch controls", () => {
    renderWithProviders(<EmployeeForm employee={employee} />);

    expect(screen.getByLabelText("الاسم الكامل")).toHaveValue("أحمد جمال");
    expect(screen.queryByLabelText("الصورة الشخصية")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "الفرع" })).not.toBeInTheDocument();
  });

  it("patches changed fields and omits an empty password", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(apiUrl("/employees/1"), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ employee: { ...employee, fullName: "أحمد محمد" } });
      })
    );
    const onSuccess = vi.fn();
    renderWithProviders(<EmployeeForm employee={employee} onSuccess={onSuccess} />);

    const user = userEvent.setup();
    const name = screen.getByLabelText("الاسم الكامل");
    await user.clear(name);
    await user.type(name, "أحمد محمد");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(body.fullName).toBe("أحمد محمد");
    expect(body).not.toHaveProperty("password");
  });
});
