"use client";

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { employeeErrorMessage } from "@/features/employees/employee-error-message";
import {
  useCreateEmployeeWeeklyDayOff,
  useEmployeeWeeklyDayOffs,
  useUpdateEmployeeWeeklyDayOff
} from "@/features/employees/employees.hooks";
import type { EmployeeWeeklyDayOffAssignment } from "@/features/employees/employees.types";

export function EmployeeWeeklyDayOffsSection({
  employeeId,
  readOnly = false
}: {
  employeeId: number;
  readOnly?: boolean;
}) {
  const assignmentsQuery = useEmployeeWeeklyDayOffs(employeeId);
  const createWeeklyDayOff = useCreateEmployeeWeeklyDayOff(employeeId);
  const [dayOffDate, setDayOffDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function handleCreate() {
    setFormError(null);
    if (!dayOffDate) {
      setFormError("اختر تاريخ الراحة");
      return;
    }

    const reason = overrideReason.trim();
    createWeeklyDayOff.mutate(
      { dayOffDate, ...(reason ? { overrideReason: reason } : {}) },
      {
        onSuccess: () => {
          setDayOffDate("");
          setOverrideReason("");
        },
        onError: (error) => setFormError(employeeErrorMessage(error))
      }
    );
  }

  return (
    <div className="space-y-4">
      {assignmentsQuery.isPending ? (
        <p className="text-muted-foreground text-sm">جارٍ تحميل أيام الراحة...</p>
      ) : assignmentsQuery.isError ? (
        <p className="text-destructive text-sm">تعذّر تحميل أيام الراحة</p>
      ) : assignmentsQuery.data.assignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">لا توجد أيام راحة مسجلة</p>
      ) : (
        <ul className="space-y-2">
          {assignmentsQuery.data.assignments.map((assignment) => (
            <WeeklyDayOffAssignmentItem
              key={assignment.id}
              assignment={assignment}
              employeeId={employeeId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">إضافة يوم راحة</p>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="weekly-day-off-date">تاريخ الراحة</Label>
              <Input
                id="weekly-day-off-date"
                type="date"
                dir="ltr"
                value={dayOffDate}
                onChange={(event) => setDayOffDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="weekly-day-off-reason">سبب التجاوز</Label>
              <Textarea
                id="weekly-day-off-reason"
                rows={1}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
              />
            </div>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={createWeeklyDayOff.isPending}
            >
              {createWeeklyDayOff.isPending ? "جارٍ الإضافة..." : "إضافة يوم راحة"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeeklyDayOffAssignmentItem({
  assignment,
  employeeId,
  readOnly
}: {
  assignment: EmployeeWeeklyDayOffAssignment;
  employeeId: number;
  readOnly: boolean;
}) {
  const updateWeeklyDayOff = useUpdateEmployeeWeeklyDayOff(employeeId);
  const [dayOffDate, setDayOffDate] = useState(assignment.dayOffDate);
  const [overrideReason, setOverrideReason] = useState(assignment.overrideReason ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  function handleUpdate() {
    setFormError(null);
    if (!dayOffDate) {
      setFormError("اختر تاريخ الراحة");
      return;
    }

    const reason = overrideReason.trim();
    updateWeeklyDayOff.mutate(
      {
        assignmentId: assignment.id,
        input: { dayOffDate, overrideReason: reason || null }
      },
      {
        onError: (error) => setFormError(employeeErrorMessage(error))
      }
    );
  }

  return (
    <li className="space-y-3 rounded-md border px-3 py-2 text-sm">
      <span dir="ltr">{assignment.dayOffDate}</span>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor={`weekly-day-off-date-${assignment.id}`}>
              {`تعديل تاريخ الراحة ${assignment.dayOffDate}`}
            </Label>
            <Input
              id={`weekly-day-off-date-${assignment.id}`}
              type="date"
              dir="ltr"
              value={dayOffDate}
              onChange={(event) => setDayOffDate(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`weekly-day-off-reason-${assignment.id}`}>
              {`سبب تعديل الراحة ${assignment.dayOffDate}`}
            </Label>
            <Textarea
              id={`weekly-day-off-reason-${assignment.id}`}
              rows={1}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleUpdate}
            disabled={updateWeeklyDayOff.isPending}
            aria-label={`حفظ يوم الراحة ${assignment.dayOffDate}`}
          >
            {updateWeeklyDayOff.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </div>
      )}
    </li>
  );
}
