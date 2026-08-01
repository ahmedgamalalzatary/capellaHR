import { containsArabicIndicDigits, normalizeEgyptianMobile } from '@capella/shared';
import { z } from 'zod';
import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../../common/index.js';

// MySQL VARCHAR limits count characters (code points), not UTF-16 units.
const codePoints = (value: string) => [...value].length;

/**
 * Mirrors the employees module's phone contract rather than importing it: the
 * ERP boundary rules keep ERP contracts off HR internals, and `phone` is not
 * part of the employees public surface. If a third consumer appears, promote
 * this to `common/`.
 */
const clientPhone = z.string().transform((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
    return z.NEVER;
  }
  const normalized = normalizeEgyptianMobile(value);
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'رقم الهاتف المصري غير صالح' });
    return z.NEVER;
  }
  return normalized;
});

const clientName = z.string().trim().min(1)
  .refine((value) => codePoints(value) <= 255, { message: 'اسم العميل طويل جدًا' });

/**
 * `branchId` is optional on every operation and is never trusted as the branch
 * identity: the server resolves the acting branch from the account. An Admin
 * must supply it (they belong to no branch); a Cashier may omit it, and
 * supplying another branch's id is rejected.
 */
const branchScope = { branchId: coercedMysqlIntSchema.optional() };

export const createClientSchema = z.object({
  fullName: clientName,
  phone: clientPhone,
  ...branchScope,
}).strict();

export const updateClientSchema = z.object({
  fullName: clientName.optional(),
  phone: clientPhone.optional(),
  ...branchScope,
}).strict().superRefine((value, context) => {
  const editable = ['fullName', 'phone'].filter((key) => key in value).length;
  if (editable === 0) {
    context.addIssue({ code: 'custom', message: 'يجب إرسال حقل واحد على الأقل' });
  }
});

export const clientIdParamsSchema = z.object({ id: coercedMysqlIntSchema });

/**
 * Free-text search is matched literally against name and phone, so a Cashier
 * can type a partial number while it is still too short to normalize.
 */
export const listClientsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
});

/** Exact lookup used to resolve or de-duplicate a client during a sale. */
export const findClientByPhoneQuerySchema = z.object({
  phone: clientPhone,
  ...branchScope,
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type FindClientByPhoneQuery = z.infer<typeof findClientByPhoneQuerySchema>;
