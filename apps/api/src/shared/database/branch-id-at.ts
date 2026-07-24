import { employees } from '@capella/database/schema';
import { and, eq, gt, isNull, lte, or, sql, type SQLWrapper } from 'drizzle-orm';

type AssignmentTable = {
  branchId: SQLWrapper;
  employeeId: SQLWrapper;
  effectiveFrom: SQLWrapper;
  effectiveTo: SQLWrapper;
};

export const branchIdAt = (
  assignments: AssignmentTable,
  employeeId: SQLWrapper,
  timestamp: SQLWrapper,
) => ({
  branchId: sql<number>`coalesce(${assignments.branchId}, ${employees.branchId})`,
  assignment: and(
    eq(assignments.employeeId, employeeId),
    lte(assignments.effectiveFrom, timestamp),
    or(isNull(assignments.effectiveTo), gt(assignments.effectiveTo, timestamp)),
  )!,
});
