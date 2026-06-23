import { z } from "zod";
import { egyptianPhoneSchema } from "@capella/shared/schemas";

/**
 * Form schemas for the sign-in screens, with Arabic user-facing messages.
 * Mirrors backend validation: employee = phone + password (>= 8); admin =
 * email + password (>= 8). See apps/api/src/modules/auth/routes.ts.
 */
export const employeeSignInFormSchema = z.object({
  phone: egyptianPhoneSchema,
  password: z.string().min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف")
});

export const adminSignInFormSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("البريد الإلكتروني غير صحيح")),
  password: z.string().min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف")
});

export type EmployeeSignInFormValues = z.infer<typeof employeeSignInFormSchema>;
export type AdminSignInFormValues = z.infer<typeof adminSignInFormSchema>;
