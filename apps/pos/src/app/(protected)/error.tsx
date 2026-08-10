'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { Button, Card, CardContent } from '@capella/ui';

type ProtectedRouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProtectedRouteError({ reset }: ProtectedRouteErrorProps) {
  return (
    <Card className="mx-auto max-w-xl shadow-card">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-ink">تعذر تحميل صفحة نقطة البيع</h1>
          <p className="text-sm leading-relaxed text-muted">
            بعد إعادة المحاولة، ستعود إلى آخر مسودة تم حفظها بنجاح على هذا الجهاز إن وُجدت.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden />
            إعادة المحاولة
          </Button>
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
