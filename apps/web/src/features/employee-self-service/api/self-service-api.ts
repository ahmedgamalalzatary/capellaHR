import type {
  SelfServiceFinancialListQuery,
  SelfServiceWeeklyDayListQuery,
} from '@capella/contracts';

import { api } from '@/lib/api/client';

import type {
  SelfServiceAdjustment,
  SelfServiceAdvance,
  SelfServiceOverview,
  SelfServicePayroll,
  SelfServiceWeeklyDay,
} from '../types';

const queryString = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
};

export const getSelfServiceOverview = () => api.get<SelfServiceOverview>('/self-service/overview');

export const listSelfServiceWeeklyDays = (query: Partial<SelfServiceWeeklyDayListQuery> = {}) => (
  api.getPage<SelfServiceWeeklyDay>(`/self-service/weekly-days${queryString(query)}`)
);

export const getSelfServicePayrollMonth = (month: string) => (
  api.get<SelfServicePayroll>(`/self-service/payroll/${encodeURIComponent(month)}`)
);

export const listSelfServiceBonuses = (query: Partial<SelfServiceFinancialListQuery> = {}) => (
  api.getPage<SelfServiceAdjustment>(`/self-service/bonuses${queryString(query)}`)
);

export const listSelfServiceDeductions = (query: Partial<SelfServiceFinancialListQuery> = {}) => (
  api.getPage<SelfServiceAdjustment>(`/self-service/deductions${queryString(query)}`)
);

export const listSelfServiceAdvances = (query: Partial<SelfServiceFinancialListQuery> = {}) => (
  api.getPage<SelfServiceAdvance>(`/self-service/advances${queryString(query)}`)
);
