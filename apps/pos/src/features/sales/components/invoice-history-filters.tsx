'use client';

import { useEffect, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';

import { Input, Label } from '@capella/ui';

import { Select } from '@/components/form/select';
import { listActiveEmployeeOptions } from '@/features/cashier-accounts';
import { fetchAllPages } from '@/lib/api/fetch-all';

export type InvoiceHistoryStatusFilter = '' | 'completed' | 'partially_refunded' | 'refunded' | 'voided';
export type InvoiceHistorySettlementFilter = '' | 'settled' | 'open';
export type InvoiceHistoryOrderBy = 'soldAt' | 'total' | 'balanceDue' | 'invoiceNumber';
export type InvoiceHistoryOrderDir = 'asc' | 'desc';

export interface InvoiceHistoryFilterValues {
  status: InvoiceHistoryStatusFilter;
  settlementStatus: InvoiceHistorySettlementFilter;
  fromDate: string;
  toDate: string;
  employeeId: number | undefined;
  orderBy: InvoiceHistoryOrderBy;
  orderDir: InvoiceHistoryOrderDir;
}

export const defaultInvoiceHistoryFilters: InvoiceHistoryFilterValues = {
  status: '',
  settlementStatus: '',
  fromDate: '',
  toDate: '',
  employeeId: undefined,
  orderBy: 'soldAt',
  orderDir: 'desc',
};

const statusOptions = [
  { value: '', label: 'كل الحالات' },
  { value: 'completed', label: 'مكتملة' },
  { value: 'partially_refunded', label: 'مستردة جزئيًا' },
  { value: 'refunded', label: 'مستردة' },
  { value: 'voided', label: 'ملغاة' },
] as const;

const settlementOptions = [
  { value: '', label: 'كل التسويات' },
  { value: 'open', label: 'متبقي' },
  { value: 'settled', label: 'مسددة' },
] as const;

const orderByOptions = [
  { value: 'soldAt', label: 'تاريخ البيع' },
  { value: 'total', label: 'الإجمالي' },
  { value: 'balanceDue', label: 'المتبقي' },
  { value: 'invoiceNumber', label: 'رقم الفاتورة' },
] as const;

const orderDirOptions = [
  { value: 'desc', label: 'تنازلي' },
  { value: 'asc', label: 'تصاعدي' },
] as const;

export function InvoiceHistoryFilters({
  idPrefix,
  values,
  onChange,
  branchId,
}: {
  idPrefix: string;
  values: InvoiceHistoryFilterValues;
  onChange: (next: InvoiceHistoryFilterValues) => void;
  /** Employee options are branch-scoped; the control hides without a branch. */
  branchId: number | undefined;
}) {
  const employees = useQuery({
    queryKey: ['erp-sales', 'invoice-employee-options', branchId],
    queryFn: () => fetchAllPages((page) => listActiveEmployeeOptions(page, branchId)),
    enabled: branchId !== undefined,
  });
  const set = (patch: Partial<InvoiceHistoryFilterValues>) => onChange({ ...values, ...patch });
  /**
   * Employee options are branch-scoped, so a selection from the previous
   * branch must not leak into the new branch's query. Clearing lives here —
   * the single shared flow — so both invoice views (and the ?branchId=
   * seeding path, not just the select) reset it before the updated branch
   * is used. Untouched when the branch is unchanged.
   */
  const previousBranchId = useRef(branchId);
  useEffect(() => {
    if (previousBranchId.current !== branchId) {
      previousBranchId.current = branchId;
      if (values.employeeId !== undefined) onChange({ ...values, employeeId: undefined });
    }
  }, [branchId, values, onChange]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-status`}>الحالة</Label>
        <Select
          id={`${idPrefix}-status`}
          value={values.status}
          onChange={(event) => set({ status: event.target.value as InvoiceHistoryStatusFilter })}
        >
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-settlement`}>التسوية</Label>
        <Select
          id={`${idPrefix}-settlement`}
          value={values.settlementStatus}
          onChange={(event) => set({ settlementStatus: event.target.value as InvoiceHistorySettlementFilter })}
        >
          {settlementOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-from`}>من تاريخ</Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={values.fromDate}
          onChange={(event) => set({ fromDate: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-to`}>إلى تاريخ</Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={values.toDate}
          onChange={(event) => set({ toDate: event.target.value })}
        />
      </div>
      {branchId === undefined ? null : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-employee`}>الموظف</Label>
          <Select
            id={`${idPrefix}-employee`}
            disabled={employees.isPending || employees.isError}
            value={values.employeeId ?? ''}
            onChange={(event) => set({ employeeId: event.target.value ? Number(event.target.value) : undefined })}
          >
            <option value="">كل الموظفين</option>
            {employees.data?.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.fullName}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-order-by`}>الترتيب</Label>
        <Select
          id={`${idPrefix}-order-by`}
          value={values.orderBy}
          onChange={(event) => set({ orderBy: event.target.value as InvoiceHistoryOrderBy })}
        >
          {orderByOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-order-dir`}>الاتجاه</Label>
        <Select
          id={`${idPrefix}-order-dir`}
          value={values.orderDir}
          onChange={(event) => set({ orderDir: event.target.value as InvoiceHistoryOrderDir })}
        >
          {orderDirOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
    </div>
  );
}
