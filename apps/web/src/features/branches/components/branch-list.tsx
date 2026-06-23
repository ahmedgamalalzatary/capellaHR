"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/shared/components/ui/table";
import { useBranches } from "@/features/branches/branches.hooks";
import type { BranchSetupStatus } from "@capella/shared/contracts";

const SETUP_STATUS_LABELS: Record<BranchSetupStatus, string> = {
  setup_pending: "بانتظار الإعداد",
  completed: "مكتمل"
};

/** Admin table of branches with links to edit each one. */
export function BranchList() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError } = useBranches({ page, pageSize: 20 });

  if (isPending) {
    return <p className="text-muted-foreground text-sm">جارٍ تحميل الفروع...</p>;
  }

  if (isError) {
    return <p className="text-destructive text-sm">تعذّر تحميل الفروع</p>;
  }

  const branches = data.branches.items;
  const { pagination } = data.branches;

  if (branches.length === 0) {
    return <p className="text-muted-foreground text-sm">لا توجد فروع</p>;
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>اسم الفرع</TableHead>
            <TableHead>العنوان</TableHead>
            <TableHead>حالة الإعداد</TableHead>
            <TableHead className="text-left">إجراءات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((branch) => (
            <TableRow key={branch.id}>
              <TableCell className="font-medium">{branch.name}</TableCell>
              <TableCell className="text-muted-foreground">{branch.address}</TableCell>
              <TableCell>{SETUP_STATUS_LABELS[branch.setupStatus]}</TableCell>
              <TableCell className="text-left">
                <Link
                  href={`/branches/${branch.id}`}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  تعديل
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page <= 1}
          >
            الصفحة السابقة
          </Button>
          <p className="text-muted-foreground text-sm">
            الصفحة {pagination.page} من {pagination.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((currentPage) => Math.min(pagination.totalPages, currentPage + 1))}
            disabled={page >= pagination.totalPages}
          >
            الصفحة التالية
          </Button>
        </div>
      ) : null}
    </div>
  );
}
