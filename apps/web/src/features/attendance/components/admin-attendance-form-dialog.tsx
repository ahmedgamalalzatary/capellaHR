"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateAdminAttendance,
  useUpdateAdminAttendance
} from "@/features/attendance/attendance.hooks";
import type { AdminAttendanceSession } from "@/features/attendance/attendance.types";

type AdminAttendanceFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: AdminAttendanceSession | null;
};

const ADMIN_TIME_ZONE = "Africa/Cairo";

function getTimeZoneParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getTimeZoneOffsetMs(date: Date) {
  const parts = getTimeZoneParts(date);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - date.getTime();
}

function toIsoDateTime(value: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc)));

  return new Date(localAsUtc - getTimeZoneOffsetMs(firstPass)).toISOString();
}

function toDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const parts = getTimeZoneParts(new Date(value));

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function AdminAttendanceFormDialog({
  open,
  onOpenChange,
  session = null
}: AdminAttendanceFormDialogProps) {
  const createAttendance = useCreateAdminAttendance();
  const updateAttendance = useUpdateAdminAttendance();
  const [employeeId, setEmployeeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [checkInAt, setCheckInAt] = useState("");
  const [checkOutAt, setCheckOutAt] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const isEditing = Boolean(session);
  const isPending = createAttendance.isPending || updateAttendance.isPending;

  useEffect(() => {
    if (!open) {
      return;
    }

    setEmployeeId(session ? String(session.employeeId) : "");
    setBranchId(session ? String(session.branchId) : "");
    setCheckInAt(session ? toDateTimeInputValue(session.checkInAtUtc) : "");
    setCheckOutAt(session ? toDateTimeInputValue(session.checkOutAtUtc) : "");
    setReason(session?.adminReason ?? "");
    setFormError(null);
  }, [open, session]);

  function resetAndClose() {
    setEmployeeId("");
    setBranchId("");
    setCheckInAt("");
    setCheckOutAt("");
    setReason("");
    onOpenChange(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!employeeId || !branchId || !checkInAt || !reason.trim()) {
      setFormError("أدخل الموظف والفرع ووقت الحضور وسبب التعديل");
      return;
    }

    const payload = {
      branchId: Number(branchId),
      checkInAt: toIsoDateTime(checkInAt),
      checkOutAt: checkOutAt ? toIsoDateTime(checkOutAt) : undefined,
      reason: reason.trim()
    };
    const options = {
      onSuccess: resetAndClose,
      onError: () => setFormError("تعذّر حفظ حركة الحضور")
    };

    if (session) {
      updateAttendance.mutate({ sessionId: session.id, payload }, options);
      return;
    }

    createAttendance.mutate({ ...payload, employeeId: Number(employeeId) }, options);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "تعديل حركة حضور" : "إضافة حركة حضور"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {isEditing ? null : (
              <label className="space-y-1 text-sm font-medium">
                <span>رقم الموظف</span>
                <Input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                />
              </label>
            )}
            <label className="space-y-1 text-sm font-medium">
              <span>رقم الفرع</span>
              <Input
                type="number"
                min={1}
                dir="ltr"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>وقت الحضور</span>
              <Input
                type="datetime-local"
                value={checkInAt}
                onChange={(event) => setCheckInAt(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>وقت الانصراف</span>
              <Input
                type="datetime-local"
                value={checkOutAt}
                onChange={(event) => setCheckOutAt(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm font-medium">
            <span>سبب التعديل</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              حفظ الحركة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
