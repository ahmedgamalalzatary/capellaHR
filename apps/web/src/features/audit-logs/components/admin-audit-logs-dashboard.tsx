"use client";

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
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
import { useAuditLogs } from "@/features/audit-logs/audit-logs.hooks";
import type { AuditLogFilters } from "@/features/audit-logs/audit-logs.types";

const PAGE_SIZE = 20;

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

function compactObject(value: Record<string, unknown> | null) {
  if (!value) {
    return "—";
  }

  return JSON.stringify(value);
}

export function AdminAuditLogsDashboard() {
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actionType, setActionType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    pageSize: PAGE_SIZE
  });
  const auditLogsQuery = useAuditLogs(filters);

  function applyFilters() {
    setFilters({
      page: 1,
      pageSize: PAGE_SIZE,
      search: trimOrUndefined(search),
      entityType: trimOrUndefined(entityType),
      actionType: trimOrUndefined(actionType),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    });
  }

  function goToPage(page: number) {
    setFilters((current) => ({
      ...current,
      page
    }));
  }

  const auditLogs = auditLogsQuery.data?.auditLogs.items ?? [];
  const pagination = auditLogsQuery.data?.auditLogs.pagination;

  return (
    <main className="space-y-6">
      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="max-w-3xl space-y-2">
          <p className="text-sm font-medium text-muted-foreground">العمليات الإدارية</p>
          <h1 className="text-3xl font-bold tracking-tight">سجل التدقيق</h1>
          <p className="text-muted-foreground">
            راقب الإجراءات الحساسة التي نفذها المديرون مع الكيان، السبب، والتوقيت.
          </p>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>الفلاتر</CardTitle>
          <CardDescription>استخدم الفلاتر لتضييق نطاق سجل العمليات.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="audit-search">بحث</Label>
            <Input
              id="audit-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم الكيان أو رقمه"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-entity-type">نوع الكيان</Label>
            <Input
              id="audit-entity-type"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              placeholder="employee"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-action-type">نوع الإجراء</Label>
            <Input
              id="audit-action-type"
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              placeholder="employee.update"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-date-from">من تاريخ</Label>
            <Input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-date-to">إلى تاريخ</Label>
            <Input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          <Button type="button" className="md:col-span-6 md:w-fit" onClick={applyFilters}>
            تطبيق الفلاتر
          </Button>
        </CardContent>
      </Card>

      {auditLogsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">جارٍ تحميل سجل التدقيق...</p>
      ) : null}

      {auditLogsQuery.isError ? (
        <p className="text-sm text-destructive">تعذّر تحميل سجل التدقيق</p>
      ) : null}

      {!auditLogsQuery.isPending && !auditLogsQuery.isError ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {auditLogs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">لا توجد عمليات مطابقة.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التوقيت</TableHead>
                  <TableHead>المدير</TableHead>
                  <TableHead>الإجراء</TableHead>
                  <TableHead>الكيان</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>قبل</TableHead>
                  <TableHead>بعد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => {
                  const before = compactObject(log.before);
                  const after = compactObject(log.after);

                  return (
                    <TableRow key={log.id}>
                      <TableCell>{formatDateTime(log.occurredAtUtc)}</TableCell>
                      <TableCell>مدير #{log.adminId}</TableCell>
                      <TableCell className="font-medium">{log.actionType}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{log.entityType}</p>
                          <p className="text-sm text-muted-foreground">
                            {log.entityDisplayName ?? log.entityId}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{log.reason ?? "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground" title={before}>
                        {before}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground" title={after}>
                        {after}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

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
