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
import { Textarea } from "@/shared/components/ui/textarea";
import { useDeleteAdminAttendance } from "@/features/attendance/attendance.hooks";
import type { AdminAttendanceSession } from "@/features/attendance/attendance.types";

type AdminAttendanceDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AdminAttendanceSession | null;
};

export function AdminAttendanceDeleteDialog({
  open,
  onOpenChange,
  session
}: AdminAttendanceDeleteDialogProps) {
  const deleteAttendance = useDeleteAdminAttendance();
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setFormError(null);
    }
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!session) {
      return;
    }

    if (!reason.trim()) {
      setFormError("أدخل سبب الحذف");
      return;
    }

    deleteAttendance.mutate(
      { sessionId: session.id, payload: { reason: reason.trim() } },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => setFormError("تعذّر حذف حركة الحضور")
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>حذف حركة حضور</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <p className="text-muted-foreground text-sm">
            سيتم حذف حركة {session?.employeeName ?? "الموظف"}. هذا الإجراء يحتاج سببًا
            واضحًا لسجل التدقيق.
          </p>
          {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
          <label className="block space-y-1 text-sm font-medium">
            <span>سبب الحذف</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={deleteAttendance.isPending}>
              تأكيد الحذف
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
