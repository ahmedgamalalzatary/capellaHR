import { type createDatabase } from '@capella/database';
import { branchCashierRoster, employees } from '@capella/database/schema';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type {
  BranchCashierRosterMember,
  BranchCashierRosterRepository,
} from './branch-cashier-roster-service.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

const activeMembers = (executor: Executor, branchId: number) => executor.select({
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
}).from(branchCashierRoster).innerJoin(employees, and(
  eq(employees.id, branchCashierRoster.employeeId),
  eq(employees.branchId, branchCashierRoster.branchId),
)).where(and(
  eq(branchCashierRoster.branchId, branchId),
  eq(employees.employmentStatus, 'active'),
  isNull(employees.deletedAt),
)).orderBy(asc(employees.fullName));

const allMemberIds = (executor: Executor, branchId: number) => executor.select({
  id: branchCashierRoster.employeeId,
}).from(branchCashierRoster).where(
  eq(branchCashierRoster.branchId, branchId),
).orderBy(asc(branchCashierRoster.employeeId));

export const createDrizzleBranchCashierRosterRepository = (
  database: Database,
  audit: ErpAuditCapability,
): BranchCashierRosterRepository => ({
  listByBranch(branchId) {
    return activeMembers(database, branchId);
  },

  async replace(input) {
    return database.transaction(async (transaction) => {
      let members: BranchCashierRosterMember[] = [];
      if (input.employeeIds.length > 0) {
        const rows = await transaction.select({
          id: employees.id,
          employeeCode: employees.employeeCode,
          fullName: employees.fullName,
        }).from(employees).where(and(
          inArray(employees.id, input.employeeIds),
          eq(employees.branchId, input.branchId),
          eq(employees.employmentStatus, 'active'),
          isNull(employees.deletedAt),
        )).for('update');
        const requested = new Set(input.employeeIds);
        if (rows.length !== requested.size) {
          return { kind: 'employee_not_in_branch' as const };
        }
        const byId = new Map(rows.map((row) => [row.id, row]));
        members = input.employeeIds.map((employeeId) => byId.get(employeeId)!);
      }

      const before = await allMemberIds(transaction, input.branchId);
      await transaction.delete(branchCashierRoster)
        .where(eq(branchCashierRoster.branchId, input.branchId));
      if (input.employeeIds.length > 0) {
        await transaction.insert(branchCashierRoster).values(
          input.employeeIds.map((employeeId) => ({
            branchId: input.branchId,
            employeeId,
            createdAt: input.replacedAt,
          })),
        );
      }
      await audit.record(transaction, {
        module: 'erp_cashier_roster',
        action: 'replace',
        entityType: 'branch_cashier_roster',
        entityId: input.branchId,
        beforeState: { members: before.map(({ id }) => id) },
        afterState: { members: input.employeeIds },
        relatedIds: { branchId: input.branchId },
        createdAt: input.replacedAt,
      });
      return { kind: 'replaced' as const, members };
    });
  },
});
