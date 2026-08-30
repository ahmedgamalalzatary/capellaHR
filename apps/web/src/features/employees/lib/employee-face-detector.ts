import type { BrowserFaceDetection } from './employee-face-quality';

export interface EmployeeFaceDetector {
  detect(video: HTMLVideoElement, timestamp: number): BrowserFaceDetection[];
  close(): void;
}

export const createEmployeeFaceDetector = async (): Promise<EmployeeFaceDetector> => {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  );
  const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/models/blaze-face-short-range.tflite' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.65,
    minSuppressionThreshold: 0.3,
  });
  return {
    detect(video, timestamp) {
      return detector.detectForVideo(video, timestamp).detections.flatMap((detection) => {
        const box = detection.boundingBox;
        const [leftEye, rightEye, nose] = detection.keypoints;
        if (!box || !leftEye || !rightEye || !nose) return [];
        return [{
          x: box.originX,
          y: box.originY,
          width: box.width,
          height: box.height,
          leftEye: { x: leftEye.x, y: leftEye.y },
          rightEye: { x: rightEye.x, y: rightEye.y },
          nose: { x: nose.x, y: nose.y },
        }];
      });
    },
    close: () => detector.close(),
  };
};
