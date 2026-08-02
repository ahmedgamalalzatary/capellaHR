import { z } from 'zod';

import { coercedMysqlIntSchema } from '../../../common/index.js';

/**
 * `branchId` is never trusted as branch identity: the server resolves the
 * acting branch from the account. An Admin must supply it (they belong to no
 * branch); a Cashier may omit it, and naming another branch is rejected.
 */
export const listAssignableEmployeesQuerySchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
});

/**
 * The employee an invoice is assigned to. Assignment eligibility is strictly
 * live attendance (`docs/erp-plan.md` §7), so this contract deliberately
 * carries no override flag for either a Cashier or an Admin: `.strict()`
 * rejects any attempt to invent one.
 */
export const assignEmployeeSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export type ListAssignableEmployeesQuery = z.infer<typeof listAssignableEmployeesQuerySchema>;
export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;
