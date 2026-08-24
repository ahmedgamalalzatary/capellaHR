import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import * as salesSchema from '../../../../src/schema/erp/sales/index.js';

const table = (name: keyof typeof salesSchema) => {
  const value = salesSchema[name];
  expect(value).toBeDefined();
  return value as Parameters<typeof getTableConfig>[0];
};

describe('ERP sales persistence foundation', () => {
  it('defines immutable invoice reversal headers, lines, and payment facts', () => {
    const reversals = table('invoiceReversals');
    expect(Object.keys(reversals)).toEqual(expect.arrayContaining([
      'id', 'invoiceId', 'branchId', 'type', 'status', 'idempotencyKey', 'reason',
      'actingAccountId', 'approvingAccountId', 'grossAmount', 'discountAmount',
      'taxAmount', 'total', 'businessDate', 'createdAt',
    ]));
    const reversalConfig = getTableConfig(reversals);
    expect(reversalConfig.indexes.map((value) => value.config.name)).toEqual(expect.arrayContaining([
      'erp_invoice_reversals_idempotency_unique',
      'erp_invoice_reversals_invoice_created_idx',
    ]));

    const lines = table('invoiceReversalLines');
    expect(Object.keys(lines)).toEqual(expect.arrayContaining([
      'id', 'reversalId', 'invoiceId', 'invoiceLineId', 'branchId', 'quantity',
      'grossAmount', 'discountAmount', 'taxAmount', 'total',
    ]));
    expect(getTableConfig(lines).checks.map((value) => value.name)).toContain(
      'erp_invoice_reversal_lines_amounts_consistent',
    );

    const payments = table('invoiceReversalPayments');
    expect(Object.keys(payments)).toEqual(expect.arrayContaining([
      'id', 'reversalId', 'invoicePaymentId', 'methodSnapshot', 'amount',
    ]));
    expect(getTableConfig(payments).indexes.map((value) => value.config.name)).toContain(
      'erp_invoice_reversal_payments_method_unique',
    );
    // Money handed back on a method the sale never used reverses no payment row.
    const paymentColumns = new Map(getTableConfig(payments).columns
      .map((column) => [column.name, column.notNull]));
    expect(paymentColumns.get('invoice_payment_id')).toBe(false);
    expect(paymentColumns.get('method_snapshot')).toBe(true);
  });

  it('defines the product identity needed by product invoice lines', () => {
    const products = table('erpProducts');
    expect(Object.keys(products)).toEqual(expect.arrayContaining([
      'id', 'branchId', 'name', 'nameNormalized', 'description', 'sellingPrice',
      'lastPurchaseCost', 'lowStockThreshold', 'isActive', 'createdAt', 'updatedAt',
    ]));
    const config = getTableConfig(products);
    expect(config.indexes.map((value) => value.config.name)).toContain(
      'erp_products_branch_name_unique',
    );
  });

  it('defines immutable invoice facts, ownership, snapshots, totals and idempotency', () => {
    const invoices = table('invoices');
    expect(Object.keys(invoices)).toEqual(expect.arrayContaining([
      'id', 'branchId', 'clientId', 'actingAccountId',
      'cashierSessionId', 'invoiceNumber', 'idempotencyKey', 'status',
      'clientNameSnapshot', 'clientPhoneSnapshot',
      'authorizedBySnapshot', 'subtotal', 'discountKind',
      'discountValue', 'discountAmount', 'taxKind', 'taxValue', 'taxAmount',
      'total', 'soldAt', 'createdAt',
    ]));
    expect(Reflect.get(invoices, 'paymentTotal')).toBeUndefined();
    // The performing employee now lives on each service line, not on the invoice.
    expect(Reflect.get(invoices, 'assignedEmployeeId')).toBeUndefined();
    expect(Reflect.get(invoices, 'employeeNameSnapshot')).toBeUndefined();
    expect(Reflect.get(invoices, 'employeeCodeSnapshot')).toBeUndefined();
    expect(salesSchema.invoiceStatuses).toEqual([
      'draft', 'completed', 'partially_refunded', 'refunded', 'voided',
    ]);
    const config = getTableConfig(invoices);
    const indexes = config.indexes.map((value) => value.config.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'erp_invoices_number_unique',
      'erp_invoices_idempotency_unique',
      'erp_invoices_branch_sold_idx',
      'erp_invoices_client_sold_idx',
    ]));
    expect(indexes).not.toContain('erp_invoices_employee_sold_idx');
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      'erp_invoices_totals_consistent',
      'erp_invoices_discount_consistent',
      'erp_invoices_tax_consistent',
    ]));
    expect(config.checks.map((value) => value.name))
      .not.toContain('erp_invoices_employee_assignment_consistent');
    expect(config.foreignKeys.map((value) => value.getName())).toEqual(expect.arrayContaining([
      'erp_invoices_client_branch_fk',
      'erp_invoices_session_branch_fk',
    ]));
    expect(config.foreignKeys.map((value) => value.getName()))
      .not.toContain('erp_invoices_employee_branch_fk');
  });

  it('defines service and product lines with exclusive source references and snapshots', () => {
    const lines = table('invoiceLines');
    expect(Object.keys(lines)).toEqual(expect.arrayContaining([
      'id', 'invoiceId', 'branchId', 'lineNumber', 'itemType', 'serviceId', 'productId',
      'itemNameSnapshot', 'quantity', 'unitPrice', 'lineTotal',
      'commissionRuleSnapshot', 'commissionRateSnapshot',
      'commissionAmountSnapshot', 'productCostBasisSnapshot',
    ]));
    const config = getTableConfig(lines);
    expect(config.indexes.map((value) => value.config.name)).toEqual(expect.arrayContaining([
      'erp_invoice_lines_invoice_line_unique',
      'erp_invoice_lines_service_idx',
      'erp_invoice_lines_product_idx',
    ]));
    expect(config.foreignKeys.map((value) => value.getName())).toEqual(expect.arrayContaining([
      'erp_invoice_lines_invoice_branch_fk',
      'erp_invoice_lines_service_branch_fk',
      'erp_invoice_lines_product_branch_fk',
    ]));
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      'erp_invoice_lines_source_consistent',
      'erp_invoice_lines_amounts_consistent',
      'erp_invoice_lines_commission_consistent',
      'erp_invoice_lines_cost_consistent',
    ]));
  });

  it('assigns each service line its own performing employee and snapshots', () => {
    const lines = table('invoiceLines');
    expect(Object.keys(lines)).toEqual(expect.arrayContaining([
      'employeeId', 'employeeNameSnapshot', 'employeeCodeSnapshot',
    ]));
    expect(salesSchema.invoiceLines.employeeId.notNull).toBe(false);
    const config = getTableConfig(lines);
    expect(config.foreignKeys.map((value) => value.getName()))
      .toContain('erp_invoice_lines_employee_branch_fk');
    expect(config.indexes.map((value) => value.config.name))
      .toContain('erp_invoice_lines_employee_idx');
    expect(config.checks.map((value) => value.name))
      .toContain('erp_invoice_lines_employee_consistent');
  });

  it('records immutable employee reassignments for sold service lines', () => {
    const reassignments = table('invoiceLineReassignments');
    expect(Object.keys(reassignments)).toEqual(expect.arrayContaining([
      'id', 'invoiceId', 'invoiceLineId', 'branchId', 'fromEmployeeId', 'toEmployeeId',
      'reason', 'operationReference', 'actingAccountId', 'createdAt',
    ]));
    const config = getTableConfig(reassignments);
    expect(config.indexes.map((value) => value.config.name)).toEqual(expect.arrayContaining([
      'erp_invoice_line_reassignments_line_operation_unique',
      'erp_invoice_line_reassignments_line_created_idx',
    ]));
    expect(config.foreignKeys.map((value) => value.getName())).toEqual(expect.arrayContaining([
      'erp_invoice_line_reassignments_line_invoice_branch_fk',
      'erp_invoice_line_reassignments_from_employee_branch_fk',
      'erp_invoice_line_reassignments_to_employee_branch_fk',
    ]));
    expect(config.checks.map((value) => value.name)).toContain(
      'erp_invoice_line_reassignments_employee_changed',
    );
  });

  it('defines exact payment breakdowns using only the locked methods', () => {
    expect(salesSchema.erpPaymentMethods).toEqual([
      'cash', 'visa', 'instapay', 'vodafone_cash',
    ]);
    const payments = table('invoicePayments');
    const config = getTableConfig(payments);
    expect(config.indexes.map((value) => value.config.name)).toContain(
      'erp_invoice_payments_invoice_method_unique',
    );
    expect(config.checks.map((value) => value.name)).toContain(
      'erp_invoice_payments_amount_positive',
    );
  });

  it('defines a durable daily invoice counter', () => {
    const sequences = table('invoiceDailySequences');
    expect(Object.keys(sequences)).toEqual(expect.arrayContaining([
      'businessDate', 'lastValue', 'updatedAt',
    ]));
    expect(getTableConfig(sequences).checks.map((value) => value.name)).toContain(
      'erp_invoice_daily_sequences_value_positive',
    );
  });

  it('records the selling cashier and the branch roster behind the shared login', () => {
    const invoices = table('invoices');
    expect(Object.keys(invoices)).toEqual(expect.arrayContaining([
      'sellerEmployeeId', 'sellerNameSnapshot',
    ]));
    expect(salesSchema.invoices.sellerEmployeeId.notNull).toBe(false);
    expect(salesSchema.invoices.sellerNameSnapshot.notNull).toBe(false);
    const invoiceConfig = getTableConfig(invoices);
    expect(invoiceConfig.indexes.map((value) => value.config.name)).toContain(
      'erp_invoices_seller_sold_idx',
    );
    expect(invoiceConfig.checks.map((value) => value.name)).toContain(
      'erp_invoices_seller_consistent',
    );
    expect(invoiceConfig.foreignKeys.map((value) => value.getName())).toContain(
      'erp_invoices_seller_branch_fk',
    );

    const roster = table('branchCashierRoster');
    expect(getTableName(roster)).toBe('erp_branch_cashier_roster');
    expect(Object.keys(roster)).toEqual(expect.arrayContaining([
      'id', 'branchId', 'employeeId', 'createdAt',
    ]));
    const rosterConfig = getTableConfig(roster);
    expect(rosterConfig.indexes.map((value) => value.config.name)).toContain(
      'erp_branch_cashier_roster_branch_employee_unique',
    );
    expect(rosterConfig.foreignKeys.map((value) => value.getName())).toEqual(expect.arrayContaining([
      'erp_branch_cashier_roster_branch_fk',
      'erp_branch_cashier_roster_employee_branch_fk',
    ]));
  });

  it('defines append-only commission facts and traceable reversals', () => {
    const ledger = table('commissionLedgerEntries');
    expect(Object.keys(ledger)).toEqual(expect.arrayContaining([
      'id', 'invoiceId', 'invoiceLineId', 'employeeId', 'actingAccountId',
      'entryType', 'reversesEntryId', 'invoiceReversalId', 'invoiceLineReassignmentId', 'commissionRuleSnapshot',
      'commissionRateSnapshot', 'baseAmount', 'amount', 'createdAt',
    ]));
    const config = getTableConfig(ledger);
    expect(config.indexes.map((value) => value.config.name)).toEqual(expect.arrayContaining([
      'erp_commission_ledger_original_line_unique',
      'erp_commission_ledger_employee_created_idx',
      'erp_commission_ledger_reversal_idx',
    ]));
    expect(config.foreignKeys.map((value) => value.getName())).toContain(
      'erp_commission_ledger_reverses_entry_fk',
    );
    expect(config.foreignKeys.map((value) => value.getName())).toContain(
      'erp_commission_ledger_invoice_reversal_fk',
    );
    expect(config.foreignKeys.map((value) => value.getName())).toContain(
      'erp_commission_ledger_line_reassignment_fk',
    );
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      'erp_commission_ledger_entry_consistent',
      'erp_commission_ledger_amount_direction',
    ]));
  });
});
