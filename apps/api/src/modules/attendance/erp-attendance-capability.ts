export type ErpPresentEmployee = {
  id: number;
  employeeCode: number;
  fullName: string;
  branchId: number;
};

type ErpPresentEmployeeReader = {
  listPresentEmployees(branchId: number): Promise<ErpPresentEmployee[]>;
};

export const createErpAttendanceCapability = (attendance: ErpPresentEmployeeReader) => ({
  listPresentEmployees: (branchId: number) => attendance.listPresentEmployees(branchId),
});

export type ErpAttendanceCapability = ReturnType<typeof createErpAttendanceCapability>;
