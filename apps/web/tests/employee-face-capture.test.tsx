import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const detect = vi.fn();
const close = vi.fn();

vi.mock('../src/features/employees/lib/employee-face-detector', () => ({
  createEmployeeFaceDetector: vi.fn(async () => ({ detect, close })),
}));

import { EmployeeFaceCapture } from '../src/features/employees/components/employee-face-capture';

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
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
  detect.mockReturnValue([{ x: 5, y: 4, width: 10, height: 12, leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 } }]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('shows live face quality and captures a validated JPEG as a File', async () => {
  const onChange = vi.fn();
  render(<EmployeeFaceCapture value={null} onChange={onChange} disabled={false} />);

  fireEvent.click(screen.getByRole('button', { name: 'فتح كاميرا الوجه' }));
  const video = await screen.findByLabelText('معاينة صورة وجه الموظف');
  Object.defineProperties(video, { videoWidth: { value: 20 }, videoHeight: { value: 20 } });
  fireEvent.loadedData(video);

  await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'));
  expect(screen.getByText('الصورة جاهزة للتسجيل')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'استخدام هذه الصورة' }));

  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  const captured = onChange.mock.calls[0]?.[0] as File;
  expect(captured).toBeInstanceOf(File);
  expect(captured.name).toBe('personal.jpg');
  expect(captured.type).toBe('image/jpeg');
});

it('blocks capture and explains when no face is visible', async () => {
  detect.mockReturnValue([]);
  render(<EmployeeFaceCapture value={null} onChange={vi.fn()} disabled={false} />);

  fireEvent.click(screen.getByRole('button', { name: 'فتح كاميرا الوجه' }));
  const video = await screen.findByLabelText('معاينة صورة وجه الموظف');
  Object.defineProperties(video, { videoWidth: { value: 20 }, videoHeight: { value: 20 } });
  fireEvent.loadedData(video);

  await screen.findByText('ضع وجهًا واحدًا داخل الإطار');
  expect((screen.getByRole('button', { name: 'استخدام هذه الصورة' }) as HTMLButtonElement).disabled).toBe(true);
});
