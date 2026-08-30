export interface BrowserFaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  nose: { x: number; y: number };
}

export interface EmployeeFaceQuality {
  code: 'ready' | 'no_face' | 'multiple_faces' | 'too_far' | 'too_close' | 'off_center' | 'not_frontal' | 'too_dark' | 'too_bright' | 'blurry';
  ready: boolean;
  score: number;
}

export const evaluateEmployeeFaceQuality = (
  frame: ImageData,
  faces: BrowserFaceDetection[],
): EmployeeFaceQuality => {
  const failed = (code: Exclude<EmployeeFaceQuality['code'], 'ready'>, score: number): EmployeeFaceQuality => ({
    code,
    ready: false,
    score,
  });
  if (faces.length === 0) return failed('no_face', 0);
  if (faces.length > 1) return failed('multiple_faces', 10);

  const face = faces[0]!;
  const faceAreaRatio = (face.width * face.height) / (frame.width * frame.height);
  if (faceAreaRatio < 0.12) return failed('too_far', 30);
  if (faceAreaRatio > 0.55) return failed('too_close', 35);
  const centerX = (face.x + face.width / 2) / frame.width;
  const centerY = (face.y + face.height / 2) / frame.height;
  if (Math.abs(centerX - 0.5) > 0.18 || Math.abs(centerY - 0.5) > 0.18) {
    return failed('off_center', 45);
  }
  const eyeSpan = Math.abs(face.rightEye.x - face.leftEye.x);
  const eyeMidpointX = (face.leftEye.x + face.rightEye.x) / 2;
  const eyeTilt = Math.abs(face.rightEye.y - face.leftEye.y);
  if (eyeSpan <= 0.01 || Math.abs(face.nose.x - eyeMidpointX) / eyeSpan > 0.55 || eyeTilt / eyeSpan > 0.25) {
    return failed('not_frontal', 50);
  }

  const luminance = new Float32Array(frame.width * frame.height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const offset = pixel * 4;
    const value = (
      frame.data[offset]! * 0.299
      + frame.data[offset + 1]! * 0.587
      + frame.data[offset + 2]! * 0.114
    );
    luminance[pixel] = value;
  }
  const left = Math.max(0, Math.floor(face.x));
  const top = Math.max(0, Math.floor(face.y));
  const right = Math.min(frame.width, Math.ceil(face.x + face.width));
  const bottom = Math.min(frame.height, Math.ceil(face.y + face.height));
  let luminanceSum = 0;
  let facePixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      luminanceSum += luminance[y * frame.width + x]!;
      facePixels += 1;
    }
  }
  const averageLuminance = luminanceSum / facePixels;
  if (averageLuminance < 55) return failed('too_dark', 55);
  if (averageLuminance > 220) return failed('too_bright', 55);

  const laplacians: number[] = [];
  for (let y = Math.max(1, top + 1); y < Math.min(frame.height - 1, bottom - 1); y += 1) {
    for (let x = Math.max(1, left + 1); x < Math.min(frame.width - 1, right - 1); x += 1) {
      const index = y * frame.width + x;
      laplacians.push(
        luminance[index - frame.width]!
        + luminance[index - 1]!
        - 4 * luminance[index]!
        + luminance[index + 1]!
        + luminance[index + frame.width]!,
      );
    }
  }
  const mean = laplacians.reduce((sum, value) => sum + value, 0) / laplacians.length;
  const variance = laplacians.reduce((sum, value) => sum + (value - mean) ** 2, 0) / laplacians.length;
  if (variance < 100) return failed('blurry', 70);

  return { code: 'ready', ready: true, score: 100 };
};
