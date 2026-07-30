export type ErpBranchIdentity = {
  id: number;
  name: string;
};

type ErpBranchReader = {
  findById(id: number): Promise<ErpBranchIdentity | null>;
};

export const createErpBranchCapability = (branches: ErpBranchReader) => ({
  async findById(id: number): Promise<ErpBranchIdentity | null> {
    const branch = await branches.findById(id);
    return branch ? { id: branch.id, name: branch.name } : null;
  },
});

export type ErpBranchCapability = ReturnType<typeof createErpBranchCapability>;
