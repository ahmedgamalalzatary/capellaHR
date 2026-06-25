import { z } from "zod";
import { normalizeEgyptianPhone } from "@capella/shared/schemas";

/** Allowed employee image upload types and size cap, matching the backend. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const egyptianPhonePattern = /^(010|011|012|015)\d{8}$/;

/** Egyptian mobile field: normalizes (e.g. +20) then validates the local form. */
function egyptianPhoneField(message: string) {
  return z
    .string()
    .trim()
    .transform(normalizeEgyptianPhone)
    .refine((value) => egyptianPhonePattern.test(value), message);
}

/** A required employee image file, validated for type and size. */
const imageFileField = z
  .instanceof(File, { message: "الملف مطلوب" })
  .refine((file) => file.size > 0, "الملف مطلوب")
  .refine(
    (file) => (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type),
    "يجب أن يكون الملف صورة JPEG أو PNG"
  )
  .refine((file) => file.size <= MAX_IMAGE_BYTES, "حجم الملف يجب ألا يتجاوز 10 ميجابايت");

const passwordField = z.string().min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف");

/**
 * Text fields shared by the create and edit employee forms. Numeric fields are
 * coerced from the string values HTML inputs produce. `email` is optional: an
 * empty input is treated as "no email", otherwise it must be a valid address.
 */
const employeeBaseFields = {
  fullName: z.string().trim().min(1, "الاسم الكامل مطلوب"),
  primaryPhone: egyptianPhoneField("رقم الهاتف غير صالح"),
  whatsappPhone: egyptianPhoneField("رقم واتساب غير صالح"),
  email: z.union([z.literal(""), z.email("البريد الإلكتروني غير صالح").trim().toLowerCase()]),
  age: z.coerce
    .number({ message: "العمر غير صالح" })
    .int("العمر يجب أن يكون رقمًا صحيحًا")
    .positive("العمر غير صالح"),
  address: z.string().trim().min(1, "العنوان مطلوب"),
  currentMonthlySalary: z.coerce
    .number({ message: "الراتب غير صالح" })
    .nonnegative("الراتب غير صالح")
};

const branchIdField = z.coerce
  .number({ message: "الفرع مطلوب" })
  .int("الفرع غير صالح")
  .positive("الفرع مطلوب");

/**
 * Create form: all fields required, including the initial branch and the three
 * image uploads. Branch changes after creation go through the assignment flow,
 * so the edit form below intentionally omits `branchId`.
 */
export const employeeCreateFormSchema = z.object({
  ...employeeBaseFields,
  branchId: branchIdField,
  password: passwordField,
  personalPhoto: imageFileField,
  idFront: imageFileField,
  idBack: imageFileField
});

/**
 * Edit form: same text fields, no uploads. Password is optional — an empty
 * value means "leave the current password unchanged".
 */
export const employeeEditFormSchema = z.object({
  ...employeeBaseFields,
  password: z.union([z.literal(""), passwordField])
});

export type EmployeeCreateFormValues = z.infer<typeof employeeCreateFormSchema>;
export type EmployeeEditFormValues = z.infer<typeof employeeEditFormSchema>;
