import type { ReportFilters, ReportSelection, ReportSnapshot, ReportType } from '@capella/contracts';
import { employees } from '@capella/database/schema';
import { asc } from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
import { calendarMonthInTimeZone } from '../payroll/index.js';
import { readAttendanceReport } from './reports-reader-attendance.js';
import {
  readAdvancesReport,
  readBonusesOrDeductionsReport,
} from './reports-reader-financial.js';
import {
  employeeFilters,
  moneyCents,
  moneyFromCents,
  monthsBetween,
  payrollReportRow,
  snapshotTransactionConfig,
  whereFrom,
  type Executor,
  type Pagination,
  type ReportsPayrollGateway,
  type Row,
} from './reports-reader-helpers.js';
import {
  readBranchesReport,
  readDevicesReport,
  readEmployeesOrShiftsReport,
  readWeeklyDayOffReport,
} from './reports-reader-organization.js';
import { readPayrollReport } from './reports-reader-payroll.js';
import type { ReportReader } from './reports-service.js';

export type { ReportsPayrollGateway } from './reports-reader-helpers.js';

export const createDrizzleReportReader = (
  database: Database,
  options: {
    timeZone?: string;
    now?: () => Date;
    payroll?: ReportsPayrollGateway;
    maxInteractivePayrollCandidates?: number;
  } = {},
): ReportReader => {
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const now = options.now ?? (() => new Date());
  const maxInteractivePayrollCandidates = options.maxInteractivePayrollCandidates ?? 5_000;
  if (!Number.isSafeInteger(maxInteractivePayrollCandidates) || maxInteractivePayrollCandidates < 1) {
    throw new Error('maxInteractivePayrollCandidates must be a positive safe integer');
  }
  // Validate configuration at construction instead of failing during a request.
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
  const readWith = async (
    executor: Executor,
    reportType: ReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    pagination: Pagination,
    generatedAt: Date,
  ): ReturnType<ReportReader['read']> => {
    const args = [executor, reportType, filters, selection, pagination, generatedAt] as const;

    if (reportType === 'attendance') return readAttendanceReport(...args);
    if (reportType === 'payroll') {
      return readPayrollReport(...args, {
        timeZone, now, payroll: options.payroll, maxInteractivePayrollCandidates,
      });
    }
    if (reportType === 'branches') return readBranchesReport(...args, { timeZone });
    if (reportType === 'employees' || reportType === 'shifts') {
      return readEmployeesOrShiftsReport(...args, { timeZone });
    }
    if (reportType === 'devices') return readDevicesReport(...args, { timeZone });
    if (reportType === 'weekly-day-off') return readWeeklyDayOffReport(...args);
    if (reportType === 'bonuses' || reportType === 'deductions') {
      return readBonusesOrDeductionsReport(...args, { timeZone });
    }
    return readAdvancesReport(...args, { timeZone });
  };

  return {
    read(reportType, filters, selection, pagination, generatedAt) {
      if (reportType === 'payroll' && !options.payroll) {
        return Promise.resolve({ kind: 'unavailable' as const });
      }
      return database.transaction((transaction) => readWith(
        transaction,
        reportType,
        filters,
        selection,
        pagination,
        generatedAt,
      ), snapshotTransactionConfig);
    },

    readBatches(reportType, filters, selection, batchSize, generatedAt, onBatch) {
      if (reportType === 'payroll' && !options.payroll) {
        return Promise.resolve({ kind: 'unavailable' as const });
      }
      return database.transaction(async (transaction) => {
        if (reportType === 'payroll') {
          const currentMonth = calendarMonthInTimeZone(now(), timeZone);
          const monthFrom = filters.monthFrom ?? currentMonth;
          const monthTo = filters.monthTo ?? currentMonth;
          if (monthTo > currentMonth) return { kind: 'unavailable' as const };

          const metadata = await readWith(
            transaction,
            reportType,
            filters,
            { mode: 'selected', ids: [0] },
            { page: 1, pageSize: 1 },
            generatedAt,
          );
          if (metadata.kind === 'unavailable') return metadata;
          const header: Omit<ReportSnapshot, 'rows'> = {
            reportType: metadata.snapshot.reportType,
            title: metadata.snapshot.title,
            generatedAt: metadata.snapshot.generatedAt,
            columns: metadata.snapshot.columns,
            summary: metadata.snapshot.summary,
          };

          // Payroll belongs to the branch assigned for that month, so the branch filter is
          // applied to the computed payroll instead of the employee's current branch.
          const payrollFilters = { ...filters, branchId: undefined };
          const employeePageSize = Math.max(1, Math.min(batchSize, 250));
          let batch: Row[] = [];
          let rowCount = 0;
          let openRecords = 0;
          let finalizedRecords = 0;
          let totalNetSalaryCents = 0n;
          for (const month of monthsBetween(monthFrom, monthTo)) {
            let employeeOffset = 0;
            while (true) {
              const employeeRows = await transaction.select({ id: employees.id, deletedAt: employees.deletedAt })
                .from(employees).where(whereFrom(employeeFilters(payrollFilters, selection)))
                .orderBy(asc(employees.employeeCode))
                .limit(employeePageSize).offset(employeeOffset);
              if (!employeeRows.length) break;
              employeeOffset += employeeRows.length;
              for (const employee of employeeRows) {
                const result = await options.payroll!.preview(employee.id, month, transaction);
                if (result.kind === 'blocked') return { kind: 'unavailable' as const };
                if (result.kind !== 'success') continue;
                if (filters.branchId !== undefined && result.payroll.branchId !== filters.branchId) continue;
                batch.push(payrollReportRow(result.payroll, Boolean(employee.deletedAt)));
                rowCount += 1;
                if (result.payroll.status === 'open') openRecords += 1;
                else finalizedRecords += 1;
                totalNetSalaryCents += moneyCents(result.payroll.netSalary);
                if (batch.length === batchSize) {
                  await onBatch(batch);
                  batch = [];
                }
              }
              if (employeeRows.length < employeePageSize) break;
            }
          }
          if (batch.length) await onBatch(batch);
          return {
            kind: 'success' as const,
            snapshot: {
              ...header,
              summary: {
                totalRecords: rowCount,
                openRecords,
                finalizedRecords,
                totalNetSalary: moneyFromCents(totalNetSalaryCents),
              },
            },
            total: rowCount,
            rowCount,
          };
        }

        let page = 1;
        let rowCount = 0;
        let total = 0;
        let header: Omit<ReportSnapshot, 'rows'> | undefined;
        do {
          const result = await readWith(
            transaction,
            reportType,
            filters,
            selection,
            { page, pageSize: batchSize },
            generatedAt,
          );
          if (result.kind === 'unavailable') return result;
          const { rows, ...currentHeader } = result.snapshot;
          header ??= currentHeader;
          total = result.total;
          if (!rows.length) break;
          await onBatch(rows);
          rowCount += rows.length;
          page += 1;
        } while (rowCount < total);

        if (!header) throw new Error(`Report ${reportType} did not provide snapshot metadata`);
        return { kind: 'success' as const, snapshot: header, total, rowCount };
      }, snapshotTransactionConfig);
    },
  };
};
