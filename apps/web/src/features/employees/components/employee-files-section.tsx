"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { employeesApi } from "@/features/employees/employees.api";
import {
  useEmployeeFiles,
  useReplaceEmployeeFile
} from "@/features/employees/employees.hooks";
import { employeeKeys } from "@/features/employees/employees.keys";
import {
  EMPLOYEE_FILE_TYPES,
  EMPLOYEE_FILE_TYPE_LABELS
} from "@/features/employees/employees.labels";
import type { EmployeeFile, EmployeeFileType } from "@/features/employees/employees.types";

/** Authenticated thumbnail for one stored file (fetched as a blob, not a URL). */
function EmployeeFileImage({
  employeeId,
  fileId,
  alt
}: {
  employeeId: number;
  fileId: number;
  alt: string;
}) {
  const { data: blob } = useQuery({
    queryKey: [...employeeKeys.files(employeeId), fileId, "blob"],
    queryFn: () => employeesApi.fetchFileBlob(employeeId, fileId)
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (!objectUrl) {
    return <div className="size-24 rounded-md border bg-muted" aria-hidden />;
  }

  return <img src={objectUrl} alt={alt} className="size-24 rounded-md border object-cover" />;
}

function EmployeeFileRow({
  employeeId,
  fileType,
  file,
  readOnly
}: {
  employeeId: number;
  fileType: EmployeeFileType;
  file: EmployeeFile | undefined;
  readOnly: boolean;
}) {
  const label = EMPLOYEE_FILE_TYPE_LABELS[fileType];
  const replaceFile = useReplaceEmployeeFile(employeeId);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-sm font-medium">{label}</span>

      {file ? (
        <EmployeeFileImage employeeId={employeeId} fileId={file.id} alt={label} />
      ) : (
        <p className="text-xs text-muted-foreground">لا توجد صورة</p>
      )}

      {readOnly ? null : (
        <>
          <Label htmlFor={`replace-${fileType}`} className="sr-only">{`استبدال ${label}`}</Label>
          <Input
            id={`replace-${fileType}`}
            type="file"
            accept="image/jpeg,image/png"
            disabled={replaceFile.isPending}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (!selected) {
                return;
              }
              replaceFile.mutate(
                { fileType, file: selected },
                {
                  onSuccess: () => toast.success("تم تحديث الصورة"),
                  onError: () => toast.error("تعذّر تحديث الصورة")
                }
              );
            }}
          />
        </>
      )}
    </div>
  );
}

/** Shows an employee's three images with per-file replacement (unless read-only). */
export function EmployeeFilesSection({
  employeeId,
  readOnly = false
}: {
  employeeId: number;
  readOnly?: boolean;
}) {
  const { data, isPending, isError } = useEmployeeFiles(employeeId);

  if (isPending) {
    return <p className="text-muted-foreground text-sm">جارٍ تحميل الملفات...</p>;
  }

  if (isError) {
    return <p className="text-destructive text-sm">تعذّر تحميل الملفات</p>;
  }

  const fileByType = new Map(data.files.map((file) => [file.fileType, file]));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {EMPLOYEE_FILE_TYPES.map((fileType) => (
        <EmployeeFileRow
          key={fileType}
          employeeId={employeeId}
          fileType={fileType}
          file={fileByType.get(fileType)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}
