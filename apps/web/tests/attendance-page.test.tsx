import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AttendancePage from '../src/app/(admin)/attendance/page';

const session = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'أحمد سالم',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-20',
  requiredMinutes: 480,
  checkInAt: '2026-07-20T06:00:00.000Z',
  checkOutAt: '2026-07-20T14:30:00.000Z',
  workedMinutes: 510,
  overtimeMinutes: 30,
  shortageMinutes: 0,
  automaticTimeoutAt: '2026-07-20T22:00:00.000Z',
  automaticTimeoutCorrectedAt: null,
  flagged: true,
  createdAt: '2026-07-20T06:00:00.000Z',
  updatedAt: '2026-07-20T14:30:00.000Z',
};

const attempt = {
  id: 21,
  eventType: 'check_in',
  claimedEmployeeCode: 42,
  employeeId: 7,
  source: 'personal_device',
  deviceId: 4,
  occurredAt: '2026-07-20T05:55:00.000Z',
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  distanceMeters: 225,
  branchLatitude: 30.05,
  branchLongitude: 31.24,
  branchRadiusMeters: 100,
  failureReason: 'OUT_OF_RANGE',
  suspicious: true,
  approvedAt: null,
  approvedSessionId: null,
  dismissedAt: null,
  createdAt: '2026-07-20T05:55:00.000Z',
};
const dismissibleAttempt = {
  ...attempt,
  id: 22,
  claimedEmployeeCode: 43,
  failureReason: 'DEVICE_INVALID',
};
const unknownAttempt = {
  ...attempt,
  id: 23,
  claimedEmployeeCode: 999,
  employeeId: null,
  deviceId: null,
  failureReason: 'EMPLOYEE_NOT_FOUND',
};

const absence = {
  id: 31,
  employeeId: 8,
  employeeCode: 43,
  employeeName: 'منى علي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-19',
  status: 'absence',
  absenceRequiredMinutes: 480,
  requiredMinutes: 480,
  dayOffConvertedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const page = (items: unknown[], meta: Partial<Record<'page' | 'pageSize' | 'total' | 'totalPages', number>> = {}) => ({
  data: items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
}));

function installFetch() {
  type DeniedFixture = Omit<typeof attempt, 'employeeId' | 'deviceId' | 'approvedAt' | 'approvedSessionId' | 'dismissedAt'> & {
    employeeId: number | null;
    deviceId: number | null;
    approvedAt: string | null;
    approvedSessionId: number | null;
    dismissedAt: string | null;
  };
  let deniedAttempts: DeniedFixture[] = [attempt, dismissibleAttempt, unknownAttempt];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/attendance/sessions') && init?.method === 'PATCH') {
      return response({ data: { ...session, automaticTimeoutCorrectedAt: '2026-07-21T08:00:00.000Z' } });
    }
    if (url.includes('/attendance/sessions')) return response(page([session]));
    if (url.includes('/attendance/denied-attempts') && init?.method === 'POST') {
      const id = url.includes('/22/') ? 22 : 21;
      if (url.endsWith('/approve')) {
        deniedAttempts = deniedAttempts.map((item) => item.id === id
          ? { ...item, approvedAt: '2026-07-21T08:00:00.000Z', approvedSessionId: 11 }
          : item);
        return response({ data: session });
      }
      deniedAttempts = deniedAttempts.map((item) => item.id === id
        ? { ...item, dismissedAt: '2026-07-21T08:00:00.000Z' }
        : item);
      return response({ data: deniedAttempts.find((item) => item.id === id) });
    }
    if (url.includes('/attendance/denied-attempts')) {
      return response(page(url.includes('approvalState=pending')
        ? deniedAttempts.filter((item) => !item.approvedAt && !item.dismissedAt)
        : deniedAttempts));
    }
    if (url.includes('/attendance/manual/')) return response({ data: session });
    if (url.includes('/weekly-day-offs')) return response(page([absence]));
    if (url.includes('/employees')) return response(page([{
      id: 7, employeeCode: 42, fullName: 'أحمد سالم', branchId: 3,
    }]));
    if (url.includes('/branches')) return response(page([{ id: 3, name: 'فرع القاهرة' }]));
    return response({ data: null });
  }));
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
    <QueryClientProvider client={queryClient}>
      <AttendancePage />
    </QueryClientProvider>,
    ),
  };
}

