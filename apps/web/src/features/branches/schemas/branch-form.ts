import { z } from 'zod';

const REQUIRED = 'هذا الحقل مطلوب';
const INVALID_NUMBER = 'أدخل رقمًا صالحًا';

const requiredNumber = (message = INVALID_NUMBER) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value === null ? undefined : value;
    },
    z.coerce.number({ message }).finite(message),
  );

/**
 * Client-side form schema mirroring the contracts' createBranchSchema, with
 * Arabic messages and string→number coercion for the numeric inputs.
 */
export const branchFormSchema = z.object({
  name: z.string().trim().min(1, REQUIRED)
    .refine((value) => [...value].length <= 255 && [...value.toLowerCase()].length <= 255, 'اسم الفرع طويل جدًا'),
  location: z.string().trim().min(1, REQUIRED)
    .refine((value) => [...value].length <= 1000, 'الموقع طويل جدًا'),
  latitude: requiredNumber().pipe(z.number().min(-90, INVALID_NUMBER).max(90, INVALID_NUMBER)),
  longitude: requiredNumber().pipe(z.number().min(-180, INVALID_NUMBER).max(180, INVALID_NUMBER)),
  gpsAccuracyMeters: requiredNumber().pipe(z.number().nonnegative(INVALID_NUMBER)),
  attendanceRadiusMeters: requiredNumber('أدخل نطاقًا موجبًا بالمتر').pipe(
    z.number().positive('أدخل نطاقًا موجبًا بالمتر'),
  ),
});

export type BranchFormValues = z.infer<typeof branchFormSchema>;
