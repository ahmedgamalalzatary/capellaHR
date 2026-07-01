import { ApiError } from "@/shared/lib/api-client";

const CONFLICT_FIELD_MESSAGES: Record<string, string> = {
  primary_phone: "رقم الهاتف مستخدم بالفعل",
  whatsapp_phone: "رقم واتساب مستخدم بالفعل",
  email: "البريد الإلكتروني مستخدم بالفعل"
};

const CODE_MESSAGES: Record<string, string> = {
  BRANCH_NOT_ASSIGNABLE: "لا يمكن تعيين الموظف لفرع غير مكتمل",
  MISSING_EMPLOYEE_FILES: "جميع صور الموظف مطلوبة",
  EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE: "تاريخ التعيين يجب أن يكون اليوم أو في المستقبل",
  EMPLOYEE_NOT_FOUND: "الموظف غير موجود",
  MONTH_LOCKED: "لا يمكن تعديل شهر مغلق",
  WEEKLY_DAY_OFF_ATTENDANCE_CONFLICT: "لا يمكن تسجيل يوم راحة في يوم به حضور",
  WEEKLY_DAY_OFF_NOT_FOUND: "يوم الراحة غير موجود",
  WEEKLY_DAY_OFF_OVERRIDE_REASON_REQUIRED:
    "سبب التجاوز مطلوب عند تسجيل أكثر من يوم راحة في نفس الأسبوع"
};

type ErrorPayload = {
  error?: { code?: string; message?: string; details?: { field?: string } };
};

/**
 * Translate an API error into an Arabic, user-facing message. Handles the
 * employee-specific conflict/validation codes and falls back to a generic
 * message for anything unrecognized.
 */
export function employeeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const payload = error.payload as ErrorPayload | null;
    const code = payload?.error?.code;

    if (code === "EMPLOYEE_CONFLICT") {
      const field = payload?.error?.details?.field;
      return (field && CONFLICT_FIELD_MESSAGES[field]) ?? "هذه البيانات مستخدمة بالفعل";
    }

    if (code && CODE_MESSAGES[code]) {
      return CODE_MESSAGES[code];
    }
  }

  return "تعذّر حفظ البيانات، حاول مرة أخرى";
}
