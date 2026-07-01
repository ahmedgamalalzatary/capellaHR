"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/components/ui/table";
import { useAllBranches } from "@/features/branches/branches.hooks";
import { useAdminAttendance } from "@/features/attendance/attendance.hooks";
import type {
  AdminAttendanceFilters,
  AdminAttendanceSession
} from "@/features/attendance/attendance.types";
import { useDebounce } from "@/shared/hooks/use-debounce";

const ALL_BRANCHES = "all";
const ALL_STATUSES = "all";

const STATUS_LABELS: Record<AdminAttendanceSession["status"], string> = {
  open: "مفتوحة",
  completed: "مكتملة"
};

type AdminAttendanceListProps = {
  filters: AdminAttendanceFilters;
  onChange: (updates: Partial<AdminAttendanceFilters>) => void;
  onDelete: (session: AdminAttendanceSession) => void;
  onEdit: (session: AdminAttendanceSession) => void;
  onPageChange: (page: number) => void;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo"
  }).format(new Date(value));
}

export function AdminAttendanceList({
  filters,
  onChange,
  onDelete,
  onEdit,
  onPageChange
}: AdminAttendanceListProps) {
  const attendanceQuery = useAdminAttendance(filters);
  const branchesQuery = useAllBranches();
  const branches = branchesQuery.data?.branches ?? [];
  const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]));
  const [employeeName, setEmployeeName] = useState(filters.employeeName ?? "");
  const debouncedEmployeeName = useDebounce(employeeName, 300);

  useEffect(() => {
    setEmployeeName(filters.employeeName ?? "");
  }, [filters.employeeName]);

  useEffect(() => {
    const current = filters.employeeName ?? "";
    if (debouncedEmployeeName === current) {
      return;
    }
    onChange({ employeeName: debouncedEmployeeName || undefined, page: 1 });
  }, [debouncedEmployeeName, filters.employeeName, onChange]);

  if (attendanceQuery.isPending) {
    return <p className="text-muted-foreground text-sm">جارٍ تحميل الحضور...</p>;
  }

  if (attendanceQuery.isError) {
    return <p className="text-destructive text-sm">تعذّر تحميل سجلات الحضور</p>;
  }

  const sessions = attendanceQuery.data.sessions.items;
  const { pagination } = attendanceQuery.data.sessions;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm md:grid-cols-5">
        <Input
          className="md:col-span-2"
          placeholder="ابحث باسم الموظف"
          value={employeeName}
          onChange={(event) => setEmployeeName(event.target.value)}
        />

        <Select
          value={filters.branchId ? String(filters.branchId) : ALL_BRANCHES}
          onValueChange={(value) =>
            onChange({ branchId: value === ALL_BRANCHES ? undefined : Number(value), page: 1 })
          }
        >
          <SelectTrigger aria-label="الفرع">
            <SelectValue placeholder="الفرع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANCHES}>كل الفروع</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={String(branch.id)}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? ALL_STATUSES}
          onValueChange={(value) =>
            onChange({
              status:
                value === ALL_STATUSES
                  ? undefined
                  : (value as AdminAttendanceSession["status"]),
              page: 1
            })
          }
        >
          <SelectTrigger aria-label="حالة الجلسة">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>كل الحالات</SelectItem>
            <SelectItem value="open">مفتوحة</SelectItem>
            <SelectItem value="completed">مكتملة</SelectItem>
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="من تاريخ"
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(event) => onChange({ dateFrom: event.target.value || undefined, page: 1 })}
          />
          <Input
            aria-label="إلى تاريخ"
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(event) => onChange({ dateTo: event.target.value || undefined, page: 1 })}
          />
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="text-muted-foreground text-sm">لا توجد سجلات حضور</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الحضور</TableHead>
                <TableHead>الانصراف</TableHead>
                <TableHead>السبب</TableHead>
                <TableHead className="text-left">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.employeeName}</TableCell>
                  <TableCell>{branchNameById.get(session.branchId) ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={session.status === "completed" ? "success" : "secondary"}>
                      {STATUS_LABELS[session.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(session.checkInAtUtc)}</TableCell>
                  <TableCell>
                    {session.checkOutAtUtc ? formatDateTime(session.checkOutAtUtc) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {session.adminReason ?? "—"}
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse text-left">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`تعديل حركة ${session.employeeName}`}
                      onClick={() => onEdit(session)}
                    >
                      تعديل
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`حذف حركة ${session.employeeName}`}
                      onClick={() => onDelete(session)}
                    >
                      حذف
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1}
          >
            الصفحة السابقة
          </Button>
          <p className="text-muted-foreground text-sm">
            الصفحة {pagination.page} من {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            disabled={pagination.page >= pagination.totalPages}
          >
            الصفحة التالية
          </Button>
        </div>
      ) : null}
    </div>
  );
}
