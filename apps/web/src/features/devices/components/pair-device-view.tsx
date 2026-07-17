'use client';

import { ShieldAlert, Smartphone } from 'lucide-react';

import { Card, CardContent } from '@capella/ui';

/**
 * Public landing page for a single-use pairing link.
 *
 * The pairing ceremony requires a WebAuthn registration challenge that the
 * backend does not issue yet (its completion route is deliberately
 * fail-closed), so this page only acknowledges the link. The token stays in
 * the URL for the future ceremony and is never rendered into the page.
 */
export function PairDeviceView({ token }: { token: string }) {
  void token;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-8 text-center">
          <Smartphone className="mx-auto size-10 text-muted" aria-hidden />
          <h1 className="text-lg font-bold">ربط هذا الهاتف</h1>
          <p className="text-sm text-muted">
            وصلت إلى رابط ربط جهاز صادر من إدارة كابيلا. هذا الرابط صالح لاستخدام واحد فقط.
          </p>
          <div className="flex items-start gap-2 rounded-control border border-line bg-ink/[0.03] p-3 text-start">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-[13px] text-muted">
              إتمام الربط غير متاح بعد: يتطلب تسجيل الجهاز تحققًا مشفرًا (WebAuthn) لم يكتمل في
              الخادم حتى الآن. أبقِ هذه الصفحة وأعد المحاولة بعد تفعيل التحقق، أو اطلب من الإدارة
              رابطًا جديدًا حينها.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
