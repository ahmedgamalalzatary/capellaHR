"use client";

import { Copy, Link2, Smartphone, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  useCreateEmployeeDeviceSetupLink,
  useEmployeeDevice,
  useRevokeEmployeeDevice
} from "@/features/employees/employees.hooks";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function maskFingerprint(value: string) {
  return value.length <= 18 ? value : `${value.slice(0, 18)}...`;
}

function getSetupUrl(deviceToken: string) {
  if (typeof window === "undefined") {
    return `/employee-device-setup/${deviceToken}`;
  }
  return `${window.location.origin}/employee-device-setup/${deviceToken}`;
}

export function EmployeeDeviceSection({
  employeeId,
  readOnly = false
}: {
  employeeId: number;
  readOnly?: boolean;
}) {
  const { data, isPending, isError } = useEmployeeDevice(employeeId);
  const createSetupLink = useCreateEmployeeDeviceSetupLink(employeeId);
  const revokeDevice = useRevokeEmployeeDevice(employeeId);
  const [deviceLabel, setDeviceLabel] = useState("");
  const pendingUrl = useMemo(() => {
    const token = data?.employeeDevice.pendingSetup?.deviceToken;
    return token ? getSetupUrl(token) : "";
  }, [data?.employeeDevice.pendingSetup?.deviceToken]);

  if (isPending) {
    return <p className="text-muted-foreground text-sm">جارٍ تحميل بيانات الجهاز...</p>;
  }

  if (isError) {
    return <p className="text-destructive text-sm">تعذّر تحميل بيانات الجهاز</p>;
  }

  const { activeDevice, pendingSetup } = data.employeeDevice;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        {activeDevice ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Smartphone className="size-4" aria-hidden />
              <h3 className="text-sm font-semibold">جهاز مفعل</h3>
              <Badge variant="success">نشط</Badge>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">اسم الجهاز</dt>
                <dd className="text-sm">{activeDevice.deviceLabel ?? "بدون اسم"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تاريخ التفعيل</dt>
                <dd className="text-sm">{formatDateTime(activeDevice.registeredAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">بصمة المتصفح</dt>
                <dd className="font-mono text-xs" dir="ltr">
                  {maskFingerprint(activeDevice.browserFingerprint)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <XCircle className="size-4" aria-hidden />
            <span>لا يوجد جهاز مفعل</span>
          </div>
        )}
      </div>

      {pendingSetup ? (
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-4" aria-hidden />
            <h3 className="text-sm font-semibold">رابط إعداد بانتظار التفعيل</h3>
            <Badge variant="secondary">ينتهي {formatDateTime(pendingSetup.expiresAt)}</Badge>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`device-setup-url-${employeeId}`}>رابط الإعداد</Label>
            <div className="flex gap-2">
              <Input id={`device-setup-url-${employeeId}`} value={pendingUrl} readOnly dir="ltr" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="نسخ رابط الإعداد"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pendingUrl);
                    toast.success("تم نسخ الرابط");
                  } catch {
                    toast.error("تعذّر نسخ الرابط");
                  }
                }}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          {pendingSetup.deviceLabel ? (
            <p className="text-xs text-muted-foreground">اسم الجهاز: {pendingSetup.deviceLabel}</p>
          ) : null}
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="grid gap-2">
            <Label htmlFor={`device-label-${employeeId}`}>اسم الجهاز</Label>
            <Input
              id={`device-label-${employeeId}`}
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              placeholder="مثال: هاتف أحمد"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={createSetupLink.isPending}
              onClick={() =>
                createSetupLink.mutate(
                  { deviceLabel: deviceLabel.trim() || undefined },
                  {
                    onSuccess: () => toast.success("تم إنشاء رابط الإعداد"),
                    onError: () => toast.error("تعذّر إنشاء رابط الإعداد")
                  }
                )
              }
            >
              إنشاء رابط إعداد
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revokeDevice.isPending || (!activeDevice && !pendingSetup)}
              onClick={() =>
                revokeDevice.mutate(undefined, {
                  onSuccess: () => toast.success("تم إلغاء تفعيل الجهاز"),
                  onError: () => toast.error("تعذّر إلغاء تفعيل الجهاز")
                })
              }
            >
              إلغاء تفعيل الجهاز
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
