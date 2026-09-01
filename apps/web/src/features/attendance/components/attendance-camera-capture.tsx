'use client';

import { Camera, Check, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@capella/ui';

import { FaceQualityGuidance } from '@/features/employees/components/face-quality-guidance';
import { createEmployeeFaceDetector, type EmployeeFaceDetector } from '@/features/employees/lib/employee-face-detector';
import { evaluateEmployeeFaceQuality, type EmployeeFaceQuality } from '@/features/employees/lib/employee-face-quality';

export function AttendanceCameraCapture({
  value,
  onChange,
  disabled,
}: {
  value: Blob[] | null;
  onChange: (images: Blob[] | null) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<EmployeeFaceDetector | null>(null);
  const intervalRef = useRef<number | null>(null);
  const cameraRequestRef = useRef(0);
  const captureRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const [active, setActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [quality, setQuality] = useState<EmployeeFaceQuality>({ code: 'no_face', ready: false, score: 0 });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const stopCamera = () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraRequestRef.current += 1;
      captureRequestRef.current += 1;
      stopCamera();
      detectorRef.current?.close();
    };
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!active || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      if (!mountedRef.current) return;
      stopCamera();
      setError('تعذر تشغيل الكاميرا. أعد المحاولة.');
    });
  }, [active]);
  useEffect(() => {
    const first = value?.[0];
    if (!first || typeof URL.createObjectURL !== 'function') { setPreview(null); return; }
    const url = URL.createObjectURL(first);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const assessVideo = () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;
    const faces = detector.detect(video, performance.now()).map((face) => ({
      ...face,
      x: face.x * scaleX,
      y: face.y * scaleY,
      width: face.width * scaleX,
      height: face.height * scaleY,
      leftEye: { x: face.leftEye.x * canvas.width, y: face.leftEye.y * canvas.height },
      rightEye: { x: face.rightEye.x * canvas.width, y: face.rightEye.y * canvas.height },
      nose: { x: face.nose.x * canvas.width, y: face.nose.y * canvas.height },
    }));
    return evaluateEmployeeFaceQuality(
      context.getImageData(0, 0, canvas.width, canvas.height),
      faces,
    );
  };

  const analyze = () => {
    const result = assessVideo();
    if (result) setQuality(result);
  };

  const startAnalysis = () => {
    analyze();
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(analyze, 400);
  };

  const openCamera = async () => {
    const requestId = ++cameraRequestRef.current;
    setError(null);
    try {
      let detector = detectorRef.current;
      if (!detector) {
        detector = await createEmployeeFaceDetector();
        if (!mountedRef.current || requestId !== cameraRequestRef.current) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setQuality({ code: 'no_face', ready: false, score: 0 });
      setActive(true);
    } catch {
      if (!mountedRef.current || requestId !== cameraRequestRef.current) return;
      stopCamera();
      setError('تعذر فتح الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم أعد المحاولة.');
    }
  };

  const capture = async () => {
    if (!quality.ready) return;
    await captureTemporal();
  };

  const cancel = () => {
    cameraRequestRef.current += 1;
    captureRequestRef.current += 1;
    stopCamera();
    onChange(null);
    setError(null);
  };

  const captureFrame = (video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  };

  const captureTemporal = async () => {
    const video = videoRef.current!;
    if (!video) return;
    const captureId = ++captureRequestRef.current;
    const frames: Blob[] = [];
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    setCapturing(true);
    setError(null);
    const firstFrame = await captureFrame(video);
    if (!mountedRef.current || captureId !== captureRequestRef.current) return;
    if (firstFrame) frames.push(firstFrame);
    for (let index = 1; index < 8; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, process.env.NODE_ENV === 'test' ? 0 : 150));
      if (!mountedRef.current || captureId !== captureRequestRef.current) return;
      const currentQuality = assessVideo();
      if (!currentQuality?.ready) {
        stopCamera();
        setCapturing(false);
        setQuality(currentQuality ?? { code: 'no_face', ready: false, score: 0 });
        setError('ثبّت الهاتف وأبقِ وجهك كاملًا داخل الإطار طوال فترة التقاط الصورة، ثم أعد المحاولة.');
        return;
      }
      const blob = await captureFrame(video);
      if (!mountedRef.current || captureId !== captureRequestRef.current) return;
      if (blob) frames.push(blob);
    }
    stopCamera();
    setCapturing(false);
    if (frames.length >= 5) onChange(frames);
    else setError('تعذر التقاط صور كافية. ثبّت الهاتف ووجهك ثم أعد المحاولة.');
  };

  const retake = () => {
    onChange(null);
    void openCamera();
  };

  const showsImage = active || Boolean(value && preview);
  const mediaFrame = `mx-auto mt-3 grid aspect-video w-full place-items-center overflow-hidden rounded-control border ${showsImage ? 'border-line bg-ink' : 'border-dashed border-line bg-paper'}`;

  return (
    <div className="rounded-control border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">صورة مباشرة للتحقق من الوجه</p>
          <p className="mt-1 text-[12px] text-muted">تُستخدم للمقارنة فقط ولا يتم حفظها.</p>
        </div>
        {value ? <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[12px] font-medium text-success"><Check className="size-3.5" aria-hidden />تم الالتقاط</span> : null}
      </div>
      <div className={mediaFrame}>
        {active ? <video ref={videoRef} aria-label="معاينة الكاميرا" muted playsInline onLoadedData={startAnalysis} className="aspect-video size-full object-cover" /> : null}
        {!active && value && preview ? <Image src={preview} alt="الصورة الملتقطة" width={640} height={480} unoptimized className="size-full object-cover" /> : null}
        {!active && value && !preview ? <p role="status" className="px-3 text-center text-sm text-success">تم التقاط الصورة.</p> : null}
        {!active && !value ? <span className="grid gap-2 text-center text-muted"><Camera className="mx-auto size-7" aria-hidden /><span className="text-[12px]">وجّه الكاميرا نحو وجهك في مكان جيد الإضاءة.</span></span> : null}
      </div>
      {capturing ? <p role="status" aria-live="polite" className="mt-3 text-center text-sm font-medium text-success">جارٍ التقاط صور التحقق… ثبّت الهاتف ووجهك داخل الإطار.</p> : null}
      {active ? <FaceQualityGuidance quality={quality} /> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {!active && !value ? <Button type="button" variant="secondary" disabled={disabled} onClick={() => void openCamera()}><Camera className="size-4" aria-hidden />فتح الكاميرا</Button> : null}
        {active ? <Button type="button" disabled={disabled || capturing || !quality.ready} onClick={capture}><Camera className="size-4" aria-hidden />{capturing ? 'جارٍ الالتقاط…' : 'التقاط الصورة'}</Button> : null}
        {active ? <Button type="button" variant="ghost" disabled={disabled || capturing} onClick={cancel}>إلغاء</Button> : null}
        {value ? <Button type="button" variant="secondary" disabled={disabled} onClick={retake}><RefreshCw className="size-4" aria-hidden />إعادة التقاط الصورة</Button> : null}
      </div>
    </div>
  );
}
