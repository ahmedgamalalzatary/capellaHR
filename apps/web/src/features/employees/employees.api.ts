import { api } from "@/shared/lib/api-client";
import type {
  Employee,
  EmployeeBranchAssignmentListResponse,
  EmployeeBranchAssignmentResponse,
  EmployeeCreatePayload,
  EmployeeDeviceResponse,
  EmployeeDeviceRevokeResponse,
  EmployeeDeviceSetupCompletionInput,
  EmployeeDeviceSetupLinkInput,
  EmployeeFileListResponse,
  EmployeeFileResponse,
  EmployeeFileType,
  EmployeeListFilters,
  EmployeeListResponse,
  EmployeeResponse,
  EmployeeWeeklyDayOffAssignmentInput,
  EmployeeWeeklyDayOffAssignmentListResponse,
  EmployeeWeeklyDayOffAssignmentResponse,
  EmployeeUpdatePayload
} from "@/features/employees/employees.types";

/** Input for creating a future/now branch assignment (`effectiveFrom` is ISO). */
export type EmployeeAssignmentInput = {
  branchId: number;
  effectiveFrom: string;
};

/** Serialize a create payload into multipart form-data the API expects. */
function toCreateFormData(payload: EmployeeCreatePayload): FormData {
  const form = new FormData();

  form.set("fullName", payload.fullName);
  form.set("password", payload.password);
  form.set("primaryPhone", payload.primaryPhone);
  form.set("whatsappPhone", payload.whatsappPhone);
  if (payload.email !== undefined && payload.email !== "") {
    form.set("email", payload.email);
  }
  form.set("branchId", String(payload.branchId));
  form.set("age", String(payload.age));
  form.set("currentMonthlySalary", payload.currentMonthlySalary);
  form.set("address", payload.address);
  form.set("personalPhoto", payload.personalPhoto);
  form.set("idFront", payload.idFront);
  form.set("idBack", payload.idBack);

  return form;
}

function normalizeUpdatePayload(input: EmployeeUpdatePayload): EmployeeUpdatePayload {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "")
  ) as EmployeeUpdatePayload;
}

export const employeesApi = {
  /** Paginated, filterable list of employees. */
  list: (filters?: EmployeeListFilters) =>
    api.get<EmployeeListResponse>("/employees", { query: filters }),

  /** Single employee by id; throws ApiError(404) when missing. */
  get: (employeeId: number) => api.get<EmployeeResponse>(`/employees/${employeeId}`),

  /** Create an employee (multipart: text fields + three image files). */
  create: (payload: EmployeeCreatePayload) =>
    api.post<EmployeeResponse>("/employees", { formData: toCreateFormData(payload) }),

  /** Update an employee's text fields (JSON, partial). */
  update: (employeeId: number, input: EmployeeUpdatePayload) =>
    api.patch<EmployeeResponse>(`/employees/${employeeId}`, {
      json: normalizeUpdatePayload(input)
    }),

  /** Soft-delete an employee. Resolves to void (the API replies 204 No Content). */
  remove: async (employeeId: number): Promise<void> => {
    await api.delete<null>(`/employees/${employeeId}`);
  },

  /** List an employee's stored file metadata. */
  listFiles: (employeeId: number) =>
    api.get<EmployeeFileListResponse>(`/employees/${employeeId}/files`),

  /** Replace one of an employee's files (multipart, single `file` field). */
  replaceFile: (employeeId: number, fileType: EmployeeFileType, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return api.put<EmployeeFileResponse>(`/employees/${employeeId}/files/${fileType}`, {
      formData: form
    });
  },

  /** Fetch a file's binary content (private, authenticated) as a Blob. */
  fetchFileBlob: (employeeId: number, fileId: number) =>
    api.getBlob(`/employees/${employeeId}/files/${fileId}`),

  /** List an employee's historical branch assignments. */
  listAssignments: (employeeId: number) =>
    api.get<EmployeeBranchAssignmentListResponse>(`/employees/${employeeId}/branch-assignments`),

  /** Assign the employee to a branch effective now or in the future. */
  createAssignment: (employeeId: number, input: EmployeeAssignmentInput) =>
    api.post<EmployeeBranchAssignmentResponse>(`/employees/${employeeId}/branch-assignments`, {
      json: input
    }),

  /** List an employee's weekly day-off assignments. */
  listWeeklyDayOffs: (employeeId: number) =>
    api.get<EmployeeWeeklyDayOffAssignmentListResponse>(
      `/employees/${employeeId}/weekly-day-offs`
    ),

  /** Assign one weekly day off to the employee. */
  createWeeklyDayOff: (employeeId: number, input: EmployeeWeeklyDayOffAssignmentInput) =>
    api.post<EmployeeWeeklyDayOffAssignmentResponse>(
      `/employees/${employeeId}/weekly-day-offs`,
      { json: input }
    ),

  /** Update one weekly day-off assignment. */
  updateWeeklyDayOff: (assignmentId: number, input: EmployeeWeeklyDayOffAssignmentInput) =>
    api.patch<EmployeeWeeklyDayOffAssignmentResponse>(`/weekly-day-offs/${assignmentId}`, {
      json: input
    }),

  /** Current trusted-device state for one employee. */
  getDevice: (employeeId: number) =>
    api.get<EmployeeDeviceResponse>(`/employees/${employeeId}/device`),

  /** Create a one-hour setup link that the employee opens on their device. */
  createDeviceSetupLink: (employeeId: number, input: EmployeeDeviceSetupLinkInput) =>
    api.post<EmployeeDeviceResponse>(`/employees/${employeeId}/device/setup-links`, {
      json: input
    }),

  /** Revoke active and pending device access for one employee. */
  revokeDevice: (employeeId: number) =>
    api.delete<EmployeeDeviceRevokeResponse>(`/employees/${employeeId}/device`),

  /** Public setup completion endpoint called from the employee's device. */
  completeDeviceSetup: (deviceToken: string, input: EmployeeDeviceSetupCompletionInput) =>
    api.post<EmployeeDeviceResponse>(`/employee-device-setup/${deviceToken}/complete`, {
      json: input
    })
};

export type { Employee };
