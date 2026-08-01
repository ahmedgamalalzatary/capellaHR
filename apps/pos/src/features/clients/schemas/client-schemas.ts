import { createClientSchema } from '@capella/contracts';
import { z } from 'zod';

const codePoints = (value: string) => [...value].length;

const fullNameFormSchema = z
  .string()
  .trim()
  .min(1, 'اسم العميل مطلوب')
  .refine((value) => codePoints(value) <= 255, { message: 'اسم العميل طويل جدًا' });

/**
 * Reuses the contract's phone rule so the browser normalizes exactly the way
 * the server does; the server remains the authority either way.
 */
const phoneFormSchema = z
  .string()
  .trim()
  .min(1, 'رقم الهاتف مطلوب')
  .pipe(createClientSchema.shape.phone);

export const clientFormSchema = z.object({
  fullName: fullNameFormSchema,
  phone: phoneFormSchema,
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;
