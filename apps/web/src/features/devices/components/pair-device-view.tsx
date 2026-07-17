'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { CheckCircle2, ShieldAlert, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, CardContent } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { completeDevicePairing, getPairingOptions } from '../api/devices-api';
import { detectBrowser, detectPlatform, installationMarker } from '../lib/device-identity';

type CeremonyStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * Public landing page for a single-use pairing link. Runs the WebAuthn
 * registration ceremony: fetch the server challenge, create the platform
 * credential, then submit the attestation. The token stays in the URL and is
 * never rendered into the page.
 */
export function PairDeviceView({ token }: { token: string }) {
  const [status, setStatus] = useState<CeremonyStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Decided after mount so the server render matches the client's first paint.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported('PublicKeyCredential' in window);
  }, []);

  const pair = async () => {
    setStatus('pending');
    setError(null);
    try {
      const optionsJSON = await getPairingOptions(token);
      const response = await startRegistration({ optionsJSON });
      await completeDevicePairing(token, {
        installationMarker: installationMarker(),
        browser: detectBrowser(navigator.userAgent),
        platform: detectPlatform(navigator.userAgent),
        response,
      });
      setStatus('success');
    } catch (caught) {
      setStatus('error');
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'تعذر إتمام الربط. حاول مرة أخرى أو اطلب رابطًا جديدًا من الإدارة.',
      );
    }
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
                أصبح هذا الهاتف مسجلًا لدى إدارة كابيلا ويمكن استخدامه لتسجيل الحضور. يمكنك إغلاق
                هذه الصفحة.
              </p>
            </>
          ) : (
            <>
              <Smartphone className="mx-auto size-10 text-muted" aria-hidden />
              <h1 className="text-lg font-bold">ربط هذا الهاتف</h1>
              <p className="text-sm text-muted">
                وصلت إلى رابط ربط جهاز صادر من إدارة كابيلا. هذا الرابط صالح لاستخدام واحد فقط.
                سيطلب منك الهاتف تأكيد الهوية (بصمة أو قفل الشاشة) لإتمام الربط.
              </p>
              {supported === null ? null : !supported ? (
                <div className="flex items-start gap-2 rounded-control border border-line bg-ink/[0.03] p-3 text-start">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <p className="text-[13px] text-muted">
                    هذا المتصفح لا يدعم الربط الآمن (WebAuthn). افتح الرابط في متصفح حديث على
                    الهاتف المطلوب ربطه.
                  </p>
                </div>
              ) : (
                <>
                  {error ? (
                    <p role="alert" className="text-[13px] text-danger">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    disabled={status === 'pending'}
                    onClick={() => void pair()}
                  >
                    {status === 'pending'
                      ? 'جارٍ الربط…'
                      : status === 'error'
                        ? 'إعادة المحاولة'
                        : 'ابدأ الربط'}
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
