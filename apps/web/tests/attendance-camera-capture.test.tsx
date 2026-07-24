import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { AttendanceCameraCapture } from '../src/features/attendance/components/attendance-camera-capture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('captures one JPEG frame and stops the camera tracks', async () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  let finishEncoding: BlobCallback | undefined;
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { finishEncoding = callback; });
  const onChange = vi.fn();

  render(<AttendanceCameraCapture value={null} onChange={onChange} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  await screen.findByRole('button', { name: 'التقاط الصورة' });
  fireEvent.click(screen.getByRole('button', { name: 'التقاط الصورة' }));

  expect(stop).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  finishEncoding?.(new Blob(['face'], { type: 'image/jpeg' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' })));
});

it('stops the camera and reports failure when canvas drawing is unavailable', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

  render(<AttendanceCameraCapture value={null} onChange={vi.fn()} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  fireEvent.click(await screen.findByRole('button', { name: 'التقاط الصورة' }));

  expect(stop).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('captures successfully after the React Strict Mode effect replay', async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['face'], { type: 'image/jpeg' })));
  const onChange = vi.fn();

  render(<StrictMode><AttendanceCameraCapture value={null} onChange={onChange} disabled={false} /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: 'فتح الكاميرا' }));
  fireEvent.click(await screen.findByRole('button', { name: 'التقاط الصورة' }));

  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
});
