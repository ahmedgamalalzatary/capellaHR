import { clientPhoneSchema } from '@capella/contracts';
import { z } from 'zod';

const codePoints = (value: string) => [...value].length;

const fullNameFormSchema = z
  .string()
  .trim()
  .refine((value) => codePoints(value) <= 255, { message: 'اسم العميل طويل جدًا' });

/**
 * Reuses the contract's phone rule so the browser normalizes exactly the way
 * the server does; the server remains the authority either way.
 */
const phoneFormSchema = z.string().trim().pipe(clientPhoneSchema);

/**
 * A client is identified by a name or by a number: the counter fills whichever it
 * has. Blank fields are dropped rather than sent, so the record stores nothing
 * instead of an empty string, and one of the two must survive.
 */
export const clientFormSchema = z.object({
  fullName: z.string(),
  phone: z.string(),
}).transform((value, context) => {
  const name = fullNameFormSchema.safeParse(value.fullName);
  if (!name.success) {
    context.addIssue({ code: 'custom', path: ['fullName'], message: name.error.issues[0]!.message });
    return z.NEVER;
  }
  const typedPhone = value.phone.trim();
  const phone = typedPhone === '' ? null : phoneFormSchema.safeParse(typedPhone);
  if (phone !== null && !phone.success) {
    context.addIssue({ code: 'custom', path: ['phone'], message: phone.error.issues[0]!.message });
    return z.NEVER;
  }
  if (name.data === '' && phone === null) {
    context.addIssue({
      code: 'custom',
      path: ['fullName'],
      message: 'أدخل اسم العميل أو رقم هاتفه على الأقل',
    });
    return z.NEVER;
  }
  return {
    ...(name.data === '' ? {} : { fullName: name.data }),
    ...(phone === null ? {} : { phone: phone.data }),
  };
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;
/** What the two inputs hold before validation drops the blank one. */
export type ClientFormFields = { fullName: string; phone: string };
