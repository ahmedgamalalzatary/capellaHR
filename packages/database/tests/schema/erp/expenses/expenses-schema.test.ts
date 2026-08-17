import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpExpenses } from '../../../../src/schema/erp/expenses/index.js';

describe('ERP expense schema', () => {
  it('keeps immutable expense facts with branch, actor and correction lineage', () => {
    const config = getTableConfig(erpExpenses);
    expect(config.name).toBe('erp_expenses');
    expect(Object.keys(erpExpenses)).toEqual(expect.arrayContaining([
      'branchId', 'name', 'amount', 'expenseDate', 'description', 'actingAccountId',
      'kind', 'status', 'reversalOfId', 'supersedesId', 'correctionOperationId', 'createdAt',
    ]));
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_expenses_branch_date_idx', 'erp_expenses_reversal_unique', 'erp_expenses_supersedes_unique',
    ]));
    // An expense is identified by its own name; categories are gone.
    expect(Reflect.get(erpExpenses, 'categoryId')).toBeUndefined();
    expect(config.foreignKeys.map((key) => key.getName()))
      .not.toContain('erp_expenses_category_branch_fk');
    expect(config.indexes.map((index) => index.config.name))
      .not.toContain('erp_expenses_branch_category_date_idx');
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'erp_expenses_amount_positive', 'erp_expenses_lineage_consistent',
      'erp_expenses_correction_operation_consistent',
    ]));
  });
});
