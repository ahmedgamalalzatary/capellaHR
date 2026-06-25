import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/lib/api-client";
import { employeeErrorMessage } from "@/features/employees/employee-error-message";

function apiError(code: string, details: Record<string, unknown> = {}, message = "raw") {
  return new ApiError(409, message, { error: { code, message, details } });
}

describe("employeeErrorMessage", () => {
  it("maps a primary-phone conflict", () => {
    expect(employeeErrorMessage(apiError("EMPLOYEE_CONFLICT", { field: "primary_phone" }))).toBe(
      "رقم الهاتف مستخدم بالفعل"
    );
  });

  it("maps a whatsapp-phone conflict", () => {
    expect(employeeErrorMessage(apiError("EMPLOYEE_CONFLICT", { field: "whatsapp_phone" }))).toBe(
      "رقم واتساب مستخدم بالفعل"
    );
  });

  it("maps an email conflict", () => {
    expect(employeeErrorMessage(apiError("EMPLOYEE_CONFLICT", { field: "email" }))).toBe(
      "البريد الإلكتروني مستخدم بالفعل"
    );
  });

  it("maps a not-assignable branch", () => {
    expect(employeeErrorMessage(apiError("BRANCH_NOT_ASSIGNABLE"))).toBe(
      "لا يمكن تعيين الموظف لفرع غير مكتمل"
    );
  });

  it("maps missing files", () => {
    expect(employeeErrorMessage(apiError("MISSING_EMPLOYEE_FILES"))).toBe(
      "جميع صور الموظف مطلوبة"
    );
  });

  it("maps a past-date branch assignment", () => {
    expect(employeeErrorMessage(apiError("EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE"))).toBe(
      "تاريخ التعيين يجب أن يكون اليوم أو في المستقبل"
    );
  });

  it("falls back to a generic message for an unknown error", () => {
    expect(employeeErrorMessage(new Error("boom"))).toBe("تعذّر حفظ البيانات، حاول مرة أخرى");
  });
});
