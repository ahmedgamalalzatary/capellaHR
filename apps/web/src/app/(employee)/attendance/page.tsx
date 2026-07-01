"use client";

import { CalendarClock, Clock3, LocateFixed, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/shared/components/ui/card";
import { ApiError } from "@/shared/lib/api-client";
import { createBrowserFingerprint } from "@/features/attendance/browser-fingerprint";
import {
  useAttendanceHistory,
  useCurrentAttendance,
  useRecordAttendanceAction
} from "@/features/attendance/attendance.hooks";
import type { AttendanceActionPayload, AttendanceSession } from "@/features/attendance/attendance.types";

const historyFilters = { page: 1, pageSize: 10 };

const validationMessages: Record<string, string> = {
  device_not_allowed: "هذا الجهاز غير مسموح لتسجيل الحضور.",
  gps_out_of_range: "الموقع الحالي خارج نطاق الفرع.",
  ip_not_allowed: "الشبكة الحالية غير مسموحة لهذا الفرع."
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo"
  }).format(new Date(value));
}

function getPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GEOLOCATION_UNAVAILABLE"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 30_000
    });
  });
}

function getValidationFailures(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 422) {
    return [];
  }

  const payload = error.payload as {
    error?: { details?: { failureReasons?: unknown } };
  };
  const reasons = payload.error?.details?.failureReasons;

  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
}

function SessionRow({ session }: { session: AttendanceSession }) {
  return (
    <li className="rounded-xl border bg-background/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{formatDateTime(session.checkInAtUtc)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.checkOutAtUtc
              ? `انصراف ${formatTime(session.checkOutAtUtc)}`
              : "جلسة مفتوحة"}
          </p>
        </div>
        <Badge variant={session.status === "open" ? "success" : "secondary"}>
          {session.status === "open" ? "مفتوحة" : "مكتملة"}
        </Badge>
      </div>
    </li>
  );
}

export default function EmployeeAttendancePage() {
  const currentAttendance = useCurrentAttendance();
  const history = useAttendanceHistory(historyFilters);
  const recordAction = useRecordAttendanceAction();
  const [locationError, setLocationError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [validationFailures, setValidationFailures] = useState<string[]>([]);

  const attendance = currentAttendance.data?.attendance;
  const action = attendance?.currentAction;
  const isCheckingOut = action === "check_out";
  const canSubmitAttendance = Boolean(action) && !currentAttendance.isError;

  async function handleAttendanceAction() {
    setLocationError("");
    setSubmitError("");
    setValidationFailures([]);

    if (!action) {
      setSubmitError("تعذّر تحديد حالة الحضور الحالية. حدّث الصفحة ثم حاول مرة أخرى.");
      return;
    }

    let position: GeolocationPosition;
    try {
      position = await getPosition();
    } catch {
      setLocationError("تعذّر قراءة الموقع الحالي. اسمح للمتصفح باستخدام الموقع ثم حاول مرة أخرى.");
      return;
    }

    const payload: AttendanceActionPayload = {
      action,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      deviceId: createBrowserFingerprint()
    };

    recordAction.mutate(payload, {
      onSuccess: () => {
        setSubmitError("");
        setValidationFailures([]);
      },
      onError: (error) => {
        const failures = getValidationFailures(error);
        if (failures.length > 0) {
          setValidationFailures(failures);
          return;
        }

        setSubmitError("تعذّر تسجيل الحركة. حاول مرة أخرى.");
      }
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.16),transparent_34%),linear-gradient(180deg,#f8fafc,#eef5f2)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium text-teal-700">بوابة الموظف</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">الحضور والانصراف</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            سجّل حضورك من جهازك المعتمد مع التحقق من الموقع والشبكة الخاصة بالفرع.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-teal-100 bg-white/90 shadow-lg shadow-teal-950/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock3 className="size-5 text-teal-700" aria-hidden />
                <CardTitle>الحالة الحالية</CardTitle>
              </div>
              <CardDescription>
                {currentAttendance.isPending
                  ? "جارٍ تحميل حالة الحضور..."
                  : isCheckingOut
                    ? "جلسة مفتوحة"
                    : "جاهز لتسجيل الحضور"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {currentAttendance.isError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  تعذّر تحميل حالة الحضور.
                </p>
              ) : null}

              {attendance?.openSession ? (
                <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4">
                  <p className="text-sm text-teal-800">وقت الحضور</p>
                  <p className="mt-1 text-2xl font-semibold text-teal-950">
                    {formatTime(attendance.openSession.checkInAtUtc)}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-600">
                  لا توجد جلسة مفتوحة اليوم.
                </div>
              )}

              {locationError ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {locationError}
                </p>
              ) : null}

              {validationFailures.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldAlert className="size-4" aria-hidden />
                    <span>تعذّر تسجيل الحركة</span>
                  </div>
                  <ul className="space-y-1">
                    {validationFailures.map((reason) => (
                      <li key={reason}>{validationMessages[reason] ?? "فشل التحقق من بيانات الحضور."}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {submitError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}

              <Button
                type="button"
                size="lg"
                className="w-full bg-teal-700 hover:bg-teal-800"
                disabled={!canSubmitAttendance || currentAttendance.isPending || recordAction.isPending}
                onClick={handleAttendanceAction}
              >
                <LocateFixed className="size-4" aria-hidden />
                {recordAction.isPending
                  ? "جارٍ التسجيل..."
                  : isCheckingOut
                    ? "تسجيل الانصراف"
                    : "تسجيل الحضور"}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-slate-950 text-white shadow-lg shadow-slate-950/10">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="size-5 text-teal-300" aria-hidden />
                <CardTitle>جلسات اليوم</CardTitle>
              </div>
              <CardDescription className="text-slate-300">
                ملخص سريع لحركات اليوم بتوقيت القاهرة.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attendance?.todaySessions.length ? (
                <ul className="space-y-3 text-slate-950">
                  {attendance.todaySessions.map((session) => (
                    <SessionRow key={session.id} session={session} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  لا توجد حركات مسجلة اليوم.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>آخر الحركات</CardTitle>
            <CardDescription>آخر 10 جلسات حضور وانصراف.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.isPending ? (
              <p className="text-sm text-muted-foreground">جارٍ تحميل السجل...</p>
            ) : history.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل سجل الحضور.</p>
            ) : history.data.sessions.items.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {history.data.sessions.items.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">لا يوجد سجل حضور بعد.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
