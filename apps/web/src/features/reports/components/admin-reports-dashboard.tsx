"use client";

import { Download, FileText, Filter, Sigma } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/components/ui/table";
import { downloadReportBlob } from "@/features/reports/download-report";
import {
  useExportAttendancePdf,
  useExportEmployeesPdf,
  useExportMonthlyAttendanceSummaryPdf,
  useMonthlyAttendanceSummary
} from "@/features/reports/reports.hooks";
import type {
  MonthlyAttendanceSummaryFilters,
  MonthlyAttendanceSummaryRow
} from "@/features/reports/reports.types";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function toPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildMonthRange(month: string) {
  const [year, monthText] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthText, 0)).getUTCDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, "0")}`
  };
}

function total(rows: MonthlyAttendanceSummaryRow[], key: keyof Pick<
  MonthlyAttendanceSummaryRow,
  "attendanceDays" | "weeklyDaysOff" | "absenceWithPermission" | "absenceWithoutPermission"
>) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function summaryFilters(month: string, employeeId: string, branchId: string): MonthlyAttendanceSummaryFilters {
  return {
    month,
    employeeId: toPositiveNumber(employeeId),
    branchId: toPositiveNumber(branchId)
  };
}

export function AdminReportsDashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [filters, setFilters] = useState<MonthlyAttendanceSummaryFilters>(() =>
    summaryFilters(currentMonth(), "", "")
  );
  const [exportError, setExportError] = useState("");

  const summaryQuery = useMonthlyAttendanceSummary(filters);
  const exportEmployees = useExportEmployeesPdf();
  const exportAttendance = useExportAttendancePdf();
  const exportSummary = useExportMonthlyAttendanceSummaryPdf();
  const rows = summaryQuery.data?.summaries ?? [];
  const isExporting = exportEmployees.isPending || exportAttendance.isPending || exportSummary.isPending;

  function applyFilters() {
    setFilters(summaryFilters(month, employeeId, branchId));
  }

  async function downloadMonthlySummary() {
    setExportError("");
    try {
      const blob = await exportSummary.mutateAsync(filters);
      downloadReportBlob(blob, `monthly-attendance-summary-${filters.month}.pdf`);
    } catch {
      setExportError("تعذّر تصدير ملخص الشهر.");
    }
  }

  async function downloadAttendance() {
    setExportError("");
    try {
      const blob = await exportAttendance.mutateAsync({
        ...buildMonthRange(filters.month),
        branchId: filters.branchId,
        employeeId: filters.employeeId
      });
      downloadReportBlob(blob, `attendance-${filters.month}.pdf`);
    } catch {
      setExportError("تعذّر تصدير الحضور.");
    }
  }

  async function downloadEmployees() {
    setExportError("");
    try {
      const blob = await exportEmployees.mutateAsync({
        branchId: filters.branchId,
        employeeId: filters.employeeId
      });
      downloadReportBlob(blob, "employees.pdf");
    } catch {
      setExportError("تعذّر تصدير الموظفين.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="أيام الحضور" value={total(rows, "attendanceDays")} />
        <MetricCard title="الراحات الأسبوعية" value={total(rows, "weeklyDaysOff")} />
        <MetricCard title="غياب بإذن" value={total(rows, "absenceWithPermission")} />
        <MetricCard title="غياب بدون إذن" value={total(rows, "absenceWithoutPermission")} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="size-5 text-teal-700" aria-hidden />
            <CardTitle>فلاتر التقرير</CardTitle>
          </div>
          <CardDescription>اختر الشهر، ثم ضيق التقرير برقم الموظف أو الفرع عند الحاجة.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            aria-label="الشهر"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <Input
            aria-label="رقم الموظف"
            inputMode="numeric"
            placeholder="رقم الموظف"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          />
          <Input
            aria-label="رقم الفرع"
            inputMode="numeric"
            placeholder="رقم الفرع"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          />
          <Button type="button" onClick={applyFilters}>
            تطبيق الفلاتر
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Button type="button" variant="outline" disabled={isExporting} onClick={downloadMonthlySummary}>
          <Download className="size-4" aria-hidden />
          تصدير ملخص الشهر PDF
        </Button>
        <Button type="button" variant="outline" disabled={isExporting} onClick={downloadAttendance}>
          <Download className="size-4" aria-hidden />
          تصدير الحضور PDF
        </Button>
        <Button type="button" variant="outline" disabled={isExporting} onClick={downloadEmployees}>
          <Download className="size-4" aria-hidden />
          تصدير الموظفين PDF
        </Button>
      </div>

      {exportError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {exportError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-teal-700" aria-hidden />
            <CardTitle>ملخص الحضور الشهري</CardTitle>
          </div>
          <CardDescription>الأرقام محسوبة من الحضور، أيام الراحة، والغيابات بإذن.</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryQuery.isPending ? (
            <p className="text-sm text-muted-foreground">جارٍ تحميل التقرير...</p>
          ) : summaryQuery.isError ? (
            <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد بيانات لهذا الشهر.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الشهر</TableHead>
                    <TableHead>حضور</TableHead>
                    <TableHead>راحة</TableHead>
                    <TableHead>غياب بإذن</TableHead>
                    <TableHead>غياب بدون إذن</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.employeeId}-${row.branchId ?? "none"}`}>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell>{row.branchName ?? "بدون فرع"}</TableCell>
                      <TableCell>{row.month}</TableCell>
                      <TableCell>{row.attendanceDays}</TableCell>
                      <TableCell>{row.weeklyDaysOff}</TableCell>
                      <TableCell>{row.absenceWithPermission}</TableCell>
                      <TableCell>{row.absenceWithoutPermission}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: number }) {
  return (
    <Card className="border-teal-100 bg-white/90 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-teal-800">
          <Sigma className="size-4" aria-hidden />
          <CardDescription>{title}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-slate-950">{value}</p>
      </CardContent>
    </Card>
  );
}
