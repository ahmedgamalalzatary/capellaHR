import { bonuses, employeeBranchAssignments } from '@capella/database/schema';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { branchIdAt } from './branch-id-at.js';

describe('branchIdAt', () => {
  it('builds the historical assignment join and branch fallback', () => {
    const dialect = new MySqlDialect();
    const result = branchIdAt(employeeBranchAssignments, bonuses.employeeId, bonuses.createdAt);
    expect(dialect.sqlToQuery(result.branchId).sql).toContain('coalesce(`employee_branch_assignments`.`branch_id`');
    const join = dialect.sqlToQuery(result.assignment).sql;
    expect(join).toContain('`employee_branch_assignments`.`employee_id` = `bonuses`.`employee_id`');
    expect(join).toContain('`employee_branch_assignments`.`effective_from` <= `bonuses`.`created_at`');
    expect(join).toContain('`employee_branch_assignments`.`effective_to` > `bonuses`.`created_at`');
  });
});
