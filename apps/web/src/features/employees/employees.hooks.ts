import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  employeesApi,
  type EmployeeAssignmentInput
} from "@/features/employees/employees.api";
import { employeeKeys } from "@/features/employees/employees.keys";
import type {
  EmployeeCreatePayload,
  EmployeeDeviceSetupCompletionInput,
  EmployeeDeviceSetupLinkInput,
  EmployeeFileType,
  EmployeeListFilters,
  EmployeePermissionAbsenceInput,
  EmployeeWeeklyDayOffAssignmentInput,
  EmployeeUpdatePayload
} from "@/features/employees/employees.types";

export function useEmployees(filters?: EmployeeListFilters) {
  return useQuery({
    queryKey: employeeKeys.list(filters),
    queryFn: () => employeesApi.list(filters)
  });
}

export function useEmployee(employeeId: number, enabled = true) {
  return useQuery({
    queryKey: employeeKeys.detail(employeeId),
    queryFn: () => employeesApi.get(employeeId),
    enabled: enabled && Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EmployeeCreatePayload) => employeesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    }
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, input }: { employeeId: number; input: EmployeeUpdatePayload }) =>
      employeesApi.update(employeeId, input),
    onSuccess: (_data, { employeeId }) => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employeeId) });
    }
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: number) => employeesApi.remove(employeeId),
    onSuccess: (_data, employeeId) => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
      queryClient.removeQueries({ queryKey: employeeKeys.detail(employeeId), exact: true });
      queryClient.removeQueries({ queryKey: employeeKeys.files(employeeId), exact: true });
      queryClient.removeQueries({ queryKey: employeeKeys.assignments(employeeId), exact: true });
      queryClient.removeQueries({ queryKey: employeeKeys.weeklyDayOffs(employeeId), exact: true });
      queryClient.removeQueries({
        queryKey: employeeKeys.permissionAbsences(employeeId),
        exact: true
      });
      queryClient.removeQueries({ queryKey: employeeKeys.device(employeeId), exact: true });
    }
  });
}

export function useEmployeeFiles(employeeId: number) {
  return useQuery({
    queryKey: employeeKeys.files(employeeId),
    queryFn: () => employeesApi.listFiles(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useReplaceEmployeeFile(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileType, file }: { fileType: EmployeeFileType; file: File }) =>
      employeesApi.replaceFile(employeeId, fileType, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.files(employeeId) });
    }
  });
}

export function useEmployeeAssignments(employeeId: number) {
  return useQuery({
    queryKey: employeeKeys.assignments(employeeId),
    queryFn: () => employeesApi.listAssignments(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useCreateEmployeeAssignment(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeAssignmentInput) =>
      employeesApi.createAssignment(employeeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.assignments(employeeId) });
      queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employeeId) });
    }
  });
}

export function useEmployeeWeeklyDayOffs(employeeId: number) {
  return useQuery({
    queryKey: employeeKeys.weeklyDayOffs(employeeId),
    queryFn: () => employeesApi.listWeeklyDayOffs(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useCreateEmployeeWeeklyDayOff(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeWeeklyDayOffAssignmentInput) =>
      employeesApi.createWeeklyDayOff(employeeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.weeklyDayOffs(employeeId) });
    }
  });
}

export function useUpdateEmployeeWeeklyDayOff(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      input
    }: {
      assignmentId: number;
      input: EmployeeWeeklyDayOffAssignmentInput;
    }) => employeesApi.updateWeeklyDayOff(assignmentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.weeklyDayOffs(employeeId) });
    }
  });
}

export function useEmployeePermissionAbsences(employeeId: number) {
  return useQuery({
    queryKey: employeeKeys.permissionAbsences(employeeId),
    queryFn: () => employeesApi.listPermissionAbsences(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useCreateEmployeePermissionAbsence(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeePermissionAbsenceInput) =>
      employeesApi.createPermissionAbsence(employeeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.permissionAbsences(employeeId) });
    }
  });
}

export function useUpdateEmployeePermissionAbsence(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      absenceId,
      input
    }: {
      absenceId: number;
      input: EmployeePermissionAbsenceInput;
    }) => employeesApi.updatePermissionAbsence(absenceId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.permissionAbsences(employeeId) });
    }
  });
}

export function useEmployeeDevice(employeeId: number) {
  return useQuery({
    queryKey: employeeKeys.device(employeeId),
    queryFn: () => employeesApi.getDevice(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0
  });
}

export function useCreateEmployeeDeviceSetupLink(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeDeviceSetupLinkInput) =>
      employeesApi.createDeviceSetupLink(employeeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.device(employeeId) });
    }
  });
}

export function useRevokeEmployeeDevice(employeeId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => employeesApi.revokeDevice(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.device(employeeId) });
    }
  });
}

export function useCompleteEmployeeDeviceSetup(deviceToken: string) {
  return useMutation({
    mutationFn: (input: EmployeeDeviceSetupCompletionInput) =>
      employeesApi.completeDeviceSetup(deviceToken, input)
  });
}
