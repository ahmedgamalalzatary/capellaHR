"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/components/ui/select";
import { useAllBranches } from "@/features/branches/branches.hooks";
import {
  useCreateEmployeeAssignment,
  useEmployeeAssignments
} from "@/features/employees/employees.hooks";
import { employeeErrorMessage } from "@/features/employees/employee-error-message";

/** Format an ISO timestamp as an Arabic date (e.g. ١ يوليو ٢٠٢٦). */
function formatDate(iso: string) {
  return format(new Date(iso), "d MMMM yyyy", { locale: ar });
}

function todayInputValue() {
  return format(new Date(), "yyyy-MM-dd");
}

/** Branch assignment history plus a form to assign a new (now/future) branch. */
export function EmployeeBranchAssignmentsSection({
  employeeId,
  readOnly = false
}: {
  employeeId: number;
  readOnly?: boolean;
}) {
  const assignmentsQuery = useEmployeeAssignments(employeeId);
  const branchesQuery = useAllBranches();
  const createAssignment = useCreateEmployeeAssignment(employeeId);

  const completedBranches = (branchesQuery.data?.branches ?? []).filter(
    (branch) => branch.setupStatus === "completed"
  );
  const branchNameById = new Map(
    (branchesQuery.data?.branches ?? []).map((branch) => [branch.id, branch.name])
  );

  const [branchId, setBranchId] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  function handleAssign() {
    setFormError(null);
    if (!branchId || !effectiveDate) {
      setFormError("اختر الفرع وتاريخ التعيين");
      return;
    }
    if (effectiveDate < todayInputValue()) {
      setFormError("تاريخ التعيين يجب أن يكون اليوم أو في المستقبل");
      return;
    }

    createAssignment.mutate(
      { branchId: Number(branchId), effectiveFrom: new Date(effectiveDate).toISOString() },
      {
        onSuccess: () => {
          setBranchId("");
          setEffectiveDate("");
        },
        onError: (error) => setFormError(employeeErrorMessage(error))
      }
    );
  }

  return (
    <div className="space-y-4">
      {assignmentsQuery.isPending ? (
        <p className="text-muted-foreground text-sm">جارٍ تحميل التعيينات...</p>
      ) : assignmentsQuery.isError ? (
        <p className="text-destructive text-sm">تعذّر تحميل التعيينات</p>
      ) : assignmentsQuery.data.assignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">لا يوجد سجل تعيينات</p>
      ) : (
        <ul className="space-y-2">
          {assignmentsQuery.data.assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">
                {branchNameById.get(assignment.branchId) ?? "—"}
              </span>
              <span className="text-muted-foreground">
                {formatDate(assignment.effectiveFrom)}
                {" — "}
                {assignment.effectiveTo ? (
                  formatDate(assignment.effectiveTo)
                ) : (
                  <span className="text-foreground">حالي</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-sm font-medium">تعيين فرع جديد</p>
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid gap-2">
            <Label>الفرع الجديد</Label>
            <Select value={branchId || undefined} onValueChange={setBranchId}>
              <SelectTrigger aria-label="الفرع الجديد" className="sm:w-48">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {completedBranches.map((branch) => (
                  <SelectItem key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="assignment-date">تاريخ التعيين</Label>
            <Input
              id="assignment-date"
              type="date"
              dir="ltr"
              min={todayInputValue()}
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </div>

          <Button type="button" onClick={handleAssign} disabled={createAssignment.isPending}>
            {createAssignment.isPending ? "جارٍ التعيين..." : "تعيين"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
