export type ErpPresentEmployee = {
  id: number;
  employeeCode: number;
  fullName: string;
  branchId: number;
};

type ErpPresentEmployeeReader = {
  listPresentEmployees(branchId: number): Promise<ErpPresentEmployee[]>;
  /**
   * `context` is an opaque caller transaction. A completing sale passes its own
   * transaction so the presence re-check and the invoice commit see one state.
   */
  findPresentEmployee(
    branchId: number,
    employeeId: number,
    context?: unknown,
  ): Promise<ErpPresentEmployee | null>;
};

/** Nothing but the four identity fields may cross into the ERP. */
const project = (row: ErpPresentEmployee): ErpPresentEmployee => ({
  id: row.id,
  employeeCode: row.employeeCode,
  fullName: row.fullName,
  branchId: row.branchId,
});

export const createErpAttendanceCapability = (attendance: ErpPresentEmployeeReader) => ({
  async listPresentEmployees(branchId: number): Promise<ErpPresentEmployee[]> {
    return (await attendance.listPresentEmployees(branchId)).map(project);
  },

  async findPresentEmployee(
    branchId: number,
    employeeId: number,
    context?: unknown,
  ): Promise<ErpPresentEmployee | null> {
    const row = await attendance.findPresentEmployee(branchId, employeeId, context);
    return row ? project(row) : null;
  },
});

export type ErpAttendanceCapability = ReturnType<typeof createErpAttendanceCapability>;
