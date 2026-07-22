import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from '../src/app/(admin)/dashboard/page';

const snapshot = {
  generatedAt: '2026-07-20T09:00:00.000Z',
  cairoDate: '2026-07-20',
  payrollMonth: '2026-06',
  currentlyCheckedIn: { total: 1, items: [{
    employeeId: 1, employeeCode: 1, employeeName: 'حاضر الآن', branchId: 1, branchName: 'القاهرة',
    sessionId: 11, attendanceDate: '2026-07-20', checkInAt: '2026-07-20T06:00:00.000Z',
  }] },
  previousDayOpen: { total: 1, items: [{
    employeeId: 2, employeeCode: 2, employeeName: 'جلسة سابقة مفتوحة', branchId: 1, branchName: 'القاهرة',
    sessionId: 12, attendanceDate: '2026-07-19', checkInAt: '2026-07-19T18:00:00.000Z',
  }] },
  notCheckedIn: { total: 1, items: [{
    employeeId: 3, employeeCode: 3, employeeName: 'لم يحضر', branchId: 1, branchName: 'القاهرة',
  }] },
  latestDailyRecords: { items: [{
    id: 21, employeeId: 3, employeeCode: 3, employeeName: 'لم يحضر', branchId: 1, branchName: 'القاهرة',
    attendanceDate: '2026-07-18', status: 'absence', occurredAt: '2026-07-19T00:00:00.000Z',
  }] },
  attendanceReview: { unresolvedTotal: 1, flaggedTotal: 1, items: [{
    id: 31, claimedEmployeeCode: 3, employeeId: 3, employeeName: 'لم يحضر',
    eventType: 'check_in', source: 'personal_device', failureReason: 'OUT_OF_RANGE',
    suspicious: true, occurredAt: '2026-07-20T08:00:00.000Z',
  }] },
  automaticTimeouts: { total: 1, items: [{
    employeeId: 5, employeeCode: 5, employeeName: 'خروج تلقائي', branchId: 1, branchName: 'القاهرة',
    sessionId: 15, attendanceDate: '2026-07-18', checkInAt: '2026-07-18T05:00:00.000Z',
    automaticTimeoutAt: '2026-07-18T21:00:00.000Z', correctedAt: null,
  }] },
  devicePairings: { pendingTotal: 2, replacementTotal: 1, items: [{
    id: 41, kind: 'replacement', assignmentType: 'employee', assignmentId: 1,
    assignmentName: 'حاضر الآن', createdAt: '2026-07-20T08:00:00.000Z',
  }] },
  payrollBlockers: { total: 1, items: [{
    employeeId: 3, employeeCode: 3, employeeName: 'لم يحضر', branchId: 1, branchName: 'القاهرة',
    reasons: ['ATTENDANCE_RECONCILIATION_PENDING'],
  }] },
  pdfExports: { queued: 1, processing: 1, completed: 4, failed: 1, items: [{
    id: 51, reportType: 'attendance', status: 'failed', attemptCount: 3, retryCount: 0,
    failureReason: 'PDF_EXPORT_FAILED', queuedAt: '2026-07-20T07:00:00.000Z', updatedAt: '2026-07-20T09:00:00.000Z',
  }] },
};

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
}));

const renderPage = (retry: false | number = false) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => response({ data: snapshot })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('renders the complete operational ledger and links every summary to its owner', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'لوحة عمليات اليوم', level: 1 })).toBeDefined();
    for (const heading of [
      'الحضور الآن', 'جلسات من يوم سابق', 'لم يسجلوا الحضور', 'آخر الغياب وأيام الراحة',
      'محاولات تحتاج مراجعة', 'الخروج التلقائي', 'ربط واستبدال الأجهزة',
      'عوائق اعتماد الرواتب', 'حالة تصدير PDF',
    ]) expect(screen.getByRole('heading', { name: heading })).toBeDefined();

    expect(screen.getAllByText('حاضر الآن').length).toBeGreaterThan(0);
    expect(screen.getByText('جلسة سابقة مفتوحة')).toBeDefined();
    expect(screen.getAllByText('لم يحضر').length).toBeGreaterThan(0);
    expect(screen.getByText('خارج نطاق الفرع')).toBeDefined();
    expect(screen.getByText('بيانات الحضور غير مكتملة')).toBeDefined();
    expect(screen.getAllByText('فشل').length).toBeGreaterThan(0);

    expect(screen.getByRole('link', { name: 'فتح سجل الحضور' }).getAttribute('href')).toBe('/attendance');
    expect(screen.getByRole('link', { name: 'فتح أيام الراحة' }).getAttribute('href')).toBe('/weekly-day-off');
    expect(screen.getByRole('link', { name: 'فتح الأجهزة' }).getAttribute('href')).toBe('/devices');
    expect(screen.getByRole('link', { name: 'فتح الرواتب' }).getAttribute('href')).toBe('/payroll');
    expect(screen.getByRole('link', { name: 'فتح التقارير' }).getAttribute('href')).toBe('/reports');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/dashboard'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('does not retry a failed snapshot automatically and provides an explicit retry', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({ error: { code: 'INTERNAL_ERROR', message: 'تعذر تحميل لوحة العمليات' } }, 500))
      .mockImplementationOnce(() => response({ data: snapshot }));
    renderPage(2);

    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    expect((await screen.findAllByText('حاضر الآن')).length).toBeGreaterThan(0);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
