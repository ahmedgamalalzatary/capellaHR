"use client";

import { CalendarClock, Filter, LockKeyhole, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { ApiError } from "@/shared/lib/api-client";
import {
  useCreateMonthLock,
  useMonthLocks
} from "@/features/month-locks/month-locks.hooks";
import type { MonthLockFilters } from "@/features/month-locks/month-locks.types";

const PAGE_SIZE = 10;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo"
  }).format(new Date(value));
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function monthLockErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const code = getApiErrorCode(error);

    if (code === "MONTH_LOCK_ALREADY_EXISTS") {
      return "هذا الشهر مقفل بالفعل.";
    }

    if (code === "MONTH_LOCK_HAS_OPEN_SESSIONS") {
      return "يجب إغلاق جلسات الحضور المفتوحة قبل قفل الشهر.";
    }

    if (code === "MONTH_LOCK_NOT_ALLOWED") {
      return "يمكن قفل الشهور المكتملة السابقة فقط.";
    }

    return error.message;
  }

  return "تعذّر قفل الشهر.";
}

function getApiErrorCode(error: ApiError) {
  if (error.payload && typeof error.payload === "object") {
    const payload = error.payload as { error?: { code?: unknown } };
    return typeof payload.error?.code === "string" ? payload.error.code : undefined;
  }

  return undefined;
}

export function AdminMonthLocksDashboard() {
  const [filterMonth, setFilterMonth] = useState("");
  const [filters, setFilters] = useState<MonthLockFilters>({
    page: 1,
    pageSize: PAGE_SIZE
  });
  const [monthKey, setMonthKey] = useState("");
  const [notes, setNotes] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");

  const monthLocksQuery = useMonthLocks(filters);
  const createMonthLock = useCreateMonthLock();
  const monthLocks = monthLocksQuery.data?.monthLocks.items ?? [];
  const pagination = monthLocksQuery.data?.monthLocks.pagination;

  function applyFilter() {
    setFilters({
      page: 1,
      pageSize: PAGE_SIZE,
      monthKey: trimOrUndefined(filterMonth)
    });
  }

  function goToPage(page: number) {
    setFilters((current) => ({
      ...current,
      page
    }));
  }

  async function submitMonthLock() {
    setSubmitError("");
    setSubmitMessage("");

    try {
      await createMonthLock.mutateAsync({
        monthKey,
        notes: trimOrUndefined(notes)
      });
      setMonthKey("");
      setNotes("");
      setSubmitMessage("تم قفل الشهر بنجاح.");
    } catch (error) {
      setSubmitError(monthLockErrorMessage(error));
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-sm font-medium text-muted-foreground">إغلاق الفترات</p>
          <h1 className="text-3xl font-bold tracking-tight">أقفال الشهور</h1>
          <p className="text-muted-foreground">
            اقفل الشهور المكتملة بعد المراجعة لمنع التعديلات التشغيلية على بيانات الحضور.
          </p>
        </div>
      </section>

      <Card className="border-amber-200 bg-amber-50/70">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-700" aria-hidden />
            <CardTitle>تأثير القفل</CardTitle>
          </div>
          <CardDescription className="text-amber-900">
            قفل الشهر يمنع تعديل الحضور، إنشاء أو تعديل الراحات الأسبوعية، تسجيل الغياب بإذن،
            ومحاولات حضور الموظفين داخل الشهر المقفل. القفل لا يمكن إلغاؤه من الواجهة الحالية.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Filter className="size-5 text-teal-700" aria-hidden />
              <CardTitle>فلترة الأقفال</CardTitle>
            </div>
            <CardDescription>اعرض كل الأقفال أو اقفل البحث على شهر محدد.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="month-lock-filter">فلترة بالشهر</Label>
              <Input
                id="month-lock-filter"
                type="month"
                value={filterMonth}
                onChange={(event) => setFilterMonth(event.target.value)}
              />
            </div>
            <Button type="button" className="self-end" onClick={applyFilter}>
              تطبيق الفلتر
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-5 text-teal-700" aria-hidden />
              <CardTitle>قفل شهر جديد</CardTitle>
            </div>
            <CardDescription>اختر شهرًا مكتملًا سابقًا فقط، ثم أضف ملاحظة اختيارية.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="month-lock-create-month">الشهر المراد قفله</Label>
              <Input
                id="month-lock-create-month"
                type="month"
                value={monthKey}
                onChange={(event) => setMonthKey(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="month-lock-notes">ملاحظات القفل</Label>
              <Textarea
                id="month-lock-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="مثال: تمت مراجعة الحضور والرواتب"
              />
            </div>
            <Button
              type="button"
              disabled={!monthKey || createMonthLock.isPending}
              onClick={submitMonthLock}
            >
              {createMonthLock.isPending ? "جارٍ القفل..." : "قفل الشهر"}
            </Button>
            {submitMessage ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {submitMessage}
              </p>
            ) : null}
            {submitError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-5 text-teal-700" aria-hidden />
            <CardTitle>الأشهر المقفلة</CardTitle>
          </div>
          <CardDescription>سجل الشهور التي تم إغلاقها ومن قام بقفلها.</CardDescription>
        </CardHeader>
        <CardContent>
          {monthLocksQuery.isPending ? (
            <p className="text-sm text-muted-foreground">جارٍ تحميل أقفال الشهور...</p>
          ) : monthLocksQuery.isError ? (
            <p className="text-sm text-destructive">تعذّر تحميل أقفال الشهور.</p>
          ) : monthLocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد أقفال مطابقة.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الشهر</TableHead>
                    <TableHead>وقت القفل</TableHead>
                    <TableHead>المدير</TableHead>
                    <TableHead>الملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthLocks.map((lock) => (
                    <TableRow key={lock.id}>
                      <TableCell className="font-medium">{lock.monthKey}</TableCell>
                      <TableCell>{formatDateTime(lock.lockedAt)}</TableCell>
                      <TableCell>مدير #{lock.lockedByAdminId}</TableCell>
                      <TableCell>{lock.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => goToPage(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1}
          >
            الصفحة السابقة
          </Button>
          <p className="text-sm text-muted-foreground">
            الصفحة {pagination.page} من {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => goToPage(Math.min(pagination.totalPages, pagination.page + 1))}
            disabled={pagination.page >= pagination.totalPages}
          >
            الصفحة التالية
          </Button>
        </div>
      ) : null}
    </main>
  );
}
