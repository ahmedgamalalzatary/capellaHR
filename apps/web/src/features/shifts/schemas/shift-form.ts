import { z } from 'zod';

const REQUIRED = 'هذا الحقل مطلوب';
const INVALID_HOURS = 'أدخل عدد ساعات صالحًا';
const INVALID_MINUTES = 'أدخل عدد دقائق صالحًا';

const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 720;

const wholeNumber = (message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value === null ? undefined : value;
    },
    z.coerce.number({ message: REQUIRED }).int(message).nonnegative(message),
  );

/**
 * Client-side mirror of the contracts' shift duration rule (1 minute through
 * 12 hours inclusive). The locked spec enters a duration as hours and minutes,
 * so both range issues are reported on `hours` — the field the admin edits
 * first — to keep a single, unambiguous message per submission.
 */
export const shiftFormSchema = z
  .object({
    hours: wholeNumber(INVALID_HOURS),
    minutes: wholeNumber(INVALID_MINUTES).pipe(
      z.number().max(59, 'الدقائق من 0 إلى 59'),
    ),
  })
  .transform(({ hours, minutes }) => ({ durationMinutes: hours * 60 + minutes }))
  .superRefine((value, context) => {
    if (value.durationMinutes < MIN_DURATION_MINUTES) {
      context.addIssue({
        code: 'custom',
        path: ['hours'],
        message: 'أقل مدة للوردية دقيقة واحدة',
      });
    }
    if (value.durationMinutes > MAX_DURATION_MINUTES) {
      context.addIssue({
        code: 'custom',
        path: ['hours'],
        message: 'الحد الأقصى للوردية 12 ساعة',
      });
    }
  });

/** Stored minutes back into the hours/minutes pair the form edits. */
export function splitDuration(durationMinutes: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(durationMinutes / 60),
    minutes: durationMinutes % 60,
  };
}

export type ShiftFormValues = z.infer<typeof shiftFormSchema>;
