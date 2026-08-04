'use client';

import Link from 'next/link';

import { Button, Card, CardContent } from '@capella/ui';

type ProtectedRouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProtectedRouteError({ reset }: ProtectedRouteErrorProps) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="space-y-4 text-center">
        <h1 className="text-xl font-semibold text-ink">تعذر تحميل صفحة نقطة البيع</h1>
        <p className="text-sm text-muted">
          بعد إعادة المحاولة، ستعود إلى آخر مسودة تم حفظها بنجاح على هذا الجهاز إن وُجدت.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>إعادة المحاولة</Button>
          <Link
            href="/sales"
            className="inline-flex h-9 items-center justify-center rounded-control border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-surface"
          >
            العودة إلى البيع
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
