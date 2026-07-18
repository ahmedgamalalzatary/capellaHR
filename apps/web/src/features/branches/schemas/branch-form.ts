import { z } from 'zod';

import { FORM_MESSAGES } from '@/lib/validation/messages';

const requiredNumber = (message: string = FORM_MESSAGES.invalidNumber) =>
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
  name: z.string().trim().min(1, FORM_MESSAGES.required)
    .refine((value) => [...value].length <= 255 && [...value.toLowerCase()].length <= 255, 'اسم الفرع طويل جدًا'),
  location: z.string().trim().min(1, FORM_MESSAGES.required)
    .refine((value) => [...value].length <= 1000, 'الموقع طويل جدًا'),
  latitude: requiredNumber().pipe(z.number().min(-90, FORM_MESSAGES.invalidNumber).max(90, FORM_MESSAGES.invalidNumber)),
  longitude: requiredNumber().pipe(z.number().min(-180, FORM_MESSAGES.invalidNumber).max(180, FORM_MESSAGES.invalidNumber)),
  gpsAccuracyMeters: requiredNumber().pipe(z.number().nonnegative(FORM_MESSAGES.invalidNumber)),
  attendanceRadiusMeters: requiredNumber('أدخل نطاقًا موجبًا بالمتر').pipe(
    z.number().positive('أدخل نطاقًا موجبًا بالمتر'),
  ),
});

export type BranchFormValues = z.infer<typeof branchFormSchema>;
