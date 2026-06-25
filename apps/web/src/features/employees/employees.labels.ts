import type { EmployeeFileType, EmployeeStatus } from "@/features/employees/employees.types";

/** Arabic labels for an employee's active/soft-deleted status. */
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "نشط",
  soft_deleted: "محذوف"
};

/** Arabic labels for the three employee file types. */
export const EMPLOYEE_FILE_TYPE_LABELS: Record<EmployeeFileType, string> = {
  personal_photo: "الصورة الشخصية",
  id_front: "صورة الهوية (أمامي)",
  id_back: "صورة الهوية (خلفي)"
};

/** The file types every employee carries, in display order. */
export const EMPLOYEE_FILE_TYPES: EmployeeFileType[] = ["personal_photo", "id_front", "id_back"];
