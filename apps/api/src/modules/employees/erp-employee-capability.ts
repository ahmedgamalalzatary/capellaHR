export type ErpEmployeeIdentity = {
  id: number;
  employeeCode: number;
  fullName: string;
  branchId: number;
};

type ErpEmployeeReader = {
  findActiveById(id: number): Promise<(ErpEmployeeIdentity & {
    employmentStatus: 'active' | 'inactive';
    deletedAt: Date | null;
  }) | null>;
};

export const createErpEmployeeCapability = (employees: ErpEmployeeReader) => ({
  async findActiveById(id: number): Promise<ErpEmployeeIdentity | null> {
    const employee = await employees.findActiveById(id);
    if (!employee || employee.deletedAt || employee.employmentStatus !== 'active') return null;
    return {
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      branchId: employee.branchId,
    };
  },
});

export type ErpEmployeeCapability = ReturnType<typeof createErpEmployeeCapability>;
