/** Keeps present-employee lookups under one feature-owned cache root. */
export const employeeAssignmentQueryKeys = {
  all: ['employee-assignment'] as const,
  present: (branchId?: number) => ['employee-assignment', 'present', branchId ?? 'own'] as const,
};
