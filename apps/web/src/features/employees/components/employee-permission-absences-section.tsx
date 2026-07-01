"use client";

import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { employeeErrorMessage } from "@/features/employees/employee-error-message";
import {
  useCreateEmployeePermissionAbsence,
  useEmployeePermissionAbsences,
  useUpdateEmployeePermissionAbsence
} from "@/features/employees/employees.hooks";
import type { EmployeePermissionAbsence } from "@/features/employees/employees.types";

export function EmployeePermissionAbsencesSection({
  employeeId,
  readOnly = false
}: {
  employeeId: number;
  readOnly?: boolean;
}) {
  const absencesQuery = useEmployeePermissionAbsences(employeeId);
  const createPermissionAbsence = useCreateEmployeePermissionAbsence(employeeId);
  const [absenceDate, setAbsenceDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function handleCreate() {
    setFormError(null);
    if (!absenceDate) {
      setFormError("اختر تاريخ الغياب بإذن");
      return;
    }

    createPermissionAbsence.mutate(
      { absenceDate },
      {
        onSuccess: () => setAbsenceDate(""),
        onError: (error) => setFormError(employeeErrorMessage(error))
      }
    );
  }

  return (
    <div className="space-y-4">
      {absencesQuery.isPending ? (
        <p className="text-muted-foreground text-sm">جارٍ تحميل الغيابات بإذن...</p>
      ) : absencesQuery.isError ? (
        <p className="text-destructive text-sm">تعذّر تحميل الغيابات بإذن</p>
      ) : absencesQuery.data.absences.length === 0 ? (
        <p className="text-muted-foreground text-sm">لا توجد غيابات بإذن مسجلة</p>
      ) : (
        <ul className="space-y-2">
          {absencesQuery.data.absences.map((absence) => (
            <PermissionAbsenceItem
              key={absence.id}
              absence={absence}
              employeeId={employeeId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">إضافة غياب بإذن</p>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="permission-absence-date">تاريخ الغياب بإذن</Label>
              <Input
                id="permission-absence-date"
                type="date"
                dir="ltr"
                value={absenceDate}
                onChange={(event) => setAbsenceDate(event.target.value)}
              />
            </div>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={createPermissionAbsence.isPending}
            >
              {createPermissionAbsence.isPending ? "جارٍ الإضافة..." : "إضافة غياب بإذن"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionAbsenceItem({
  absence,
  employeeId,
  readOnly
}: {
  absence: EmployeePermissionAbsence;
  employeeId: number;
  readOnly: boolean;
}) {
  const updatePermissionAbsence = useUpdateEmployeePermissionAbsence(employeeId);
  const [absenceDate, setAbsenceDate] = useState(absence.absenceDate);
  const [formError, setFormError] = useState<string | null>(null);

  function handleUpdate() {
    setFormError(null);
    if (!absenceDate) {
      setFormError("اختر تاريخ الغياب بإذن");
      return;
    }

    updatePermissionAbsence.mutate(
      {
        absenceId: absence.id,
        input: { absenceDate }
      },
      {
        onError: (error) => setFormError(employeeErrorMessage(error))
      }
    );
  }

  return (
    <li className="space-y-3 rounded-md border px-3 py-2 text-sm">
      <span dir="ltr">{absence.absenceDate}</span>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor={`permission-absence-date-${absence.id}`}>
              {`تعديل تاريخ الغياب بإذن ${absence.absenceDate}`}
            </Label>
            <Input
              id={`permission-absence-date-${absence.id}`}
              type="date"
              dir="ltr"
              value={absenceDate}
              onChange={(event) => setAbsenceDate(event.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleUpdate}
            disabled={updatePermissionAbsence.isPending}
            aria-label={`حفظ الغياب بإذن ${absence.absenceDate}`}
          >
            {updatePermissionAbsence.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </div>
      )}
    </li>
  );
}
