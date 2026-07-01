"use client";

import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/lib/api-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { createBrowserFingerprint } from "@/features/attendance/browser-fingerprint";
import { useCompleteEmployeeDeviceSetup } from "@/features/employees/employees.hooks";

function getSetupErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 410) {
    return "انتهت صلاحية رابط الإعداد";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "رابط الإعداد غير صحيح";
  }
  return "تعذّر تفعيل الجهاز";
}

export function EmployeeDeviceSetupForm({ deviceToken }: { deviceToken: string }) {
  const completeSetup = useCompleteEmployeeDeviceSetup(deviceToken);
  const [deviceLabel, setDeviceLabel] = useState("");

  if (completeSetup.isSuccess) {
    return (
      <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
          <h1 className="text-xl font-semibold">تم تفعيل الجهاز</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          يمكن استخدام هذا الجهاز الآن لتسجيل الحضور والانصراف.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5 rounded-lg border bg-card p-5 text-card-foreground shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        completeSetup.mutate({
          deviceLabel: deviceLabel.trim() || undefined,
          browserFingerprint: createBrowserFingerprint()
        });
      }}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5" aria-hidden />
        <h1 className="text-xl font-semibold">تفعيل جهاز الموظف</h1>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="employee-device-label">اسم الجهاز</Label>
        <Input
          id="employee-device-label"
          value={deviceLabel}
          onChange={(event) => setDeviceLabel(event.target.value)}
          placeholder="مثال: هاتف العمل"
        />
      </div>

      {completeSetup.isError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <TriangleAlert className="size-4" aria-hidden />
          <span>{getSetupErrorMessage(completeSetup.error)}</span>
        </div>
      ) : null}

      <Button type="submit" disabled={completeSetup.isPending}>
        تفعيل هذا الجهاز
      </Button>
    </form>
  );
}
