'use client';

import { Camera, Check, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@capella/ui';

import { createEmployeeFaceDetector, type EmployeeFaceDetector } from '../lib/employee-face-detector';
import { evaluateEmployeeFaceQuality, type EmployeeFaceQuality } from '../lib/employee-face-quality';

const qualityMessages: Record<EmployeeFaceQuality['code'], string> = {
  ready: 'الصورة جاهزة للتسجيل',
  no_face: 'ضع وجهًا واحدًا داخل الإطار',
  multiple_faces: 'يجب أن يظهر وجه واحد فقط',
  too_far: 'اقترب قليلًا من الكاميرا',
  too_close: 'ابتعد قليلًا عن الكاميرا',
  off_center: 'ضع وجهك في منتصف الإطار',
  not_frontal: 'انظر مباشرة إلى الكاميرا',
  too_dark: 'الإضاءة ضعيفة؛ انتقل إلى مكان أكثر إضاءة',
  too_bright: 'الإضاءة قوية جدًا؛ ابتعد عن مصدر الضوء',
  blurry: 'الصورة غير واضحة؛ اثبت أمام الكاميرا',
};

export function EmployeeFaceCapture({
  value,
  onChange,
  disabled,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<EmployeeFaceDetector | null>(null);
  const intervalRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [active, setActive] = useState(false);
  const [quality, setQuality] = useState<EmployeeFaceQuality>({ code: 'no_face', ready: false, score: 0 });
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    requestRef.current += 1;
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  };

  useEffect(() => () => {
    requestRef.current += 1;
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {
      stop();
      setError('تعذر تشغيل الكاميرا. أعد المحاولة.');
    });
  }, [active]);

  const analyze = () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
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
    setQuality(evaluateEmployeeFaceQuality(context.getImageData(0, 0, canvas.width, canvas.height), faces));
  };

  const open = async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setError(null);
    try {
      let detector = detectorRef.current;
      if (!detector) {
        detector = await createEmployeeFaceDetector();
        if (requestRef.current !== requestId) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (requestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setQuality({ code: 'no_face', ready: false, score: 0 });
      setActive(true);
    } catch {
      if (requestRef.current !== requestId) return;
      stop();
      setError('تعذر فتح كاميرا الوجه أو تحميل أداة فحص الصورة. تحقق من الإذن والاتصال ثم أعد المحاولة.');
    }
  };

  const startAnalysis = () => {
    analyze();
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(analyze, 400);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !quality.ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('تعذر التقاط الصورة. أعد المحاولة.');
        return;
      }
      onChange(new File([blob], 'personal.jpg', { type: 'image/jpeg' }));
      stop();
    }, 'image/jpeg', 0.92);
  };

  if (value && !active) {
    return (
      <div className="rounded-control border border-success/30 bg-success-soft p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-success"><Check className="size-4" aria-hidden />تم التقاط صورة وجه صالحة</p>
        <Button id="employee-face-capture" type="button" variant="secondary" size="sm" className="mt-3" disabled={disabled} onClick={() => { onChange(null); void open(); }}><RefreshCw className="size-4" aria-hidden />إعادة الالتقاط</Button>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-line bg-surface p-4">
      <p className="text-sm font-medium">صورة الوجه المباشرة</p>
      {active ? <video ref={videoRef} aria-label="معاينة صورة وجه الموظف" muted playsInline onLoadedData={startAnalysis} className="mt-3 aspect-video w-full rounded-control bg-ink object-cover" /> : null}
      {active ? (
        <div className="mt-3">
          <div role="progressbar" aria-label="جودة صورة الوجه" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quality.score} className="h-2 overflow-hidden rounded-full bg-line">
            <div className={`h-full transition-[width] ${quality.ready ? 'bg-success' : 'bg-warning'}`} style={{ width: `${quality.score}%` }} />
          </div>
          <p className={`mt-2 text-sm ${quality.ready ? 'text-success' : 'text-muted'}`}>{qualityMessages[quality.code]}</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {!active ? <Button id="employee-face-capture" type="button" variant="secondary" disabled={disabled} onClick={() => void open()}><Camera className="size-4" aria-hidden />فتح كاميرا الوجه</Button> : null}
        {active ? <Button type="button" disabled={disabled || !quality.ready} onClick={capture}>استخدام هذه الصورة</Button> : null}
        {active ? <Button type="button" variant="ghost" disabled={disabled} onClick={stop}>إلغاء</Button> : null}
      </div>
    </div>
  );
}