beforeEach(installFetch);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AttendancePage', () => {
  it('renders an accessible attendance operations ledger with real session data', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'الحضور والغياب', level: 1 })).toBeDefined();
    const sessionsTab = screen.getByRole('tab', { name: 'سجل الحضور' });
    expect(sessionsTab.getAttribute('aria-selected')).toBe('true');
    expect(sessionsTab.getAttribute('aria-controls')).toBe('attendance-panel-sessions');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('attendance-tab-sessions');
    const row = (await screen.findByText('أحمد سالم')).closest('tr')!;
    expect(within(row).getByText('42')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText('8:30')).toBeDefined();
    expect(within(row).getByText('خروج تلقائي')).toBeDefined();
  });

  it('supports combined session filters and an explicit reset', async () => {
    renderPage();
    await screen.findByText('أحمد سالم');
    fireEvent.change(screen.getByRole('searchbox', { name: 'بحث في سجلات الحضور' }), {
      target: { value: 'أحمد' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    fireEvent.change(screen.getByLabelText('حالة الجلسة'), { target: { value: 'closed' } });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      expect.stringMatching(/attendance\/sessions\?.*search=.*&.*state=closed|attendance\/sessions\?.*state=closed&.*search=/),
      expect.anything(),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط التصفية' }));
    await waitFor(() => expect((screen.getByLabelText('حالة الجلسة') as HTMLSelectElement).value).toBe(''));
  });

  it('explains when an automatic-timeout correction is not a real Cairo wall time', async () => {
    renderPage();
    await screen.findByText('أحمد سالم');
    fireEvent.click(screen.getByRole('button', { name: 'تصحيح وقت الانصراف' }));
    fireEvent.change(screen.getByLabelText('وقت الانصراف المصحح'), {
      target: { value: '2026-04-24T00:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التصحيح' }));

    expect((await screen.findByRole('alert')).textContent).toContain('أدخل وقتًا صالحًا بتوقيت القاهرة.');
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('records separate manual check-in and check-out actions using Cairo wall time', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'تسجيل يدوي' }));
    await screen.findByRole('option', { name: '42 — أحمد سالم' });
    fireEvent.change(screen.getByLabelText('الموظف'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('وقت الحدث بتوقيت القاهرة'), {
      target: { value: '2026-07-20T09:15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل حضور يدوي' }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/manual/check-in'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('2026-07-20T09:15:00.000+03:00'),
      }),
    ));

    fireEvent.click(screen.getByRole('tab', { name: 'تسجيل انصراف' }));
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل انصراف يدوي' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/manual/check-out'),
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('reviews denied attempts through approve and dismiss actions', async () => {
    const { queryClient } = renderPage();
    queryClient.setQueryData(['payroll', 'preview'], { stale: true });
    queryClient.setQueryData(['reports', 'view'], { stale: true });
    queryClient.setQueryData(['weekly-day-off', 'list'], { stale: true });
    fireEvent.click(screen.getByRole('tab', { name: 'المحاولات المرفوضة' }));
    const row = (await screen.findByText('خارج نطاق الفرع')).closest('tr')!;
    expect(within(row).getByText('مشتبه بها')).toBeDefined();
    fireEvent.click(within(row).getByRole('button', { name: 'اعتماد المحاولة' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/denied-attempts/21/approve'),
      expect.objectContaining({ method: 'POST' }),
    ));
    const dismissRow = (await screen.findByText('الجهاز غير مسجل أو ملغى')).closest('tr')!;
    fireEvent.click(within(dismissRow).getByRole('button', { name: 'رفض نهائي' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/denied-attempts/22/dismiss'),
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(queryClient.getQueryState(['payroll', 'preview'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['reports', 'view'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['weekly-day-off', 'list'])?.isInvalidated).toBe(true);
  });

  it('offers only dismissal when a denied attempt has no known employee', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'المحاولات المرفوضة' }));
    const row = (await screen.findByText('999')).closest('tr')!;
    expect(within(row).getByText('الموظف غير موجود')).toBeDefined();
    expect(within(row).queryByRole('button', { name: 'اعتماد المحاولة' })).toBeNull();
    expect(within(row).getByText('تعذر تحديد الموظف؛ يمكن الرفض النهائي فقط.')).toBeDefined();
    expect(within(row).getByRole('button', { name: 'رفض نهائي' })).toBeDefined();
  });

  it('filters flagged attempts separately from ordinary denials', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'المحاولات المرفوضة' }));
    await screen.findByText('خارج نطاق الفرع');
    fireEvent.change(screen.getByLabelText('نوع المحاولة'), { target: { value: 'true' } });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('suspicious=true'),
      expect.anything(),
    ));
  });

  it('returns to page one after reviewing the final pending row on a later page', async () => {
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let reviewed = false;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/attendance/denied-attempts') && init?.method === 'POST') {
        reviewed = true;
        return response({ data: session });
      }
      if (url.includes('/attendance/denied-attempts')) {
        if (url.includes('page=2')) return response(page(reviewed ? [] : [attempt], {
          page: 2, total: reviewed ? 20 : 21, totalPages: reviewed ? 1 : 2,
        }));
        return response(page([dismissibleAttempt], { total: reviewed ? 20 : 21, totalPages: reviewed ? 1 : 2 }));
      }
      return normalFetch(input, init);
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'المحاولات المرفوضة' }));
    await screen.findByText('الجهاز غير مسجل أو ملغى');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    const row = (await screen.findByText('خارج نطاق الفرع')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'اعتماد المحاولة' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => (
      reviewed && String(input).includes('/attendance/denied-attempts') && String(input).includes('page=1')
    ))).toBe(true));
    expect(await screen.findByText('الجهاز غير مسجل أو ملغى')).toBeDefined();
  });

  it('supports roving keyboard navigation for the main and manual tabs', async () => {
    renderPage();
    const sessions = screen.getByRole('tab', { name: 'سجل الحضور' });
    const denied = screen.getByRole('tab', { name: 'المحاولات المرفوضة' });
    expect(sessions.getAttribute('tabindex')).toBe('0');
    expect(denied.getAttribute('tabindex')).toBe('-1');
    sessions.focus();
    fireEvent.keyDown(sessions, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(denied);
    expect(denied.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'تسجيل يدوي' }));
    const checkIn = screen.getByRole('tab', { name: 'تسجيل حضور' });
    const checkOut = screen.getByRole('tab', { name: 'تسجيل انصراف' });
    checkIn.focus();
    fireEvent.keyDown(checkIn, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(checkOut);
    expect(screen.getByRole('tabpanel', { name: 'تسجيل انصراف' })).toBeDefined();
  });

  it('shows automatic absences and allows correcting only automatic timeouts', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'الغياب وأيام الراحة' }));
    expect(await screen.findByText('منى علي')).toBeDefined();
    expect(screen.getAllByText('غياب').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: 'سجل الحضور' }));
    const row = (await screen.findByText('أحمد سالم')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تصحيح وقت الانصراف' }));
    fireEvent.change(screen.getByLabelText('وقت الانصراف المصحح'), {
      target: { value: '2026-07-20T17:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التصحيح' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/sessions/11/automatic-timeout'),
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('filters the absence register and resets it explicitly', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'الغياب وأيام الراحة' }));
    await screen.findByText('منى علي');
    fireEvent.change(screen.getByRole('searchbox', { name: 'بحث في سجل الغياب' }), {
      target: { value: 'منى' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    fireEvent.change(screen.getByLabelText('حالة الغياب'), { target: { value: 'absence' } });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringMatching(/weekly-day-offs\?.*search=.*&.*status=absence|weekly-day-offs\?.*status=absence&.*search=/),
      expect.anything(),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة ضبط التصفية' }));
    expect((screen.getByLabelText('حالة الغياب') as HTMLSelectElement).value).toBe('');
  });

  it('shows a retry state when loading fails instead of hiding the error', async () => {
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let failSessions = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (failSessions && String(input).includes('/attendance/sessions')) {
        failSessions = false;
        return response({
          error: { code: 'INTERNAL_ERROR', message: 'تعذر تحميل سجل الحضور' },
        }, 500);
      }
      return normalFetch(input, init);
    });
    renderPage();
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    expect(screen.getByRole('alert').textContent).toContain('تعذر تحميل سجل الحضور');
    fireEvent.click(retry);
    expect(await screen.findByText('أحمد سالم')).toBeDefined();
  });
});
