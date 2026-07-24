'use client';

import { Camera, Check, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@capella/ui';

export function AttendanceCameraCapture({
  value,
  onChange,
  disabled,
}: {
  value: Blob | null;
  onChange: (image: Blob | null) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const captureRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const stopCamera = () => {
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
    if (!value || typeof URL.createObjectURL !== 'function') { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const openCamera = async () => {
    const requestId = ++cameraRequestRef.current;
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setActive(true);
    } catch {
      if (!mountedRef.current || requestId !== cameraRequestRef.current) return;
      stopCamera();
      setError('تعذر فتح الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم أعد المحاولة.');
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const captureId = ++captureRequestRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    if (!context) {
      stopCamera();
      setError('تعذر التقاط الصورة. أعد المحاولة.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    canvas.toBlob((blob) => {
      if (!mountedRef.current || captureId !== captureRequestRef.current) return;
      if (blob) onChange(blob);
      else setError('تعذر التقاط الصورة. أعد المحاولة.');
    }, 'image/jpeg', 0.9);
  };

  const cancel = () => {
    cameraRequestRef.current += 1;
    captureRequestRef.current += 1;
    stopCamera();
    onChange(null);
    setError(null);
  };

  const retake = () => {
    onChange(null);
    void openCamera();
  };

  const showsImage = active || Boolean(value && preview);
  const mediaFrame = `mx-auto mt-3 grid aspect-[4/3] w-full max-w-[17rem] place-items-center overflow-hidden rounded-control border ${showsImage ? 'border-line bg-ink' : 'border-dashed border-line bg-paper'}`;

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
        {active ? <video ref={videoRef} aria-label="معاينة الكاميرا" muted playsInline className="size-full object-cover" /> : null}
        {!active && value && preview ? <img src={preview} alt="الصورة الملتقطة" className="size-full object-cover" /> : null}
        {!active && value && !preview ? <p role="status" className="px-3 text-center text-sm text-success">تم التقاط الصورة.</p> : null}
        {!active && !value ? <span className="grid gap-2 text-center text-muted"><Camera className="mx-auto size-7" aria-hidden /><span className="text-[12px]">وجّه الكاميرا نحو وجهك في مكان جيد الإضاءة.</span></span> : null}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {!active && !value ? <Button type="button" variant="secondary" disabled={disabled} onClick={() => void openCamera()}><Camera className="size-4" aria-hidden />فتح الكاميرا</Button> : null}
        {active ? <Button type="button" disabled={disabled} onClick={capture}><Camera className="size-4" aria-hidden />التقاط الصورة</Button> : null}
        {active ? <Button type="button" variant="ghost" disabled={disabled} onClick={cancel}>إلغاء</Button> : null}
        {value ? <Button type="button" variant="secondary" disabled={disabled} onClick={retake}><RefreshCw className="size-4" aria-hidden />إعادة التقاط الصورة</Button> : null}
      </div>
    </div>
  );
}
