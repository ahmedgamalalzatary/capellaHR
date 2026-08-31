import { describe, expect, it } from 'vitest';

import {
  evaluateEmployeeFaceQuality,
  employeeFaceQualityTone,
  type BrowserFaceDetection,
} from '../src/features/employees/lib/employee-face-quality';

const frame = (brightness: number, pattern = false) => {
  const width = 20;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = pattern && index % 2 === 0 ? Math.max(0, brightness - 80) : brightness;
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
};

const face = (overrides: Partial<BrowserFaceDetection> = {}): BrowserFaceDetection => ({
  x: 5,
  y: 4,
  width: 10,
  height: 12,
  leftEye: { x: 0.4, y: 0.42 },
  rightEye: { x: 0.6, y: 0.42 },
  nose: { x: 0.5, y: 0.55 },
  ...overrides,
});

describe('employee face quality', () => {
  it('maps unusable, improvable, and ready frames to red, yellow, and green guidance', () => {
    expect(employeeFaceQualityTone({ code: 'no_face', ready: false, score: 0 })).toBe('danger');
    expect(employeeFaceQualityTone({ code: 'too_far', ready: false, score: 30 })).toBe('warning');
    expect(employeeFaceQualityTone({ code: 'ready', ready: true, score: 100 })).toBe('success');
  });

  it('requires exactly one face', () => {
    expect(evaluateEmployeeFaceQuality(frame(150, true), []).code).toBe('no_face');
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face(), face()]).code).toBe('multiple_faces');
  });

  it('guides face size and centering before accepting it', () => {
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face({ width: 3, height: 3 })]).code).toBe('too_far');
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face({ x: 1, y: 1, width: 18, height: 18 })]).code).toBe('too_close');
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face({ x: 0, y: 4 })]).code).toBe('off_center');
  });

  it('asks the employee to face the camera directly', () => {
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face({
      nose: { x: 0.72, y: 0.55 },
    })]).code).toBe('not_frontal');
  });

  it('rejects poor lighting and blur', () => {
    expect(evaluateEmployeeFaceQuality(frame(25, true), [face()]).code).toBe('too_dark');
    expect(evaluateEmployeeFaceQuality(frame(245), [face()]).code).toBe('too_bright');
    expect(evaluateEmployeeFaceQuality(frame(150), [face()]).code).toBe('blurry');
  });

  it('measures sharpness on the face instead of the background', () => {
    const image = frame(150, true);
    for (let y = 4; y < 16; y += 1) {
      for (let x = 5; x < 15; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data.set([150, 150, 150, 255], offset);
      }
    }
    expect(evaluateEmployeeFaceQuality(image, [face()]).code).toBe('blurry');
  });

  it('accepts one clear, centered, well-lit face', () => {
    expect(evaluateEmployeeFaceQuality(frame(150, true), [face()])).toMatchObject({
      code: 'ready',
      ready: true,
      score: 100,
    });
  });
});
