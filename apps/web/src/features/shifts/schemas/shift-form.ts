import { z } from 'zod';

import { FORM_MESSAGES } from '@/lib/validation/messages';

const wholeNumber = () =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value === null ? undefined : value;
    },
    z.coerce.number({ message: FORM_MESSAGES.required })
      .int(FORM_MESSAGES.invalidNumber)
      .nonnegative(FORM_MESSAGES.invalidNumber),
  );

/**
 * Validates the hours/minutes input shape and converts it to API minutes.
 * The API owns the allowed total-duration range and returns its field error.
 */
export const shiftFormSchema = z
  .object({
    hours: wholeNumber(),
    minutes: wholeNumber().pipe(
      z.number().max(59, 'الدقائق من 0 إلى 59'),
    ),
  })
  .transform(({ hours, minutes }) => ({ durationMinutes: hours * 60 + minutes }));

/** Stored minutes back into the hours/minutes pair the form edits. */
export function splitDuration(durationMinutes: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(durationMinutes / 60),
    minutes: durationMinutes % 60,
  };
}

export type ShiftFormValues = z.infer<typeof shiftFormSchema>;
