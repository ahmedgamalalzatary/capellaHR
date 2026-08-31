import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BranchKioskPage from '../src/app/(attendance)/branch-kiosk/page';
import PersonalDevicePage from '../src/app/(attendance)/personal-device/page';

const detectorMocks = vi.hoisted(() => ({ detect: vi.fn(), close: vi.fn(), create: vi.fn() }));

vi.mock('../src/features/employees/lib/employee-face-detector', () => ({
  createEmployeeFaceDetector: detectorMocks.create,
}));

configure({ asyncUtilTimeout: 3000 });

const session = {
  id: 11,
  employeeId: 7,
  employeeCode: 42,
  employeeName: 'أحمد سالم',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-21',
  requiredMinutes: 480,
  checkInAt: '2026-07-21T06:00:00.000Z',
  checkOutAt: null,
};

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
}));

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{page}</QueryClientProvider>);
}

async function fillCredentials() {
  fireEvent.change(screen.getByLabelText('كود الموظف'), { target: { value: '42' } });
  fireEvent.change(screen.getByLabelText('الرقم السري'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'التقاط الصورة' }));
  await screen.findByRole('button', { name: /إعادة التقاط الصورة/ });
}

beforeEach(() => {
  detectorMocks.create.mockResolvedValue({ detect: detectorMocks.detect, close: detectorMocks.close });
  detectorMocks.detect.mockReturnValue([{
    x: 320, y: 120, width: 640, height: 432,
    leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 },
  }]);
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const data = new Uint8ClampedArray(160 * 120 * 4);
  for (let pixel = 0; pixel < 160 * 120; pixel += 1) {
    const value = pixel % 2 === 0 ? 70 : 150;
    data.set([value, value, value, 255], pixel * 4);
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data, width: 160, height: 120, colorSpace: 'srgb' })),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => 'installation-marker-123'), setItem: vi.fn() },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success: PositionCallback) => success({
        coords: { latitude: 30.0444, longitude: 31.2357, accuracy: 8 },
      } as GeolocationPosition)),
    },
  });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/attendance/check-in')) return response({ data: session }, 201);
    if (url.includes('/attendance/check-out')) return response({ data: { ...session, checkOutAt: '2026-07-21T14:00:00.000Z' } });
    return response({ data: null });
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('personal-device attendance', () => {
  it('captures GPS, sends the paired browser marker, and checks in', async () => {
    renderPage(<PersonalDevicePage />);
    expect(screen.getByRole('heading', { name: 'الحضور من جهازي', level: 1 })).toBeDefined();
    expect(screen.getByRole('link', { name: 'الانتقال إلى هاتف الفرع' }).getAttribute('href')).toBe('/branch-kiosk');
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الحضور' }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/check-in'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    ));
    const attendanceCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes('/attendance/check-in'))!;
    const attendanceForm = (attendanceCall[1] as RequestInit).body as FormData;
    expect(JSON.parse(String(attendanceForm.get('payload')))).toEqual({
      employeeCode: 42,
      pin: '1234',
      source: 'personal_device',
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      installationMarker: 'installation-marker-123',
    });
    expect(attendanceForm.getAll('faceImages')).toHaveLength(8);
    await screen.findByText('أحمد سالم');
    expect(screen.getByRole('status').textContent).toContain('تم تسجيل الحضور');
    expect(screen.getByText('أحمد سالم')).toBeDefined();
  });

  it('supports check-out as an explicit separate action', async () => {
    renderPage(<PersonalDevicePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'تسجيل الانصراف' }));
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الانصراف' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/check-out'),
      expect.objectContaining({ method: 'POST' }),
    ));
    expect((await screen.findByRole('status')).textContent).toContain('تم تسجيل الانصراف');
  });

  it('locks the selected action while verification is in progress', async () => {
    let finishRequest!: () => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finishRequest = () => resolve(new Response(JSON.stringify({ data: session }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));
    renderPage(<PersonalDevicePage />);
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الحضور' }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const checkoutTab = screen.getByRole('tab', { name: 'تسجيل الانصراف' });
    expect((checkoutTab as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(checkoutTab);
    finishRequest();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/attendance/check-in'),
      expect.objectContaining({ method: 'POST' }),
    ));
    expect((await screen.findByRole('status')).textContent).toContain('تم تسجيل الحضور');
  });

  it('supports roving keyboard navigation between attendance actions', () => {
    renderPage(<PersonalDevicePage />);
    const checkIn = screen.getByRole('tab', { name: 'تسجيل الحضور' });
    const checkOut = screen.getByRole('tab', { name: 'تسجيل الانصراف' });
    expect(checkIn.getAttribute('tabindex')).toBe('0');
    expect(checkOut.getAttribute('tabindex')).toBe('-1');
    checkIn.focus();
    fireEvent.keyDown(checkIn, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(checkOut);
    expect(checkOut.getAttribute('aria-selected')).toBe('true');
  });

  it('explains location denial without sending attendance', async () => {
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementationOnce((_success, error) => {
      error?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1 } as GeolocationPositionError);
    });
    renderPage(<PersonalDevicePage />);
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الحضور' }));
    expect((await screen.findByRole('alert')).textContent).toContain('اسمح للموقع');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('shared branch kiosk', () => {
  it('uses the branch-device marker and clears employee identity after success', async () => {
    renderPage(<BranchKioskPage />);
    expect(screen.getByRole('heading', { name: 'هاتف الفرع', level: 1 })).toBeDefined();
    expect(screen.getByRole('link', { name: 'الانتقال إلى جهازي الشخصي' }).getAttribute('href')).toBe('/personal-device');
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الحضور' }));
    await screen.findByText('أحمد سالم');
    expect(screen.getByRole('status').textContent).toContain('تم تسجيل الحضور');
    const eventCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes('/attendance/check-in'))!;
    expect(JSON.parse(String(((eventCall[1] as RequestInit).body as FormData).get('payload'))).source).toBe('branch_device');
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل موظف آخر' }));
    expect((screen.getByLabelText('كود الموظف') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('الرقم السري') as HTMLInputElement).value).toBe('');
  });

  it('shows the server denial without clearing the employee credentials', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => response({
      error: { code: 'ATTENDANCE_OUT_OF_RANGE', message: 'الموقع خارج نطاق الفرع المسموح' },
    }, 409));
    renderPage(<BranchKioskPage />);
    await fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الحضور' }));
    expect((await screen.findByRole('alert')).textContent).toContain('الموقع خارج نطاق الفرع المسموح');
    expect((screen.getByLabelText('كود الموظف') as HTMLInputElement).value).toBe('42');
    expect((screen.getByLabelText('الرقم السري') as HTMLInputElement).value).toBe('1234');
    expect(screen.getByLabelText('كود الموظف').getAttribute('autocomplete')).toBe('off');
    expect(screen.getByLabelText('الرقم السري').getAttribute('autocomplete')).toBe('off');
    expect((screen.getByRole('button', { name: 'إعادة المحاولة' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
