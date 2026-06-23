import { z } from "zod";

/**
 * Form schema for creating/editing a branch, with Arabic user-facing messages.
 * Mirrors backend validation (apps/api branchCreateSchema): name, address,
 * GPS coordinates + radius, and an allowed IP CIDR. Numeric fields are coerced
 * from the string values that HTML inputs produce.
 */
export const branchFormSchema = z.object({
  name: z.string().trim().min(1, "اسم الفرع مطلوب"),
  address: z.string().trim().min(1, "العنوان مطلوب"),
  gpsLatitude: z.coerce
    .number({ message: "خط العرض غير صحيح" })
    .min(-90, "خط العرض غير صحيح")
    .max(90, "خط العرض غير صحيح"),
  gpsLongitude: z.coerce
    .number({ message: "خط الطول غير صحيح" })
    .min(-180, "خط الطول غير صحيح")
    .max(180, "خط الطول غير صحيح"),
  gpsRadiusMeters: z.coerce
    .number({ message: "نطاق الموقع غير صحيح" })
    .int("نطاق الموقع يجب أن يكون رقمًا صحيحًا")
    .positive("نطاق الموقع يجب أن يكون أكبر من صفر"),
  allowedIpCidr: z.string().trim().min(1, "نطاق الـ IP المسموح به مطلوب")
});

export type BranchFormValues = z.infer<typeof branchFormSchema>;
