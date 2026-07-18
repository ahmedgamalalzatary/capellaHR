import type { WeeklyDayRecordStatus } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

/**
 * A daily absence record that may be converted into a weekly day off.
 * Records are created by Attendance only; the admin can just flip the status.
 */
export interface WeeklyDayRecord {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  attendanceDate: string;
  status: WeeklyDayRecordStatus;
  absenceRequiredMinutes: number;
  requiredMinutes: number;
  dayOffConvertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListWeeklyDayRecordsParams {
  search?: string;
  employeeId?: number;
  branchId?: number;
  status?: WeeklyDayRecordStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function listWeeklyDayRecords(
  params: ListWeeklyDayRecordsParams = {},
): Promise<{ items: WeeklyDayRecord[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.employeeId !== undefined) query.set('employeeId', String(params.employeeId));
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.status !== undefined) query.set('status', params.status);
  if (params.dateFrom !== undefined) query.set('dateFrom', params.dateFrom);
  if (params.dateTo !== undefined) query.set('dateTo', params.dateTo);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<WeeklyDayRecord>(`/weekly-day-offs${suffix}`);
}

export function getWeeklyDayRecord(recordId: number): Promise<WeeklyDayRecord> {
  return api.get<WeeklyDayRecord>(`/weekly-day-offs/${recordId}`);
}

/** Marks an eligible past absence as the employee's weekly day off. */
export function convertWeeklyDayRecord(recordId: number): Promise<WeeklyDayRecord> {
  return api.post<WeeklyDayRecord>(`/weekly-day-offs/${recordId}/convert`);
}

/** Restores a weekly day off to its original absence snapshot. */
export function revertWeeklyDayRecord(recordId: number): Promise<WeeklyDayRecord> {
  return api.post<WeeklyDayRecord>(`/weekly-day-offs/${recordId}/revert`);
}
