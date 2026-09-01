import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const detectorMocks = vi.hoisted(() => ({
  detect: vi.fn(),
  close: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../src/features/employees/lib/employee-face-detector', () => ({
  createEmployeeFaceDetector: detectorMocks.create,
}));

import { AttendanceCameraCapture } from '../src/features/attendance/components/attendance-camera-capture';

const qualityData = new Uint8ClampedArray(160 * 120 * 4);
for (let pixel = 0; pixel < 160 * 120; pixel += 1) {
  const value = pixel % 2 === 0 ? 70 : 150;
  qualityData.set([value, value, value, 255], pixel * 4);
}
const qualityContext = () => ({
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: qualityData, width: 160, height: 120, colorSpace: 'srgb' })),
} as unknown as CanvasRenderingContext2D);

beforeEach(() => {
  detectorMocks.create.mockResolvedValue({
    detect: detectorMocks.detect,
    close: detectorMocks.close,
  });
  detectorMocks.detect.mockReturnValue([{
    x: 320, y: 120, width: 640, height: 432,
    leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 },
  }]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('uses a non-square preview and blocks capture until live face quality is green', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(qualityContext());

  render(<AttendanceCameraCapture value={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  expect(video.className).toContain('aspect-video');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });

  detectorMocks.detect.mockReturnValueOnce([]);
  fireEvent.loadedData(video);
  await waitFor(() => expect(screen.getByRole('progressbar').className).toContain('bg-danger'));
  expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(true);

  detectorMocks.detect.mockReturnValueOnce([{
    x: 320, y: 120, width: 640, height: 432,
    leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 },
  }]);
  fireEvent.loadedData(video);
  await waitFor(() => expect(screen.getByRole('progressbar').className).toContain('bg-success'));
  expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false);
});

it('captures distinct temporal JPEG frames before stopping the camera tracks', async () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(qualityContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([String(Math.random())], { type: 'image/jpeg' })));
  const onChange = vi.fn();

  render(<AttendanceCameraCapture value={null} onChange={onChange} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'التقاط الصورة' }));

  await waitFor(() => expect(onChange).toHaveBeenCalledOnce(), { timeout: 2500 });
  const frames = onChange.mock.calls[0]?.[0] as Blob[];
  expect(frames).toHaveLength(8);
  expect(new Set(frames).size).toBe(8);
  expect(stop).toHaveBeenCalledOnce();
});

it('fills the camera and preview frame like employee capture without black side bars', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(qualityContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));
  const createObjectURL = vi.fn(() => 'blob:portrait-frame');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

  const view = render(<AttendanceCameraCapture value={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 720 }, videoHeight: { value: 1280 } });

  expect(video.className).toContain('object-cover');
  expect(video.className).not.toContain('object-contain');

  const first = new Blob(['first'], { type: 'image/jpeg' });
  const last = new Blob(['last'], { type: 'image/jpeg' });
  view.unmount();
  render(<AttendanceCameraCapture value={[first, last]} onChange={vi.fn()} disabled={false} />);
  const preview = await screen.findByAltText('الصورة الملتقطة');
  expect(preview.className).toContain('object-cover');
  expect(preview.className).not.toContain('object-contain');
  expect(createObjectURL).toHaveBeenCalledWith(first);
});

it('captures the visible first frame before running another face analysis', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const events: string[] = [];
  detectorMocks.detect.mockImplementation(() => {
    events.push('analyze');
    return [{ x: 320, y: 120, width: 640, height: 432, leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 } }];
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    const context = qualityContext();
    if (this.width !== 160) context.drawImage = vi.fn(() => events.push('capture'));
    return context;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));

  render(<AttendanceCameraCapture value={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));
  events.length = 0;

  fireEvent.click(screen.getByRole('button', { name: 'التقاط الصورة' }));

  await waitFor(() => expect(events.length).toBeGreaterThan(0));
  expect(events[0]).toBe('capture');
});

it('rejects the burst when the face leaves the frame instead of submitting bad later images', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(qualityContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));
  const onChange = vi.fn();

  render(<AttendanceCameraCapture value={null} onChange={onChange} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));

  detectorMocks.detect
    .mockReturnValueOnce([{ x: 320, y: 120, width: 640, height: 432, leftEye: { x: 0.4, y: 0.42 }, rightEye: { x: 0.6, y: 0.42 }, nose: { x: 0.5, y: 0.55 } }])
    .mockReturnValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: 'التقاط الصورة' }));

  expect((await screen.findByRole('alert')).textContent).toContain('ثبّت');
  expect(onChange).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledOnce();
});

it('stops the camera and reports failure when canvas drawing is unavailable', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValueOnce(qualityContext())
    .mockReturnValue(null);

  render(<AttendanceCameraCapture value={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(await screen.findByRole('button', { name: 'التقاط الصورة' }));

  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('captures successfully after the React Strict Mode effect replay', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(qualityContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));
  const onChange = vi.fn();

  render(<StrictMode><AttendanceCameraCapture value={null} onChange={onChange} disabled={false} /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  const video = await screen.findByLabelText('معاينة الكاميرا');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
  fireEvent.loadedData(video);
  await waitFor(() => expect((screen.getByRole('button', { name: 'التقاط الصورة' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(await screen.findByRole('button', { name: 'التقاط الصورة' }));

  await waitFor(() => expect(onChange).toHaveBeenCalledOnce(), { timeout: 2500 });
});
