"use client";

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { usePaginationParams } from "@/shared/hooks/use-pagination-params";
import { AdminAttendanceDeleteDialog } from "@/features/attendance/components/admin-attendance-delete-dialog";
import { AdminAttendanceFormDialog } from "@/features/attendance/components/admin-attendance-form-dialog";
import { AdminAttendanceList } from "@/features/attendance/components/admin-attendance-list";
import type { AdminAttendanceSession } from "@/features/attendance/attendance.types";
import { readAdminAttendanceFilters } from "@/features/attendance/read-admin-attendance-filters";

export default function AdminAttendancePage() {
  const { get, setParams } = usePaginationParams();
  const filters = readAdminAttendanceFilters(get);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AdminAttendanceSession | null>(null);
  const [deletingSession, setDeletingSession] = useState<AdminAttendanceSession | null>(null);

  return (
    <main className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">تصحيح ومراجعة جلسات الموظفين</p>
          <h1 className="text-2xl font-bold">إدارة الحضور</h1>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          إضافة حركة
        </Button>
      </div>

      <AdminAttendanceList
        filters={filters}
        onChange={(updates) => setParams(updates)}
        onDelete={setDeletingSession}
        onEdit={setEditingSession}
        onPageChange={(page) => setParams({ page })}
      />
      <AdminAttendanceFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AdminAttendanceFormDialog
        open={Boolean(editingSession)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSession(null);
          }
        }}
        session={editingSession}
      />
      <AdminAttendanceDeleteDialog
        open={Boolean(deletingSession)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingSession(null);
          }
        }}
        session={deletingSession}
      />
    </main>
  );
}
