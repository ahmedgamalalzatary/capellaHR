import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import type { AttendanceFaceGateway, FaceComparisonResult } from './attendance-service.js';

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number; score: number; landmarks: Point[] };

export const onnxSessionOptions = Object.freeze({
  logSeverityLevel: 3,
} satisfies ort.InferenceSession.SessionOptions);

export const classifyDetectedFaces = (count: number) => (
  count === 0 ? 'face_not_found' : count === 1 ? 'one' : 'multiple_faces'
);

export const cosineSimilarity = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length || left.length === 0) return null;
  let dot = 0; let leftLength = 0; let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]); const b = Number(right[index]);
    dot += a * b; leftLength += a * a; rightLength += b * b;
  }
  const denominator = Math.sqrt(leftLength) * Math.sqrt(rightLength);
  return denominator === 0 ? null : dot / denominator;
};

const intersectionOverUnion = (left: Box, right: Box) => {
  const x1 = Math.max(left.x, right.x); const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return intersection / (left.width * left.height + right.width * right.height - intersection);
};

const suppressOverlaps = (boxes: Box[]) => {
  const remaining = [...boxes].sort((a, b) => b.score - a.score);
  const selected: Box[] = [];
  while (remaining.length && selected.length < 3) {
    const next = remaining.shift();
    if (!next) break;
    selected.push(next);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (intersectionOverUnion(next, remaining[index]!) >= 0.3) remaining.splice(index, 1);
    }
  }
  return selected;
};

const imageTensor = async (buffer: Buffer, size: number, normalize: boolean) => {
  const { data, info } = await sharp(buffer).rotate().resize(size, size, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('Unsupported image channels');
  const values = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[pixel * 3 + channel]!;
      values[channel * plane + pixel] = normalize ? (value - 127.5) / 128 : value;
    }
  }
  return new ort.Tensor('float32', values, [1, 3, size, size]);
};

const detect = async (session: ort.InferenceSession, image: Buffer) => {
  const output = await session.run({ input: await imageTensor(image, 640, false) });
  const boxes: Box[] = [];
  for (const stride of [8, 16, 32]) {
    const side = 640 / stride;
    const classes = output[`cls_${stride}`]?.data as Float32Array | undefined;
    const objects = output[`obj_${stride}`]?.data as Float32Array | undefined;
    const bounds = output[`bbox_${stride}`]?.data as Float32Array | undefined;
    const landmarks = output[`kps_${stride}`]?.data as Float32Array | undefined;
    if (!classes || !objects || !bounds || !landmarks) throw new Error('Unexpected YuNet output');
    for (let index = 0; index < classes.length; index += 1) {
      const score = Math.sqrt(Math.max(0, classes[index]! * objects[index]!));
      if (score < 0.9) continue;
      const column = index % side; const row = Math.floor(index / side);
      const centerX = (column + bounds[index * 4]!) * stride;
      const centerY = (row + bounds[index * 4 + 1]!) * stride;
      const width = Math.exp(bounds[index * 4 + 2]!) * stride;
      const height = Math.exp(bounds[index * 4 + 3]!) * stride;
      boxes.push({
        x: centerX - width / 2, y: centerY - height / 2, width, height, score,
        landmarks: Array.from({ length: 5 }, (_, landmark) => ({
          x: (column + landmarks[index * 10 + landmark * 2]!) * stride,
          y: (row + landmarks[index * 10 + landmark * 2 + 1]!) * stride,
        })),
      });
    }
  }
  return suppressOverlaps(boxes);
};

