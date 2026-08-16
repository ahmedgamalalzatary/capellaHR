import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpExpenses } from '../../../../src/schema/erp/expenses/index.js';

describe('ERP expense schema', () => {
  it('keeps immutable expense facts with branch, category, actor and correction lineage', () => {
    const config = getTableConfig(erpExpenses);
    expect(config.name).toBe('erp_expenses');
    expect(Object.keys(erpExpenses)).toEqual(expect.arrayContaining([
      'branchId', 'categoryId', 'amount', 'expenseDate', 'description', 'actingAccountId',
      'kind', 'status', 'reversalOfId', 'supersedesId', 'correctionOperationId', 'createdAt',
    ]));
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'erp_expenses_branch_date_idx', 'erp_expenses_reversal_unique', 'erp_expenses_supersedes_unique',
    ]));
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'erp_expenses_amount_positive', 'erp_expenses_lineage_consistent',
      'erp_expenses_correction_operation_consistent',
    ]));
  });
});
