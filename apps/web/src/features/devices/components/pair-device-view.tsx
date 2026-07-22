'use client';

import { CheckCircle2, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Card, CardContent } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { completeDevicePairing } from '../api/devices-api';
import { detectBrowser, detectPlatform, installationMarker } from '../lib/device-identity';

type PairingStatus = 'pending' | 'success' | 'error';

export function PairDeviceView({ token }: { token: string }) {
  const started = useRef(false);
  const [status, setStatus] = useState<PairingStatus>('pending');
  const [error, setError] = useState<string | null>(null);

  const pair = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setStatus('pending');
    setError(null);
    try {
      await completeDevicePairing(token, {
        installationMarker: installationMarker(),
        browser: detectBrowser(navigator.userAgent),
        platform: detectPlatform(navigator.userAgent),
      });
      setStatus('success');
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof ApiError
        ? caught.message
        : 'تعذر إتمام الربط. حاول مرة أخرى أو اطلب رابطًا جديدًا من الإدارة.');
    }
  }, [token]);

  useEffect(() => { void pair(); }, [pair]);

  const retry = () => {
    started.current = false;
    void pair();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-8 text-center">
          {status === 'success' ? (
            <>
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
              <h1 className="text-lg font-bold">تم ربط الجهاز بنجاح</h1>
              <p className="text-sm text-muted">
                أصبح هذا المتصفح مسجلًا لدى إدارة كابيلا ويمكن استخدامه لتسجيل الحضور. يمكنك إغلاق هذه الصفحة.
              </p>
            </>
          ) : (
            <>
              <Smartphone className="mx-auto size-10 text-muted" aria-hidden />
              <h1 className="text-lg font-bold">ربط هذا الهاتف</h1>
              {status === 'pending' ? (
                <p className="text-sm text-muted">جارٍ ربط هذا المتصفح تلقائيًا…</p>
              ) : (
                <>
                  <p role="alert" className="text-[13px] text-danger">{error}</p>
                  <Button type="button" onClick={retry}>إعادة المحاولة</Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