const SFACE_LANDMARKS: Point[] = [
  { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 }, { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

const alignedFaceTensor = async (image: Buffer, face: Box) => {
  const { data, info } = await sharp(image).rotate().removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || info.width * info.height > 20_000_000) throw new Error('Invalid image dimensions');
  const source = face.landmarks.map(({ x, y }) => ({
    x: x * info.width / 640,
    y: y * info.height / 640,
  }));
  const sourceCenter = source.reduce((sum, point) => ({ x: sum.x + point.x / 5, y: sum.y + point.y / 5 }), { x: 0, y: 0 });
  const targetCenter = SFACE_LANDMARKS.reduce((sum, point) => ({ x: sum.x + point.x / 5, y: sum.y + point.y / 5 }), { x: 0, y: 0 });
  let scaleRotationA = 0; let scaleRotationB = 0; let sourceVariance = 0;
  for (let index = 0; index < 5; index += 1) {
    const sx = source[index]!.x - sourceCenter.x; const sy = source[index]!.y - sourceCenter.y;
    const tx = SFACE_LANDMARKS[index]!.x - targetCenter.x; const ty = SFACE_LANDMARKS[index]!.y - targetCenter.y;
    scaleRotationA += sx * tx + sy * ty;
    scaleRotationB += sx * ty - sy * tx;
    sourceVariance += sx * sx + sy * sy;
  }
  if (sourceVariance === 0) throw new Error('Invalid face landmarks');
  const a = scaleRotationA / sourceVariance; const b = scaleRotationB / sourceVariance;
  const inverse = a * a + b * b;
  if (inverse === 0) throw new Error('Invalid face transform');
  const values = new Float32Array(3 * 112 * 112);
  const plane = 112 * 112;
  for (let y = 0; y < 112; y += 1) for (let x = 0; x < 112; x += 1) {
    const tx = x - targetCenter.x; const ty = y - targetCenter.y;
    const sourceX = sourceCenter.x + (a * tx + b * ty) / inverse;
    const sourceY = sourceCenter.y + (-b * tx + a * ty) / inverse;
    const nearestX = Math.max(0, Math.min(info.width - 1, Math.round(sourceX)));
    const nearestY = Math.max(0, Math.min(info.height - 1, Math.round(sourceY)));
    const sourcePixel = (nearestY * info.width + nearestX) * 3;
    const targetPixel = y * 112 + x;
    for (let channel = 0; channel < 3; channel += 1) {
      values[channel * plane + targetPixel] = data[sourcePixel + channel]!;
    }
  }
  return new ort.Tensor('float32', values, [1, 3, 112, 112]);
};

const descriptor = async (session: ort.InferenceSession, image: Buffer, box: Box) => {
  const result = await session.run({ data: await alignedFaceTensor(image, box) });
  const values = result.fc1?.data as Float32Array | undefined;
  if (!values) throw new Error('Unexpected SFace output');
  return values;
};

export const markPromiseHandled = <T>(promise: Promise<T>) => {
  void promise.catch(() => undefined);
  return promise;
};

export const createOnnxFaceGateway = (
  readPersonalPhoto: (storagePath: string) => Promise<Buffer>,
  modelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/face-models'),
): AttendanceFaceGateway => {
  const sessions = markPromiseHandled(Promise.all([
    ort.InferenceSession.create(path.join(modelRoot, 'yunet.onnx'), onnxSessionOptions),
    ort.InferenceSession.create(path.join(modelRoot, 'sface.onnx'), onnxSessionOptions),
  ]));
  let activeComparisons = 0;
  const waiters: Array<() => void> = [];
  const enter = () => new Promise<boolean>((resolve) => {
    if (activeComparisons < 2) { activeComparisons += 1; resolve(true); return; }
    if (waiters.length >= 8) { resolve(false); return; }
    waiters.push(() => { activeComparisons += 1; resolve(true); });
  });
  const leave = () => {
    activeComparisons -= 1;
    waiters.shift()?.();
  };
  const validImage = async (image: Buffer) => {
    const metadata = await sharp(image).metadata();
    return Boolean(
      metadata.width && metadata.height
      && metadata.width * metadata.height <= 12_000_000
      && ['jpeg', 'png', 'webp'].includes(metadata.format ?? ''),
    );
  };
  return {
    async compare(personalPhotoPath, liveImage): Promise<FaceComparisonResult> {
      let personalImage: Buffer;
      try { personalImage = await readPersonalPhoto(personalPhotoPath); } catch { return { kind: 'failed' }; }
      try { if (!await validImage(personalImage)) return { kind: 'failed' }; } catch { return { kind: 'failed' }; }
      try { if (!await validImage(liveImage)) return { kind: 'invalid_image' }; } catch { return { kind: 'invalid_image' }; }
      if (!await enter()) return { kind: 'failed' };
      try {
        let detector: ort.InferenceSession; let recognizer: ort.InferenceSession;
        try { [detector, recognizer] = await sessions; } catch { return { kind: 'failed' }; }
        let personalFaces: Box[];
        try { personalFaces = await detect(detector, personalImage); } catch { return { kind: 'failed' }; }
        let liveFaces: Box[];
        try { liveFaces = await detect(detector, liveImage); } catch { return { kind: 'failed' }; }
        const personalState = classifyDetectedFaces(personalFaces.length);
        if (personalState !== 'one') return { kind: 'failed' };
        const liveState = classifyDetectedFaces(liveFaces.length);
        if (liveState !== 'one') return { kind: liveState };
        let personalDescriptor: Float32Array; let liveDescriptor: Float32Array;
        try {
          [personalDescriptor, liveDescriptor] = await Promise.all([
            descriptor(recognizer, personalImage, personalFaces[0]!),
            descriptor(recognizer, liveImage, liveFaces[0]!),
          ]);
        } catch { return { kind: 'failed' }; }
        const similarity = cosineSimilarity(personalDescriptor, liveDescriptor);
        if (similarity === null) return { kind: 'failed' };
        return { kind: similarity >= 0.363 ? 'match' : 'mismatch' };
      } catch { return { kind: 'failed' }; }
      finally { leave(); }
    },
  };
};
